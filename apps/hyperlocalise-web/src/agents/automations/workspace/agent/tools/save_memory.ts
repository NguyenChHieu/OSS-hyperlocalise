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
import {
  KNOWLEDGE_MEMORY_CONTENT_MAX_LENGTH,
  KNOWLEDGE_MEMORY_SUMMARY_MAX_LENGTH,
} from "@/lib/knowledge-memory/knowledge-memory.shared";
import { isErr } from "@/lib/primitives/result/results";

import type { WorkspaceOrchestratorSession } from "../context";

/**
 * Builds the revision summary, truncating the automation name so the result never exceeds the
 * database's knowledge_memories_summary_length_check (160 chars). Automation names accepted by
 * the API can run well past what the fixed prefix/suffix leaves room for, and this is the only
 * write path for these revisions, so an over-length summary would fail at the database on every
 * save_memory call for that automation instead of appending the entry.
 */
export function buildSaveMemorySummary(automationName: string, runId: string): string {
  const prefix = `Auto-appended by automation "`;
  const suffix = `" (run ${runId})`;
  const maxNameLength = Math.max(
    0,
    KNOWLEDGE_MEMORY_SUMMARY_MAX_LENGTH - prefix.length - suffix.length,
  );
  const name =
    automationName.length > maxNameLength
      ? `${automationName.slice(0, Math.max(0, maxNameLength - 1))}…`
      : automationName;
  return `${prefix}${name}${suffix}`;
}

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
        summary: buildSaveMemorySummary(session.automation.name, session.run.id),
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
