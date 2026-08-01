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
import type { WorkspaceAutomationRecord } from "@/lib/agents/workspace-automations";
import { selectKnowledgeMemoryContext } from "@/lib/knowledge-memory/knowledge-memory-selection";
import { getWorkspaceAutomationMemory } from "@/lib/workspace-automation-memory/workspace-automation-memory";

export type WorkspaceAutomationMemoryContext = {
  content: string | null;
  /**
   * Whether org-wide Knowledge Memory should ALSO be included alongside this automation's own
   * Memory. Only meaningful when `content` is non-null — with no automation-specific Memory,
   * org-knowledge inclusion is governed entirely by the automation's existing
   * `toolConfig.knowledge.enabled` toggle, unchanged from today.
   */
  includeOrgKnowledge: boolean;
};

/**
 * Decides what to pass as `includeOverride` to resolveWorkspaceAutomationKnowledgeContext.
 *
 * Tri-state on purpose — `undefined` means "defer to `toolConfig.knowledge.enabled`". The
 * `includeOrgKnowledge` column defaults to `true`, so treating it as authoritative even when the
 * automation has no Memory of its own would start injecting org knowledge into automations that
 * have the legacy Memories tool switched off. See the tri-state table in
 * docs/plans/2026-07-17-automation-knowledge-memories-design.md.
 */
export function resolveOrgKnowledgeInclusion(
  memory: WorkspaceAutomationMemoryContext,
): boolean | undefined {
  return memory.content !== null ? memory.includeOrgKnowledge : undefined;
}

export async function resolveWorkspaceAutomationMemoryContext(input: {
  automation: WorkspaceAutomationRecord;
}): Promise<WorkspaceAutomationMemoryContext> {
  const memory = await getWorkspaceAutomationMemory({ automationId: input.automation.id });

  if (!memory.content.trim()) {
    return { content: null, includeOrgKnowledge: memory.includeOrgKnowledge };
  }

  const selected = selectKnowledgeMemoryContext({
    content: memory.content,
    sourceText: input.automation.instructions,
    context: input.automation.name,
  });

  const compactText = selected.compactText.trim();
  return {
    content: compactText.length > 0 ? compactText : null,
    includeOrgKnowledge: memory.includeOrgKnowledge,
  };
}
