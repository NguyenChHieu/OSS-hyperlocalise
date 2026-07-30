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
import { getKnowledgeMemoryForOrganization } from "@/lib/knowledge-memory/knowledge-memory";
import { selectKnowledgeMemoryContext } from "@/lib/knowledge-memory/knowledge-memory-selection";

export async function resolveWorkspaceAutomationKnowledgeContext(input: {
  organizationId: string;
  automation: WorkspaceAutomationRecord;
  /**
   * Overrides the `toolConfig.knowledge.enabled` gate in both directions. Used when the
   * automation has its own Memory (see resolve-workspace-automation-memory.ts) — there, the
   * Memory tab's "Also include organization-wide Memory" checkbox is the authority on
   * org-knowledge inclusion (true forces it in, false forces it out), not this automation's
   * older Memories tool toggle. Leave undefined to fall back to that toggle unchanged.
   */
  includeOverride?: boolean;
}): Promise<string | null> {
  const shouldInclude =
    input.includeOverride ?? Boolean(input.automation.toolConfig.knowledge?.enabled);
  if (!shouldInclude) {
    return null;
  }

  const memory = await getKnowledgeMemoryForOrganization(input.organizationId);
  if (!memory.content.trim()) {
    return null;
  }

  const selected = selectKnowledgeMemoryContext({
    content: memory.content,
    sourceText: input.automation.instructions,
    context: input.automation.name,
  });

  const compactText = selected.compactText.trim();
  return compactText.length > 0 ? compactText : null;
}
