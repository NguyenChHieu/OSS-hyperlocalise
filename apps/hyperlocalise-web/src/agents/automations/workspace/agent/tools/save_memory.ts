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
import { z } from "zod";

import { defineAgentTool } from "@/agents/_runtime/define-agent-tool";
import { hasWorkspaceAutomationKnowledgeUpdatesAllowed } from "@/lib/agents/workspace-automations";
import {
  commitKnowledgeMemoryForOrganization,
  getKnowledgeMemoryForOrganization,
} from "@/lib/knowledge-memory/knowledge-memory";
import { KNOWLEDGE_MEMORY_CONTENT_MAX_LENGTH } from "@/lib/knowledge-memory/knowledge-memory.shared";
import { isErr } from "@/lib/primitives/result/results";

import type { WorkspaceOrchestratorSession } from "../context";

/**
 * Appends to the organization's shared Memory.md. Append-only by design (MVP): the agent cannot
 * edit, replace, or delete existing content, only add to it. Gated on both `knowledge.enabled`
 * ("Use organization memory") and `knowledge.allowUpdates` ("Allow memory updates") — the second
 * is meaningless without the first, enforced by hasWorkspaceAutomationKnowledgeUpdatesAllowed.
 * This goes through the same commit path (and the same optimistic concurrency) as a human editing
 * Memory.md by hand, so every append is a normal, restorable revision.
 */
export function createSaveMemoryTool(session: WorkspaceOrchestratorSession) {
  return defineAgentTool({
    description:
      "Append a new entry to the organization's shared Memory.md. Append-only: this cannot edit, replace, or delete existing content. Use only when the automation's own instructions say to remember something.",
    inputSchema: z.object({
      entry: z.string().trim().min(1),
    }),
    execute: async ({ entry }) => {
      if (!hasWorkspaceAutomationKnowledgeUpdatesAllowed(session.automation.toolConfig)) {
        throw new Error("memory_updates_not_allowed");
      }

      const current = await getKnowledgeMemoryForOrganization(session.organizationId);
      const trimmedEntry = entry.trim();
      const appended = current.content ? `${current.content}\n\n${trimmedEntry}` : trimmedEntry;

      if (appended.length > KNOWLEDGE_MEMORY_CONTENT_MAX_LENGTH) {
        throw new Error("memory_size_limit_exceeded");
      }

      const result = await commitKnowledgeMemoryForOrganization({
        organizationId: session.organizationId,
        content: appended,
        // No human actor for an agent-authored append; real provenance lives here instead of
        // updatedByUserId, which is nullable for exactly this case.
        summary: `Auto-appended by automation "${session.automation.name}" (run ${session.run.id})`,
        updatedByUserId: null,
        expectedRevisionId: current.revisionId,
      });

      if (isErr(result)) {
        throw new Error("memory_stale_revision");
      }

      // Never persist the appended text itself into stepResults/output_summary — matches the
      // repo's no-content-in-logs rule (AGENTS.md) and the handoff's explicit ask.
      const payload = {
        appended: true,
        revisionId: result.value.knowledgeMemory.revisionId,
      };
      session.stepResults.save_memory = payload;
      return payload;
    },
  });
}
