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
import "dotenv/config";

import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { createAuthTestFixture } from "@/api/test-auth.fixture";
import { createWorkspaceAutomation } from "@/lib/agents/workspace-automations";
import { db, schema } from "@/lib/database";
import { isErr, isOk } from "@/lib/primitives/result/results";

import {
  commitWorkspaceAutomationMemory,
  getWorkspaceAutomationMemory,
  setWorkspaceAutomationMemoryIncludeOrgKnowledge,
} from "./workspace-automation-memory";
import { restoreWorkspaceAutomationMemoryRevision } from "./workspace-automation-memory-revisions";

const fixture = createAuthTestFixture();

beforeAll(async () => {
  await db.$client.query("select 1");
});

afterEach(async () => {
  await fixture.cleanup();
});

async function createScope() {
  const stored = await fixture.createLocalWorkosIdentity();
  const automation = await createWorkspaceAutomation({
    organizationId: stored.organization.id,
    authorUserId: stored.user.id,
    name: "Nightly sync",
    instructions: "Keep product names consistent.",
  });
  if (isErr(automation)) {
    throw new Error(`failed to seed test automation: ${automation.error.message}`);
  }

  return {
    organizationId: stored.organization.id,
    userId: stored.user.id,
    automationId: automation.value.id,
  };
}

describe("workspace automation memory version history", () => {
  it("creates versions only when normalized content changes", async () => {
    const scope = await createScope();

    const empty = await commitWorkspaceAutomationMemory({
      ...scope,
      updatedByUserId: scope.userId,
      content: "\n\n",
      expectedRevisionId: null,
    });
    expect(isOk(empty) && empty.value.changed).toBe(false);
    expect(await getWorkspaceAutomationMemory({ automationId: scope.automationId })).toMatchObject({
      revisionId: null,
      version: 0,
      content: "",
      includeOrgKnowledge: true,
    });

    const first = await commitWorkspaceAutomationMemory({
      ...scope,
      updatedByUserId: scope.userId,
      content: "Always escalate billing issues to #billing.\n\n",
      summary: "Add escalation rule",
      expectedRevisionId: null,
    });
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) {
      return;
    }
    expect(first.value).toMatchObject({
      changed: true,
      workspaceAutomationMemory: {
        version: 1,
        content: "Always escalate billing issues to #billing.",
        summary: "Add escalation rule",
        includeOrgKnowledge: true,
      },
    });

    const noOp = await commitWorkspaceAutomationMemory({
      ...scope,
      updatedByUserId: scope.userId,
      content: "Always escalate billing issues to #billing.\n",
      summary: "This note must not create a version",
      expectedRevisionId: first.value.workspaceAutomationMemory.revisionId,
    });
    expect(isOk(noOp) && noOp.value.changed).toBe(false);

    const second = await commitWorkspaceAutomationMemory({
      ...scope,
      updatedByUserId: scope.userId,
      content: "Never touch production credentials.",
      expectedRevisionId: first.value.workspaceAutomationMemory.revisionId,
    });
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) {
      return;
    }
    expect(second.value.workspaceAutomationMemory).toMatchObject({
      version: 2,
      content: "Never touch production credentials.",
      summary: "Updated memory",
    });

    const revisions = await db
      .select({
        id: schema.workspaceAutomationMemoryRevisions.id,
        version: schema.workspaceAutomationMemoryRevisions.version,
        content: schema.workspaceAutomationMemoryRevisions.content,
      })
      .from(schema.workspaceAutomationMemoryRevisions)
      .where(eq(schema.workspaceAutomationMemoryRevisions.automationId, scope.automationId));
    expect(revisions).toEqual([
      {
        id: first.value.workspaceAutomationMemory.revisionId,
        version: 1,
        content: "Always escalate billing issues to #billing.",
      },
    ]);
  });

  it("allows only one concurrent first commit and one concurrent update", async () => {
    const scope = await createScope();

    const firstRace = await Promise.all([
      commitWorkspaceAutomationMemory({
        ...scope,
        updatedByUserId: scope.userId,
        content: "First draft",
        expectedRevisionId: null,
      }),
      commitWorkspaceAutomationMemory({
        ...scope,
        updatedByUserId: scope.userId,
        content: "Competing draft",
        expectedRevisionId: null,
      }),
    ]);
    expect(firstRace.filter(isOk)).toHaveLength(1);
    expect(firstRace.filter(isErr)).toHaveLength(1);

    const current = await getWorkspaceAutomationMemory({ automationId: scope.automationId });
    const updateRace = await Promise.all([
      commitWorkspaceAutomationMemory({
        ...scope,
        updatedByUserId: scope.userId,
        content: "Update A",
        expectedRevisionId: current.revisionId,
      }),
      commitWorkspaceAutomationMemory({
        ...scope,
        updatedByUserId: scope.userId,
        content: "Update B",
        expectedRevisionId: current.revisionId,
      }),
    ]);
    expect(updateRace.filter(isOk)).toHaveLength(1);
    expect(updateRace.filter(isErr)).toHaveLength(1);

    const winner = await getWorkspaceAutomationMemory({ automationId: scope.automationId });
    expect(winner.version).toBe(2);
    expect(["Update A", "Update B"]).toContain(winner.content);
  });

  it("restores an immutable snapshot as a new head revision", async () => {
    const scope = await createScope();
    const first = await commitWorkspaceAutomationMemory({
      ...scope,
      updatedByUserId: scope.userId,
      content: "Version one",
      expectedRevisionId: null,
    });
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) {
      return;
    }

    const second = await commitWorkspaceAutomationMemory({
      ...scope,
      updatedByUserId: scope.userId,
      content: "Version two",
      expectedRevisionId: first.value.workspaceAutomationMemory.revisionId,
    });
    expect(isOk(second)).toBe(true);
    if (!isOk(second)) {
      return;
    }

    const restored = await restoreWorkspaceAutomationMemoryRevision({
      automationId: scope.automationId,
      organizationId: scope.organizationId,
      revisionId: first.value.workspaceAutomationMemory.revisionId!,
      restoredByUserId: scope.userId,
      expectedRevisionId: second.value.workspaceAutomationMemory.revisionId,
    });
    expect(isOk(restored)).toBe(true);
    if (!isOk(restored)) {
      return;
    }

    expect(restored.value.workspaceAutomationMemory).toMatchObject({
      version: 3,
      content: "Version one",
      summary: "Restored version 1",
    });
  });

  it("sets includeOrgKnowledge independently of content commits", async () => {
    const scope = await createScope();
    const first = await commitWorkspaceAutomationMemory({
      ...scope,
      updatedByUserId: scope.userId,
      content: "Some memory content",
      expectedRevisionId: null,
    });
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) {
      return;
    }
    expect(first.value.workspaceAutomationMemory.includeOrgKnowledge).toBe(true);

    const toggled = await setWorkspaceAutomationMemoryIncludeOrgKnowledge({
      automationId: scope.automationId,
      organizationId: scope.organizationId,
      includeOrgKnowledge: false,
      expectedRevisionId: first.value.workspaceAutomationMemory.revisionId,
    });
    expect(isOk(toggled)).toBe(true);
    if (!isOk(toggled)) {
      return;
    }
    expect(toggled.value.includeOrgKnowledge).toBe(false);
    // Toggling must not create an archived revision or bump the user-visible version, but it
    // must still advance revisionId — that's the concurrency token guarding this field too.
    expect(toggled.value.version).toBe(1);
    expect(toggled.value.revisionId).not.toBe(first.value.workspaceAutomationMemory.revisionId);

    const afterToggle = await getWorkspaceAutomationMemory({ automationId: scope.automationId });
    expect(afterToggle.includeOrgKnowledge).toBe(false);
    expect(afterToggle.revisionId).toBe(toggled.value.revisionId);
  });

  it("rejects a stale includeOrgKnowledge toggle instead of silently overwriting a concurrent change", async () => {
    const scope = await createScope();
    const first = await commitWorkspaceAutomationMemory({
      ...scope,
      updatedByUserId: scope.userId,
      content: "Some memory content",
      expectedRevisionId: null,
    });
    expect(isOk(first)).toBe(true);
    if (!isOk(first)) {
      return;
    }
    const loadedRevisionId = first.value.workspaceAutomationMemory.revisionId;

    // Editor A toggles first, based on the revision both editors loaded.
    const editorA = await setWorkspaceAutomationMemoryIncludeOrgKnowledge({
      automationId: scope.automationId,
      organizationId: scope.organizationId,
      includeOrgKnowledge: false,
      expectedRevisionId: loadedRevisionId,
    });
    expect(isOk(editorA)).toBe(true);

    // Editor B still has the original (now stale) revisionId and tries to toggle it back.
    const editorB = await setWorkspaceAutomationMemoryIncludeOrgKnowledge({
      automationId: scope.automationId,
      organizationId: scope.organizationId,
      includeOrgKnowledge: true,
      expectedRevisionId: loadedRevisionId,
    });
    expect(isErr(editorB)).toBe(true);
    if (!isErr(editorB)) {
      return;
    }
    expect(editorB.error.code).toBe("precondition_failed");
    expect(editorB.error.current.includeOrgKnowledge).toBe(false);

    // Editor A's change must survive, not be silently clobbered by editor B's stale write.
    const current = await getWorkspaceAutomationMemory({ automationId: scope.automationId });
    expect(current.includeOrgKnowledge).toBe(false);
  });

  it("cascades deletion when the parent automation is deleted", async () => {
    const scope = await createScope();
    const committed = await commitWorkspaceAutomationMemory({
      ...scope,
      updatedByUserId: scope.userId,
      content: "Version one",
      expectedRevisionId: null,
    });
    expect(isOk(committed)).toBe(true);
    if (!isOk(committed)) {
      return;
    }
    const second = await commitWorkspaceAutomationMemory({
      ...scope,
      updatedByUserId: scope.userId,
      content: "Version two",
      expectedRevisionId: committed.value.workspaceAutomationMemory.revisionId,
    });
    expect(isOk(second)).toBe(true);

    await db
      .delete(schema.workspaceAutomations)
      .where(eq(schema.workspaceAutomations.id, scope.automationId));

    const headRows = await db
      .select()
      .from(schema.workspaceAutomationMemories)
      .where(eq(schema.workspaceAutomationMemories.automationId, scope.automationId));
    expect(headRows).toHaveLength(0);

    const archivedRows = await db
      .select()
      .from(schema.workspaceAutomationMemoryRevisions)
      .where(and(eq(schema.workspaceAutomationMemoryRevisions.automationId, scope.automationId)));
    expect(archivedRows).toHaveLength(0);
  });
});
