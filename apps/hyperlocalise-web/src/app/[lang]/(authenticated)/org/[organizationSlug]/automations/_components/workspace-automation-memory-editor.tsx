"use client";

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
import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { WorkspaceAutomationMemoryRecordDto } from "@/api/routes/workspace-automation/workspace-automation-memory.schema";
import { readApiError } from "@/lib/api-error";
import { apiClient } from "@/lib/api-client-instance";

import {
  getWorkspaceAutomationMemoryEditorState,
  parseWorkspaceAutomationMemoryPreconditionFailure,
  shouldApplyWorkspaceAutomationMemoryRefresh,
} from "./workspace-automation-memory-editor-state";
import { WorkspaceAutomationMemoryEditorView } from "./workspace-automation-memory-editor-view";
import {
  WorkspaceAutomationMemoryHistoryDialog,
  type WorkspaceAutomationMemoryConflict,
} from "./workspace-automation-memory-history-dialog";
import {
  workspaceAutomationMemoryQueryKey,
  type LoadedWorkspaceAutomationMemory,
} from "./workspace-automation-memory-query";

export function WorkspaceAutomationMemoryEditor({
  organizationSlug,
  automationId,
  canUpdateWorkspaceAutomationMemory,
}: {
  organizationSlug: string;
  automationId: string;
  canUpdateWorkspaceAutomationMemory: boolean;
}) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [savedWorkspaceAutomationMemory, setSavedWorkspaceAutomationMemory] =
    useState<WorkspaceAutomationMemoryRecordDto | null>(null);
  const [includeOrgKnowledge, setIncludeOrgKnowledge] = useState(true);
  const [summary, setSummary] = useState("");
  const [savedEtag, setSavedEtag] = useState('"0"');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conflict, setConflict] = useState<WorkspaceAutomationMemoryConflict | null>(null);

  const workspaceAutomationMemoryQuery = useQuery({
    queryKey: workspaceAutomationMemoryQueryKey(organizationSlug, automationId),
    queryFn: async () => {
      const response = await apiClient.api.orgs[":organizationSlug"].automations[
        ":automationId"
      ].memory.$get({
        param: { organizationSlug, automationId },
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Unable to load automation memory"));
      }

      const body = await response.json();
      return {
        workspaceAutomationMemory: body.workspaceAutomationMemory,
        etag: response.headers.get("etag") ?? '"0"',
      } satisfies LoadedWorkspaceAutomationMemory;
    },
  });

  useEffect(() => {
    if (
      !workspaceAutomationMemoryQuery.data ||
      !shouldApplyWorkspaceAutomationMemoryRefresh({ content, savedContent })
    ) {
      return;
    }

    const loaded = workspaceAutomationMemoryQuery.data.workspaceAutomationMemory;
    setSavedContent(loaded.content);
    setSavedWorkspaceAutomationMemory(loaded);
    setIncludeOrgKnowledge(loaded.includeOrgKnowledge);
    setSavedEtag(workspaceAutomationMemoryQuery.data.etag);
    setSummary("");
    setConflict(null);
    setContent(loaded.content);
  }, [content, savedContent, workspaceAutomationMemoryQuery.data]);

  const applyLoadedWorkspaceAutomationMemory = useCallback(
    (workspaceAutomationMemory: WorkspaceAutomationMemoryRecordDto, etag: string) => {
      setContent(workspaceAutomationMemory.content);
      setSavedContent(workspaceAutomationMemory.content);
      setSavedWorkspaceAutomationMemory(workspaceAutomationMemory);
      setIncludeOrgKnowledge(workspaceAutomationMemory.includeOrgKnowledge);
      setSavedEtag(etag);
      setSummary("");
      setConflict(null);
      queryClient.setQueryData<LoadedWorkspaceAutomationMemory>(
        workspaceAutomationMemoryQueryKey(organizationSlug, automationId),
        { workspaceAutomationMemory, etag },
      );
    },
    [automationId, organizationSlug, queryClient],
  );

  const saveWorkspaceAutomationMemory = useMutation({
    mutationFn: async (input: {
      content: string;
      summary?: string;
      includeOrgKnowledge: boolean;
      expectedEtag: string;
    }) => {
      const response = await apiClient.api.orgs[":organizationSlug"].automations[
        ":automationId"
      ].memory.$put(
        {
          param: { organizationSlug, automationId },
          json: {
            content: input.content,
            summary: input.summary,
            includeOrgKnowledge: input.includeOrgKnowledge,
          },
        },
        { headers: { "If-Match": input.expectedEtag } },
      );

      if (response.status === 412) {
        const latestWorkspaceAutomationMemory = parseWorkspaceAutomationMemoryPreconditionFailure(
          await response.json(),
        );
        if (latestWorkspaceAutomationMemory) {
          return {
            kind: "stale" as const,
            latestWorkspaceAutomationMemory,
            latestEtag: response.headers.get("etag") ?? '"0"',
          };
        }
        throw new Error("Automation memory changed after it was loaded");
      }

      if (!response.ok) {
        throw new Error(await readApiError(response, "Unable to commit automation memory"));
      }

      const body = await response.json();
      return {
        kind: "committed" as const,
        workspaceAutomationMemory: body.workspaceAutomationMemory,
        etag: response.headers.get("etag") ?? '"0"',
      };
    },
    onSuccess: (result, input) => {
      if (result.kind === "stale") {
        setConflict({
          draftContent: input.content,
          draftSummary: input.summary,
          latestEtag: result.latestEtag,
          latestWorkspaceAutomationMemory: result.latestWorkspaceAutomationMemory,
        });
        setHistoryOpen(true);
        return;
      }

      applyLoadedWorkspaceAutomationMemory(result.workspaceAutomationMemory, result.etag);
      toast.success(`Committed version ${result.workspaceAutomationMemory.version}`);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const currentEditorState = getWorkspaceAutomationMemoryEditorState({
    content,
    savedContent,
    canUpdateWorkspaceAutomationMemory,
    isSaving: saveWorkspaceAutomationMemory.isPending,
  });

  return (
    <>
      <WorkspaceAutomationMemoryEditorView
        content={content}
        onContentChange={(value) => {
          setContent(value);
          setConflict(null);
        }}
        summary={summary}
        onSummaryChange={setSummary}
        includeOrgKnowledge={includeOrgKnowledge}
        onIncludeOrgKnowledgeChange={setIncludeOrgKnowledge}
        savedWorkspaceAutomationMemory={savedWorkspaceAutomationMemory}
        characterCount={currentEditorState.characterCount}
        characterLimit={currentEditorState.characterLimit}
        isOverLimit={currentEditorState.isOverLimit}
        hasChanges={currentEditorState.hasChanges}
        canSave={currentEditorState.canSave}
        canUpdateWorkspaceAutomationMemory={canUpdateWorkspaceAutomationMemory}
        isLoading={workspaceAutomationMemoryQuery.isLoading}
        isSaving={saveWorkspaceAutomationMemory.isPending}
        onOpenHistory={() => setHistoryOpen(true)}
        onSubmit={async () => {
          await saveWorkspaceAutomationMemory.mutateAsync({
            content,
            summary: summary.trim() || undefined,
            includeOrgKnowledge,
            expectedEtag: savedEtag,
          });
        }}
      />

      <WorkspaceAutomationMemoryHistoryDialog
        organizationSlug={organizationSlug}
        automationId={automationId}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        canUpdateWorkspaceAutomationMemory={canUpdateWorkspaceAutomationMemory}
        hasUnsavedChanges={currentEditorState.hasChanges}
        currentEtag={savedEtag}
        currentRevisionId={savedWorkspaceAutomationMemory?.revisionId ?? null}
        conflict={conflict}
        isCommittingConflict={saveWorkspaceAutomationMemory.isPending}
        onCommitConflict={() => {
          if (!conflict) {
            return;
          }
          saveWorkspaceAutomationMemory.mutate({
            content: conflict.draftContent,
            summary: conflict.draftSummary,
            includeOrgKnowledge,
            expectedEtag: conflict.latestEtag,
          });
        }}
        onReloadLatest={() => {
          if (!conflict) {
            return;
          }
          applyLoadedWorkspaceAutomationMemory(
            conflict.latestWorkspaceAutomationMemory,
            conflict.latestEtag,
          );
          setHistoryOpen(false);
        }}
        onPreconditionFailed={(revision, workspaceAutomationMemory, etag) => {
          setConflict({
            draftContent: revision.content,
            draftSummary: `Restored version ${revision.version}`,
            latestEtag: etag,
            latestWorkspaceAutomationMemory: workspaceAutomationMemory,
          });
        }}
        onRestored={(workspaceAutomationMemory, etag) => {
          applyLoadedWorkspaceAutomationMemory(workspaceAutomationMemory, etag);
        }}
      />
    </>
  );
}
