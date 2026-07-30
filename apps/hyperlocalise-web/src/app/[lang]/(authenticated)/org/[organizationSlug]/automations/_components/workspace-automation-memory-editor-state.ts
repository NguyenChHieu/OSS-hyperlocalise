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
import {
  workspaceAutomationMemoryRecordSchema,
  type WorkspaceAutomationMemoryRecordDto,
} from "@/api/routes/workspace-automation/workspace-automation-memory.schema";
import { WORKSPACE_AUTOMATION_MEMORY_CONTENT_MAX_LENGTH } from "@/lib/workspace-automation-memory/workspace-automation-memory.shared";

export function parseWorkspaceAutomationMemoryPreconditionFailure(
  body: unknown,
): WorkspaceAutomationMemoryRecordDto | null {
  if (
    typeof body !== "object" ||
    body === null ||
    !("details" in body) ||
    typeof body.details !== "object" ||
    body.details === null ||
    !("workspaceAutomationMemory" in body.details)
  ) {
    return null;
  }

  const result = workspaceAutomationMemoryRecordSchema.safeParse(
    body.details.workspaceAutomationMemory,
  );
  return result.success ? result.data : null;
}

export function getWorkspaceAutomationMemoryEditorState(input: {
  content: string;
  savedContent: string;
  includeOrgKnowledge: boolean;
  savedIncludeOrgKnowledge: boolean;
  canUpdateWorkspaceAutomationMemory: boolean;
  isSaving: boolean;
}) {
  const characterCount = input.content.length;
  const isOverLimit = characterCount > WORKSPACE_AUTOMATION_MEMORY_CONTENT_MAX_LENGTH;
  const hasChanges =
    input.content !== input.savedContent ||
    input.includeOrgKnowledge !== input.savedIncludeOrgKnowledge;

  return {
    characterCount,
    characterLimit: WORKSPACE_AUTOMATION_MEMORY_CONTENT_MAX_LENGTH,
    isOverLimit,
    hasChanges,
    canSave:
      input.canUpdateWorkspaceAutomationMemory && hasChanges && !isOverLimit && !input.isSaving,
  };
}

export function shouldApplyWorkspaceAutomationMemoryRefresh(input: {
  content: string;
  savedContent: string;
  includeOrgKnowledge: boolean;
  savedIncludeOrgKnowledge: boolean;
}) {
  return (
    input.content === input.savedContent &&
    input.includeOrgKnowledge === input.savedIncludeOrgKnowledge
  );
}
