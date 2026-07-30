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

const getWorkspaceAutomationMemoryMock = vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/hyperlocalise_test";
  process.env.PROVIDER_CREDENTIALS_MASTER_KEY ??= "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
  return vi.fn();
});
const selectKnowledgeMemoryContextMock = vi.hoisted(() => vi.fn());

import type { WorkspaceAutomationRecord } from "@/lib/agents/workspace-automations";

vi.mock("@/lib/workspace-automation-memory/workspace-automation-memory", () => ({
  getWorkspaceAutomationMemory: getWorkspaceAutomationMemoryMock,
}));

vi.mock("@/lib/knowledge-memory/knowledge-memory-selection", () => ({
  selectKnowledgeMemoryContext: selectKnowledgeMemoryContextMock,
}));

import { resolveWorkspaceAutomationMemoryContext } from "./resolve-workspace-automation-memory";

function automation(): WorkspaceAutomationRecord {
  return {
    id: "automation-1",
    organizationId: "org-1",
    authorUserId: null,
    status: "active",
    name: "Nightly sync",
    instructions: "Keep product names consistent.",
    projectId: null,
    triggerConfig: { mode: "manual" },
    repositoryTarget: { kind: "none" },
    toolConfig: {},
    configVersion: 1,
    nextRunAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("resolveWorkspaceAutomationMemoryContext", () => {
  beforeEach(() => {
    getWorkspaceAutomationMemoryMock.mockReset();
    selectKnowledgeMemoryContextMock.mockReset();
  });

  it("returns null content when the automation has no memory yet", async () => {
    getWorkspaceAutomationMemoryMock.mockResolvedValue({
      revisionId: null,
      version: 0,
      content: "",
      summary: null,
      includeOrgKnowledge: true,
      updatedAt: null,
      updatedByUserId: null,
    });

    const result = await resolveWorkspaceAutomationMemoryContext({ automation: automation() });

    expect(result).toEqual({ content: null, includeOrgKnowledge: true });
    expect(selectKnowledgeMemoryContextMock).not.toHaveBeenCalled();
  });

  it("returns compact selected content and the includeOrgKnowledge flag when memory exists", async () => {
    getWorkspaceAutomationMemoryMock.mockResolvedValue({
      revisionId: "rev-1",
      version: 1,
      content: "# Rules\nEscalate billing to #billing.",
      summary: "Add escalation rule",
      includeOrgKnowledge: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedByUserId: "user-1",
    });
    selectKnowledgeMemoryContextMock.mockReturnValue({
      compactText: "Escalate billing to #billing.",
      segments: [],
      metrics: {
        selectedMemoryCount: 1,
        selectedMemoryChars: 30,
        wholeMemoryChars: 38,
        reductionPercent: 21,
        matchedHeadingPaths: [],
        fallbackMode: "selective",
      },
    });

    const result = await resolveWorkspaceAutomationMemoryContext({ automation: automation() });

    expect(result).toEqual({
      content: "Escalate billing to #billing.",
      includeOrgKnowledge: false,
    });
    expect(selectKnowledgeMemoryContextMock).toHaveBeenCalledWith({
      content: "# Rules\nEscalate billing to #billing.",
      sourceText: "Keep product names consistent.",
      context: "Nightly sync",
    });
  });
});
