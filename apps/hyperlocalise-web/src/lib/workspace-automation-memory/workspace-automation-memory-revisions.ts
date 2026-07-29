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
import { and, desc, eq, lt } from "drizzle-orm";

import { db, schema } from "@/lib/database";
import { err, type Result } from "@/lib/primitives/result/results";
import { mergeVersionedDocumentRevisionPage } from "@/lib/versioned-document/merge-versioned-document-revision-page";
import { commitWorkspaceAutomationMemory } from "./workspace-automation-memory";
import type {
  WorkspaceAutomationMemoryCommitResult,
  WorkspaceAutomationMemoryRestoreError,
  WorkspaceAutomationMemoryRevision,
  WorkspaceAutomationMemoryRevisionAuthorRow,
  WorkspaceAutomationMemoryRevisionMetadata,
} from "./workspace-automation-memory.types";

function createdByName(row: WorkspaceAutomationMemoryRevisionAuthorRow) {
  const name = [row.createdByFirstName, row.createdByLastName].filter(Boolean).join(" ").trim();
  return name || null;
}

export async function listWorkspaceAutomationMemoryRevisions(input: {
  automationId: string;
  limit: number;
  cursor?: number;
}): Promise<{
  workspaceAutomationMemoryRevisions: WorkspaceAutomationMemoryRevisionMetadata[];
  nextCursor: number | null;
}> {
  const currentRows = await db
    .select({
      revisionId: schema.workspaceAutomationMemories.revisionId,
      version: schema.workspaceAutomationMemories.version,
      summary: schema.workspaceAutomationMemories.summary,
      createdAt: schema.workspaceAutomationMemories.updatedAt,
      createdByUserId: schema.workspaceAutomationMemories.updatedByUserId,
      createdByFirstName: schema.users.firstName,
      createdByLastName: schema.users.lastName,
    })
    .from(schema.workspaceAutomationMemories)
    .leftJoin(schema.users, eq(schema.workspaceAutomationMemories.updatedByUserId, schema.users.id))
    .where(
      and(
        eq(schema.workspaceAutomationMemories.automationId, input.automationId),
        input.cursor === undefined
          ? undefined
          : lt(schema.workspaceAutomationMemories.version, input.cursor),
      ),
    )
    .limit(1);

  const archivedRows = await db
    .select({
      revisionId: schema.workspaceAutomationMemoryRevisions.id,
      version: schema.workspaceAutomationMemoryRevisions.version,
      summary: schema.workspaceAutomationMemoryRevisions.summary,
      createdAt: schema.workspaceAutomationMemoryRevisions.createdAt,
      createdByUserId: schema.workspaceAutomationMemoryRevisions.createdByUserId,
      createdByFirstName: schema.users.firstName,
      createdByLastName: schema.users.lastName,
    })
    .from(schema.workspaceAutomationMemoryRevisions)
    .leftJoin(
      schema.users,
      eq(schema.workspaceAutomationMemoryRevisions.createdByUserId, schema.users.id),
    )
    .where(
      and(
        eq(schema.workspaceAutomationMemoryRevisions.automationId, input.automationId),
        input.cursor === undefined
          ? undefined
          : lt(schema.workspaceAutomationMemoryRevisions.version, input.cursor),
      ),
    )
    .orderBy(desc(schema.workspaceAutomationMemoryRevisions.version))
    .limit(input.limit + 1);

  const currentRevisions = currentRows.map((row) => ({
    revisionId: row.revisionId,
    version: row.version,
    summary: row.summary,
    createdAt: row.createdAt.toISOString(),
    createdByUserId: row.createdByUserId,
    createdByName: createdByName(row),
    isCurrent: true,
  }));
  const archivedRevisions = archivedRows.map((row) => ({
    revisionId: row.revisionId,
    version: row.version,
    summary: row.summary,
    createdAt: row.createdAt.toISOString(),
    createdByUserId: row.createdByUserId,
    createdByName: createdByName(row),
    isCurrent: false,
  }));

  const { revisions: workspaceAutomationMemoryRevisions, nextCursor } =
    mergeVersionedDocumentRevisionPage({
      currentRevisions,
      archivedRevisions,
      limit: input.limit,
    });

  return { workspaceAutomationMemoryRevisions, nextCursor };
}

async function findWorkspaceAutomationMemoryRevision(
  automationId: string,
  revisionId: string,
): Promise<WorkspaceAutomationMemoryRevision | null> {
  const [current] = await db
    .select({
      revisionId: schema.workspaceAutomationMemories.revisionId,
      version: schema.workspaceAutomationMemories.version,
      content: schema.workspaceAutomationMemories.content,
      summary: schema.workspaceAutomationMemories.summary,
      createdAt: schema.workspaceAutomationMemories.updatedAt,
      createdByUserId: schema.workspaceAutomationMemories.updatedByUserId,
      createdByFirstName: schema.users.firstName,
      createdByLastName: schema.users.lastName,
    })
    .from(schema.workspaceAutomationMemories)
    .leftJoin(schema.users, eq(schema.workspaceAutomationMemories.updatedByUserId, schema.users.id))
    .where(
      and(
        eq(schema.workspaceAutomationMemories.automationId, automationId),
        eq(schema.workspaceAutomationMemories.revisionId, revisionId),
      ),
    )
    .limit(1);

  if (current) {
    return {
      revisionId: current.revisionId,
      version: current.version,
      content: current.content,
      summary: current.summary,
      createdAt: current.createdAt.toISOString(),
      createdByUserId: current.createdByUserId,
      createdByName: createdByName(current),
      isCurrent: true,
    };
  }

  const [archived] = await db
    .select({
      revisionId: schema.workspaceAutomationMemoryRevisions.id,
      version: schema.workspaceAutomationMemoryRevisions.version,
      content: schema.workspaceAutomationMemoryRevisions.content,
      summary: schema.workspaceAutomationMemoryRevisions.summary,
      createdAt: schema.workspaceAutomationMemoryRevisions.createdAt,
      createdByUserId: schema.workspaceAutomationMemoryRevisions.createdByUserId,
      createdByFirstName: schema.users.firstName,
      createdByLastName: schema.users.lastName,
    })
    .from(schema.workspaceAutomationMemoryRevisions)
    .leftJoin(
      schema.users,
      eq(schema.workspaceAutomationMemoryRevisions.createdByUserId, schema.users.id),
    )
    .where(
      and(
        eq(schema.workspaceAutomationMemoryRevisions.automationId, automationId),
        eq(schema.workspaceAutomationMemoryRevisions.id, revisionId),
      ),
    )
    .limit(1);

  return archived
    ? {
        revisionId: archived.revisionId,
        version: archived.version,
        content: archived.content,
        summary: archived.summary,
        createdAt: archived.createdAt.toISOString(),
        createdByUserId: archived.createdByUserId,
        createdByName: createdByName(archived),
        isCurrent: false,
      }
    : null;
}

export async function getWorkspaceAutomationMemoryRevision(input: {
  automationId: string;
  revisionId: string;
}): Promise<{
  workspaceAutomationMemoryRevision: WorkspaceAutomationMemoryRevision;
  previousWorkspaceAutomationMemoryRevision: WorkspaceAutomationMemoryRevision | null;
} | null> {
  const workspaceAutomationMemoryRevision = await findWorkspaceAutomationMemoryRevision(
    input.automationId,
    input.revisionId,
  );

  if (!workspaceAutomationMemoryRevision) {
    return null;
  }

  if (workspaceAutomationMemoryRevision.version === 1) {
    return { workspaceAutomationMemoryRevision, previousWorkspaceAutomationMemoryRevision: null };
  }

  const [previous] = await db
    .select({
      revisionId: schema.workspaceAutomationMemoryRevisions.id,
      version: schema.workspaceAutomationMemoryRevisions.version,
      content: schema.workspaceAutomationMemoryRevisions.content,
      summary: schema.workspaceAutomationMemoryRevisions.summary,
      createdAt: schema.workspaceAutomationMemoryRevisions.createdAt,
      createdByUserId: schema.workspaceAutomationMemoryRevisions.createdByUserId,
      createdByFirstName: schema.users.firstName,
      createdByLastName: schema.users.lastName,
    })
    .from(schema.workspaceAutomationMemoryRevisions)
    .leftJoin(
      schema.users,
      eq(schema.workspaceAutomationMemoryRevisions.createdByUserId, schema.users.id),
    )
    .where(
      and(
        eq(schema.workspaceAutomationMemoryRevisions.automationId, input.automationId),
        eq(
          schema.workspaceAutomationMemoryRevisions.version,
          workspaceAutomationMemoryRevision.version - 1,
        ),
      ),
    )
    .limit(1);

  const previousWorkspaceAutomationMemoryRevision = previous
    ? {
        revisionId: previous.revisionId,
        version: previous.version,
        content: previous.content,
        summary: previous.summary,
        createdAt: previous.createdAt.toISOString(),
        createdByUserId: previous.createdByUserId,
        createdByName: createdByName(previous),
        isCurrent: false,
      }
    : null;

  return { workspaceAutomationMemoryRevision, previousWorkspaceAutomationMemoryRevision };
}

export async function restoreWorkspaceAutomationMemoryRevision(input: {
  automationId: string;
  organizationId: string;
  revisionId: string;
  restoredByUserId: string;
  expectedRevisionId: string | null;
}): Promise<Result<WorkspaceAutomationMemoryCommitResult, WorkspaceAutomationMemoryRestoreError>> {
  const revision = await findWorkspaceAutomationMemoryRevision(
    input.automationId,
    input.revisionId,
  );
  if (!revision) {
    return err({ code: "revision_not_found" });
  }

  return commitWorkspaceAutomationMemory({
    automationId: input.automationId,
    organizationId: input.organizationId,
    content: revision.content,
    summary: `Restored version ${revision.version}`,
    updatedByUserId: input.restoredByUserId,
    expectedRevisionId: input.expectedRevisionId,
    forceNewRevision: true,
  });
}
