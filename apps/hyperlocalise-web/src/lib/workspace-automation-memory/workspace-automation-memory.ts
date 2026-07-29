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
import { and, eq } from "drizzle-orm";

import { db, schema, type DatabaseClient, type DatabaseTransaction } from "@/lib/database";
import { err, isErr, ok, type Result } from "@/lib/primitives/result/results";
import { commitVersionedDocument } from "@/lib/versioned-document/commit-versioned-document";
import type { VersionedDocumentCurrentRow } from "@/lib/versioned-document/versioned-document.types";
import { normalizeWorkspaceAutomationMemoryContent } from "./workspace-automation-memory.shared";
import type {
  CurrentWorkspaceAutomationMemoryRow,
  WorkspaceAutomationMemoryCommitError,
  WorkspaceAutomationMemoryCommitResult,
  WorkspaceAutomationMemoryRecord,
} from "./workspace-automation-memory.types";

const emptyWorkspaceAutomationMemory: WorkspaceAutomationMemoryRecord = {
  revisionId: null,
  version: 0,
  content: "",
  summary: null,
  includeOrgKnowledge: true,
  updatedAt: null,
  updatedByUserId: null,
};

function toWorkspaceAutomationMemoryRecord(
  row: CurrentWorkspaceAutomationMemoryRow | undefined,
): WorkspaceAutomationMemoryRecord {
  if (!row) {
    return emptyWorkspaceAutomationMemory;
  }

  return {
    revisionId: row.revisionId,
    version: row.version,
    content: row.content,
    summary: row.summary,
    includeOrgKnowledge: row.includeOrgKnowledge,
    updatedAt: row.updatedAt.toISOString(),
    updatedByUserId: row.updatedByUserId,
  };
}

const workspaceAutomationMemoryHeadColumns = {
  revisionId: schema.workspaceAutomationMemories.revisionId,
  version: schema.workspaceAutomationMemories.version,
  content: schema.workspaceAutomationMemories.content,
  summary: schema.workspaceAutomationMemories.summary,
  includeOrgKnowledge: schema.workspaceAutomationMemories.includeOrgKnowledge,
  updatedAt: schema.workspaceAutomationMemories.updatedAt,
  updatedByUserId: schema.workspaceAutomationMemories.updatedByUserId,
};

async function getCurrentWorkspaceAutomationMemoryRow(
  database: DatabaseClient,
  automationId: string,
): Promise<CurrentWorkspaceAutomationMemoryRow | undefined> {
  const [row] = await database
    .select(workspaceAutomationMemoryHeadColumns)
    .from(schema.workspaceAutomationMemories)
    .where(eq(schema.workspaceAutomationMemories.automationId, automationId))
    .limit(1);

  return row;
}

export async function getWorkspaceAutomationMemory(input: {
  automationId: string;
}): Promise<WorkspaceAutomationMemoryRecord> {
  return toWorkspaceAutomationMemoryRecord(
    await getCurrentWorkspaceAutomationMemoryRow(db, input.automationId),
  );
}

/**
 * Sets the additive/override toggle for whether org-wide Knowledge Memory is also included
 * alongside this automation's own Memory. Deliberately outside commitWorkspaceAutomationMemory:
 * it's live config, not versioned content, and shouldn't create a revision or interact with the
 * commit's optimistic-concurrency/no-op logic. A no-op if the automation has no Memory row yet.
 */
export async function setWorkspaceAutomationMemoryIncludeOrgKnowledge(input: {
  automationId: string;
  organizationId: string;
  includeOrgKnowledge: boolean;
}): Promise<void> {
  await db
    .update(schema.workspaceAutomationMemories)
    .set({ includeOrgKnowledge: input.includeOrgKnowledge })
    .where(
      and(
        eq(schema.workspaceAutomationMemories.automationId, input.automationId),
        eq(schema.workspaceAutomationMemories.organizationId, input.organizationId),
      ),
    );
}

export async function commitWorkspaceAutomationMemory(input: {
  automationId: string;
  organizationId: string;
  content: string;
  summary?: string;
  updatedByUserId: string;
  expectedRevisionId: string | null;
  forceNewRevision?: boolean;
}): Promise<Result<WorkspaceAutomationMemoryCommitResult, WorkspaceAutomationMemoryCommitError>> {
  // Captured from whichever branch of the shared commit actually ran, since the generic
  // module's record shape doesn't know about this resource-specific column.
  let includeOrgKnowledge = true;

  const result = await commitVersionedDocument({
    db,
    content: input.content,
    normalizeContent: normalizeWorkspaceAutomationMemoryContent,
    summary: input.summary,
    initialSummaryFallback: "Initial version",
    updatedSummaryFallback: "Updated memory",
    updatedByUserId: input.updatedByUserId,
    expectedRevisionId: input.expectedRevisionId,
    forceNewRevision: input.forceNewRevision,
    emptyRecord: emptyWorkspaceAutomationMemory,
    readCurrent: async (tx: DatabaseTransaction) => {
      const row = await getCurrentWorkspaceAutomationMemoryRow(tx, input.automationId);
      if (row) {
        includeOrgKnowledge = row.includeOrgKnowledge;
      }
      return row;
    },
    insertHead: async (
      tx: DatabaseTransaction,
      values,
    ): Promise<VersionedDocumentCurrentRow | undefined> => {
      const [inserted] = await tx
        .insert(schema.workspaceAutomationMemories)
        .values({
          automationId: input.automationId,
          organizationId: input.organizationId,
          revisionId: values.revisionId,
          version: values.version,
          content: values.content,
          summary: values.summary,
          updatedByUserId: values.updatedByUserId,
          createdAt: values.now,
          updatedAt: values.now,
        })
        .onConflictDoNothing({ target: schema.workspaceAutomationMemories.automationId })
        .returning(workspaceAutomationMemoryHeadColumns);
      if (inserted) {
        includeOrgKnowledge = inserted.includeOrgKnowledge;
      }
      return inserted;
    },
    updateHead: async (
      tx: DatabaseTransaction,
      expectedRevisionId,
      values,
    ): Promise<VersionedDocumentCurrentRow | undefined> => {
      const [updated] = await tx
        .update(schema.workspaceAutomationMemories)
        .set({
          revisionId: values.revisionId,
          version: values.version,
          content: values.content,
          summary: values.summary,
          updatedByUserId: values.updatedByUserId,
          updatedAt: values.now,
        })
        .where(
          and(
            eq(schema.workspaceAutomationMemories.automationId, input.automationId),
            eq(schema.workspaceAutomationMemories.revisionId, expectedRevisionId),
          ),
        )
        .returning(workspaceAutomationMemoryHeadColumns);
      if (updated) {
        includeOrgKnowledge = updated.includeOrgKnowledge;
      }
      return updated;
    },
    archivePrevious: async (tx: DatabaseTransaction, previous) => {
      await tx.insert(schema.workspaceAutomationMemoryRevisions).values({
        id: previous.revisionId,
        automationId: input.automationId,
        organizationId: input.organizationId,
        version: previous.version,
        content: previous.content,
        summary: previous.summary,
        createdByUserId: previous.updatedByUserId,
        createdAt: previous.updatedAt,
      });
    },
  });

  if (isErr(result)) {
    return err({
      code: "precondition_failed",
      current: { ...result.error.current, includeOrgKnowledge },
    });
  }

  return ok({
    workspaceAutomationMemory: { ...result.value.record, includeOrgKnowledge },
    changed: result.value.changed,
  });
}
