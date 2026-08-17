/*
 * Copyright (c) 2026 Hyperlocalise Pty Ltd
 *
 * Use of this software is governed by the Business Source License 1.1
 * included in this application's LICENSE file.
 *
 * Change Date: Four years after publication of the applicable version.
 *
 * On the Change Date, in accordance with the Business Source License, use
 * of this software will be governed by the GNU General Public License
 * Version 2.0 or later.
 */
import { and, eq, inArray, sql } from "drizzle-orm";

import type { IssueBulkActionBody } from "@/api/routes/issues/issues-bulk.schema";
import { canAccessProject } from "@/api/auth/team-access";
import type { ApiAuthContext } from "@/api/auth/workos";
import { db, schema } from "@/lib/database";
import { mapWithConcurrency } from "@/lib/primitives/map-with-concurrency/map-with-concurrency";

import {
  priorityColumnJoin,
  priorityColumns,
  priorityValueJoin,
  priorityValues,
} from "./issue-list-query";
import { IssueSheetService, type IssueSheetIssue } from "./issue-sheet-service";

const BULK_UPDATE_CONCURRENCY = 4;

export type IssueBulkItemResult = {
  issueId: string;
  projectId: string;
  outcome: "updated" | "unchanged" | "failed";
  issue?: IssueSheetIssue;
  error?: {
    code: "issue_not_found" | "assignee_not_assignable" | "issue_update_failed";
    message?: string;
  };
};

export type IssueBulkActionResult = {
  action: IssueBulkActionBody["action"];
  requested: number;
  succeeded: number;
  failed: number;
  unchanged: number;
  results: IssueBulkItemResult[];
};

type IssueSnapshot = {
  id: string;
  projectId: string;
  status: string;
  issueType: string;
  assigneeUserId: string | null;
  priority: string | null;
};

function dedupeBulkTargets(body: IssueBulkActionBody) {
  const seen = new Set<string>();
  const targets: IssueBulkActionBody["issues"] = [];
  for (const target of body.issues) {
    const key = `${target.projectId}:${target.issueId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    targets.push(target);
  }
  return targets;
}

function mapUpdateError(error: unknown): IssueBulkItemResult["error"] {
  if (error instanceof Error) {
    if (error.message === "assignee_not_assignable") {
      return { code: "assignee_not_assignable" };
    }
    if (error.message === "issue_sheet_issue_not_found") {
      return { code: "issue_not_found" };
    }
  }
  return { code: "issue_update_failed" };
}

export class IssueBulkUpdateService {
  constructor(
    private readonly database = db,
    private readonly issueSheetService = new IssueSheetService(database),
  ) {}

  async run(auth: ApiAuthContext, body: IssueBulkActionBody): Promise<IssueBulkActionResult> {
    const organizationId = auth.organization.localOrganizationId;
    const actorUserId = auth.user.localUserId;
    const targets = dedupeBulkTargets(body);

    const snapshots = await this.loadIssueSnapshots({
      organizationId,
      targets,
    });

    const results = await mapWithConcurrency(targets, BULK_UPDATE_CONCURRENCY, async (target) => {
      try {
        return await this.applyAction({
          auth,
          organizationId,
          actorUserId,
          body,
          target,
          snapshot: snapshots.get(`${target.projectId}:${target.issueId}`) ?? null,
        });
      } catch (error) {
        return {
          issueId: target.issueId,
          projectId: target.projectId,
          outcome: "failed" as const,
          error: mapUpdateError(error),
        };
      }
    });

    let succeeded = 0;
    let failed = 0;
    let unchanged = 0;
    for (const result of results) {
      if (result.outcome === "updated") {
        succeeded += 1;
      } else if (result.outcome === "unchanged") {
        unchanged += 1;
      } else {
        failed += 1;
      }
    }

    return {
      action: body.action,
      requested: targets.length,
      succeeded,
      failed,
      unchanged,
      results,
    };
  }

  private async loadIssueSnapshots(input: {
    organizationId: string;
    targets: IssueBulkActionBody["issues"];
  }) {
    if (input.targets.length === 0) {
      return new Map<string, IssueSnapshot>();
    }

    const issueIds = [...new Set(input.targets.map((target) => target.issueId))];
    const rows = await this.database
      .select({
        id: schema.issueSheetIssues.id,
        projectId: schema.issueSheetIssues.projectId,
        status: schema.issueSheetIssues.status,
        issueType: schema.issueSheetIssues.issueType,
        assigneeUserId: schema.issueSheetIssues.assigneeUserId,
        priority: sql<string | null>`${priorityValues.value} #>> '{}'`,
      })
      .from(schema.issueSheetIssues)
      .leftJoin(priorityColumns, priorityColumnJoin)
      .leftJoin(priorityValues, priorityValueJoin)
      .where(
        and(
          eq(schema.issueSheetIssues.organizationId, input.organizationId),
          inArray(schema.issueSheetIssues.id, issueIds),
        ),
      );

    const snapshots = new Map<string, IssueSnapshot>();
    for (const row of rows) {
      snapshots.set(`${row.projectId}:${row.id}`, {
        id: row.id,
        projectId: row.projectId,
        status: row.status,
        issueType: row.issueType,
        assigneeUserId: row.assigneeUserId,
        priority: row.priority,
      });
    }
    return snapshots;
  }

  private async applyAction(input: {
    auth: ApiAuthContext;
    organizationId: string;
    actorUserId: string;
    body: IssueBulkActionBody;
    target: IssueBulkActionBody["issues"][number];
    snapshot: IssueSnapshot | null;
  }): Promise<IssueBulkItemResult> {
    const { target } = input;
    const accessibleProject = await canAccessProject(input.auth, target.projectId);
    if (!accessibleProject) {
      return {
        issueId: target.issueId,
        projectId: target.projectId,
        outcome: "failed",
        error: { code: "issue_not_found" },
      };
    }

    if (!input.snapshot || input.snapshot.projectId !== target.projectId) {
      return {
        issueId: target.issueId,
        projectId: target.projectId,
        outcome: "failed",
        error: { code: "issue_not_found" },
      };
    }

    const base = {
      organizationId: input.organizationId,
      projectId: target.projectId,
      issueId: target.issueId,
      actorUserId: input.actorUserId,
    };

    switch (input.body.action) {
      case "assign": {
        if (input.snapshot.assigneeUserId === input.body.assigneeUserId) {
          return this.unchangedResult(base, input.snapshot);
        }
        const issue = await this.issueSheetService.updateIssue({
          ...base,
          body: { assigneeUserId: input.body.assigneeUserId },
        });
        if (!issue) {
          return {
            issueId: target.issueId,
            projectId: target.projectId,
            outcome: "failed",
            error: { code: "issue_not_found" },
          };
        }
        return { issueId: target.issueId, projectId: target.projectId, outcome: "updated", issue };
      }
      case "unassign": {
        if (input.snapshot.assigneeUserId == null) {
          return this.unchangedResult(base, input.snapshot);
        }
        const issue = await this.issueSheetService.updateIssue({
          ...base,
          body: { assigneeUserId: null },
        });
        if (!issue) {
          return {
            issueId: target.issueId,
            projectId: target.projectId,
            outcome: "failed",
            error: { code: "issue_not_found" },
          };
        }
        return { issueId: target.issueId, projectId: target.projectId, outcome: "updated", issue };
      }
      case "set_status": {
        if (input.snapshot.status === input.body.status) {
          return this.unchangedResult(base, input.snapshot);
        }
        const issue = await this.issueSheetService.updateIssue({
          ...base,
          body: { status: input.body.status },
        });
        if (!issue) {
          return {
            issueId: target.issueId,
            projectId: target.projectId,
            outcome: "failed",
            error: { code: "issue_not_found" },
          };
        }
        return { issueId: target.issueId, projectId: target.projectId, outcome: "updated", issue };
      }
      case "set_issue_type": {
        if (input.snapshot.issueType === input.body.issueType) {
          return this.unchangedResult(base, input.snapshot);
        }
        const issue = await this.issueSheetService.updateIssue({
          ...base,
          body: { issueType: input.body.issueType },
        });
        if (!issue) {
          return {
            issueId: target.issueId,
            projectId: target.projectId,
            outcome: "failed",
            error: { code: "issue_not_found" },
          };
        }
        return { issueId: target.issueId, projectId: target.projectId, outcome: "updated", issue };
      }
      case "set_priority": {
        if (input.snapshot.priority === input.body.priority) {
          return this.unchangedResult(base, input.snapshot);
        }
        const priorityResult = await this.issueSheetService.setPriority({
          ...base,
          priority: input.body.priority,
        });
        if (priorityResult == null) {
          return {
            issueId: target.issueId,
            projectId: target.projectId,
            outcome: "failed",
            error: { code: "issue_not_found" },
          };
        }
        if (priorityResult.outcome === "unchanged") {
          return this.unchangedResult(base, input.snapshot);
        }
        const issue = await this.issueSheetService.getIssueForActor(base);
        if (!issue) {
          return {
            issueId: target.issueId,
            projectId: target.projectId,
            outcome: "failed",
            error: { code: "issue_not_found" },
          };
        }
        return { issueId: target.issueId, projectId: target.projectId, outcome: "updated", issue };
      }
      default:
        return {
          issueId: target.issueId,
          projectId: target.projectId,
          outcome: "failed",
          error: { code: "issue_update_failed" },
        };
    }
  }

  private async unchangedResult(
    base: {
      organizationId: string;
      projectId: string;
      issueId: string;
      actorUserId: string;
    },
    _snapshot: IssueSnapshot,
  ): Promise<IssueBulkItemResult> {
    const issue = await this.issueSheetService.getIssueForActor(base);
    return {
      issueId: base.issueId,
      projectId: base.projectId,
      outcome: "unchanged",
      ...(issue ? { issue } : {}),
    };
  }
}

export const issueBulkUpdateService = new IssueBulkUpdateService();
