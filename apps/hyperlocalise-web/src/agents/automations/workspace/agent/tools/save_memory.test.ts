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
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const getKnowledgeMemoryForOrganizationMock = vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/hyperlocalise_test";
  process.env.PROVIDER_CREDENTIALS_MASTER_KEY ??= "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
  return vi.fn();
});
const commitKnowledgeMemoryForOrganizationMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/knowledge-memory/knowledge-memory", () => ({
  getKnowledgeMemoryForOrganization: getKnowledgeMemoryForOrganizationMock,
  commitKnowledgeMemoryForOrganization: commitKnowledgeMemoryForOrganizationMock,
}));

import type {
  WorkspaceAutomationRecord,
  WorkspaceAutomationRunRecord,
} from "@/lib/agents/workspace-automations";
import { KNOWLEDGE_MEMORY_CONTENT_MAX_LENGTH } from "@/lib/knowledge-memory/knowledge-memory.shared";

import type { WorkspaceOrchestratorSession } from "../context";
import { createSaveMemoryTool } from "./save_memory";

function automation(
  toolConfig: WorkspaceAutomationRecord["toolConfig"],
): WorkspaceAutomationRecord {
  return {
    id: "automation-1",
    organizationId: "org-1",
    authorUserId: null,
    status: "active",
    name: "Nightly sync",
    instructions: "Remember reviewer preferences when asked.",
    projectId: null,
    triggerConfig: { mode: "manual" },
    repositoryTarget: { kind: "none" },
    toolConfig,
    configVersion: 1,
    nextRunAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function run(): WorkspaceAutomationRunRecord {
  return {
    id: "run-1",
    automationId: "automation-1",
    organizationId: "org-1",
    triggerSource: "manual",
    status: "running",
    idempotencyKey: null,
    inputSnapshot: {},
    outputSummary: {},
    error: null,
    githubRepositoryAutomationJobId: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function session(
  toolConfig: WorkspaceAutomationRecord["toolConfig"],
): WorkspaceOrchestratorSession {
  return {
    organizationId: "org-1",
    automation: automation(toolConfig),
    run: run(),
    plan: { tools: [] },
    repository: null,
    composedInstructions: "",
    stepResults: {},
    terminalStatus: null,
    terminalError: null,
  };
}

describe("createSaveMemoryTool", () => {
  beforeEach(() => {
    getKnowledgeMemoryForOrganizationMock.mockReset();
    commitKnowledgeMemoryForOrganizationMock.mockReset();
  });

  it("is unavailable when knowledge is not enabled at all", async () => {
    const tool = createSaveMemoryTool(session({}));
    await expect(
      tool.execute!({ entry: "Remember X." }, { toolCallId: "call-1", messages: [], context: {} }),
    ).rejects.toThrow("memory_updates_not_allowed");
    expect(getKnowledgeMemoryForOrganizationMock).not.toHaveBeenCalled();
  });

  it("is unavailable when enabled but allowUpdates is false", async () => {
    const tool = createSaveMemoryTool(
      session({ knowledge: { enabled: true, allowUpdates: false } }),
    );
    await expect(
      tool.execute!({ entry: "Remember X." }, { toolCallId: "call-1", messages: [], context: {} }),
    ).rejects.toThrow("memory_updates_not_allowed");
    expect(getKnowledgeMemoryForOrganizationMock).not.toHaveBeenCalled();
  });

  it("appends to existing content without altering it, scoped to the session's organization", async () => {
    getKnowledgeMemoryForOrganizationMock.mockResolvedValue({
      revisionId: "rev-1",
      version: 1,
      content: "Existing rule one.",
      summary: "Initial version",
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedByUserId: "user-1",
    });
    commitKnowledgeMemoryForOrganizationMock.mockResolvedValue({
      ok: true,
      value: {
        knowledgeMemory: { revisionId: "rev-2", version: 2, content: "irrelevant", summary: "s" },
        changed: true,
      },
    });

    const tool = createSaveMemoryTool(
      session({ knowledge: { enabled: true, allowUpdates: true } }),
    );
    const result = await tool.execute!(
      { entry: "Reviewer for repo R is Y." },
      { toolCallId: "call-1", messages: [], context: {} },
    );

    expect(getKnowledgeMemoryForOrganizationMock).toHaveBeenCalledWith("org-1");
    expect(commitKnowledgeMemoryForOrganizationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        content: "Existing rule one.\n\nReviewer for repo R is Y.",
        expectedRevisionId: "rev-1",
        updatedByUserId: null,
      }),
    );
    expect(result).toEqual({ appended: true, revisionId: "rev-2" });
  });

  it("records provenance (automation name and run id) in the commit summary, not the content", async () => {
    getKnowledgeMemoryForOrganizationMock.mockResolvedValue({
      revisionId: null,
      version: 0,
      content: "",
      summary: null,
      updatedAt: null,
      updatedByUserId: null,
    });
    commitKnowledgeMemoryForOrganizationMock.mockResolvedValue({
      ok: true,
      value: {
        knowledgeMemory: { revisionId: "rev-1", version: 1, content: "irrelevant", summary: "s" },
        changed: true,
      },
    });

    const tool = createSaveMemoryTool(
      session({ knowledge: { enabled: true, allowUpdates: true } }),
    );
    await tool.execute!(
      { entry: "First fact." },
      { toolCallId: "call-1", messages: [], context: {} },
    );

    const commitCall = commitKnowledgeMemoryForOrganizationMock.mock.calls[0]![0];
    expect(commitCall.summary).toContain("Nightly sync");
    expect(commitCall.summary).toContain("run-1");
    expect(commitCall.content).not.toContain("Nightly sync");
  });

  it("rejects an append that would exceed the character limit without committing", async () => {
    getKnowledgeMemoryForOrganizationMock.mockResolvedValue({
      revisionId: "rev-1",
      version: 1,
      content: "x".repeat(KNOWLEDGE_MEMORY_CONTENT_MAX_LENGTH - 5),
      summary: "Initial version",
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedByUserId: "user-1",
    });

    const tool = createSaveMemoryTool(
      session({ knowledge: { enabled: true, allowUpdates: true } }),
    );
    await expect(
      tool.execute!(
        { entry: "This entry pushes the document past the limit." },
        { toolCallId: "call-1", messages: [], context: {} },
      ),
    ).rejects.toThrow("memory_size_limit_exceeded");
    expect(commitKnowledgeMemoryForOrganizationMock).not.toHaveBeenCalled();
  });

  it("surfaces a clear error on a stale revision instead of silently overwriting", async () => {
    getKnowledgeMemoryForOrganizationMock.mockResolvedValue({
      revisionId: "rev-1",
      version: 1,
      content: "Existing rule.",
      summary: "Initial version",
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedByUserId: "user-1",
    });
    commitKnowledgeMemoryForOrganizationMock.mockResolvedValue({
      ok: false,
      error: { code: "precondition_failed", current: { revisionId: "rev-2" } },
    });

    const tool = createSaveMemoryTool(
      session({ knowledge: { enabled: true, allowUpdates: true } }),
    );
    await expect(
      tool.execute!(
        { entry: "Another fact." },
        { toolCallId: "call-1", messages: [], context: {} },
      ),
    ).rejects.toThrow("memory_stale_revision");
  });

  it("never persists the appended text into stepResults", async () => {
    getKnowledgeMemoryForOrganizationMock.mockResolvedValue({
      revisionId: "rev-1",
      version: 1,
      content: "Existing rule.",
      summary: "Initial version",
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedByUserId: "user-1",
    });
    commitKnowledgeMemoryForOrganizationMock.mockResolvedValue({
      ok: true,
      value: {
        knowledgeMemory: { revisionId: "rev-2", version: 2, content: "irrelevant", summary: "s" },
        changed: true,
      },
    });

    const testSession = session({ knowledge: { enabled: true, allowUpdates: true } });
    const tool = createSaveMemoryTool(testSession);
    await tool.execute!(
      { entry: "A secret-looking fact nobody should log." },
      { toolCallId: "call-1", messages: [], context: {} },
    );

    expect(testSession.stepResults.save_memory).toEqual({ appended: true, revisionId: "rev-2" });
    expect(JSON.stringify(testSession.stepResults.save_memory)).not.toContain("secret-looking");
  });
});
