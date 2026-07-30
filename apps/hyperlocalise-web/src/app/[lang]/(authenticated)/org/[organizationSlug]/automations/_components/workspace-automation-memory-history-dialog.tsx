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
import { useMemo, useState } from "react";
import { HistoryIcon, RotateCcwIcon } from "lucide-react";
import { MultiFileDiff, type FileContents } from "@pierre/diffs/react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import type {
  WorkspaceAutomationMemoryRecordDto,
  WorkspaceAutomationMemoryRevisionDto,
  WorkspaceAutomationMemoryRevisionListResponse,
} from "@/api/routes/workspace-automation/workspace-automation-memory.schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { readApiError } from "@/lib/api-error";
import { apiClient } from "@/lib/api-client-instance";
import { cn } from "@/lib/primitives/cn";

import { parseWorkspaceAutomationMemoryPreconditionFailure } from "./workspace-automation-memory-editor-state";

const revisionPageSize = 20;

const workspaceAutomationMemoryRevisionQueryKey = (
  organizationSlug: string,
  automationId: string,
) => ["workspace-automation-memory-revisions", organizationSlug, automationId];

export type WorkspaceAutomationMemoryConflict = {
  draftContent: string;
  draftSummary?: string;
  draftIncludeOrgKnowledge: boolean;
  latestEtag: string;
  latestWorkspaceAutomationMemory: WorkspaceAutomationMemoryRecordDto;
};

function createWorkspaceAutomationMemoryDiffFiles(input: {
  previousContent: string;
  selectedContent: string;
}): { oldFile: FileContents; newFile: FileContents } {
  return {
    oldFile: {
      name: "Automation memory",
      contents: input.previousContent,
      lang: "markdown",
    },
    newFile: {
      name: "Automation memory",
      contents: input.selectedContent,
      lang: "markdown",
    },
  };
}

function formatRevisionTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function WorkspaceAutomationMemoryDiff({
  previousContent,
  selectedContent,
}: {
  previousContent: string;
  selectedContent: string;
}) {
  const { resolvedTheme } = useTheme();
  const files = createWorkspaceAutomationMemoryDiffFiles({ previousContent, selectedContent });
  const themeType = resolvedTheme === "light" ? "light" : "dark";

  return (
    <MultiFileDiff
      oldFile={files.oldFile}
      newFile={files.newFile}
      disableWorkerPool
      options={{
        diffStyle: "unified",
        overflow: "wrap",
        theme: { dark: "github-dark", light: "github-light" },
        themeType,
        lineDiffType: "word",
      }}
    />
  );
}

function WorkspaceAutomationMemoryConflictView({
  conflict,
  isCommitting,
  onCommit,
  onReload,
}: {
  conflict: WorkspaceAutomationMemoryConflict;
  isCommitting: boolean;
  onCommit: () => void;
  onReload: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-6 py-4">
        <h3 className="text-sm font-medium text-foreground">Newer changes are available</h3>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Your draft is preserved. Compare it with version{" "}
          {conflict.latestWorkspaceAutomationMemory.version}, then choose which content to keep.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-background">
        <WorkspaceAutomationMemoryDiff
          previousContent={conflict.latestWorkspaceAutomationMemory.content}
          selectedContent={conflict.draftContent}
        />
      </div>
      <DialogFooter className="border-t border-border px-6 py-4">
        <Button type="button" variant="outline" onClick={onReload}>
          Reload latest
        </Button>
        <Button type="button" disabled={isCommitting} onClick={onCommit}>
          {isCommitting ? "Committing" : "Commit draft as next version"}
        </Button>
      </DialogFooter>
    </div>
  );
}

export function WorkspaceAutomationMemoryHistoryDialog({
  organizationSlug,
  automationId,
  open,
  onOpenChange,
  canUpdateWorkspaceAutomationMemory,
  hasUnsavedChanges,
  currentEtag,
  currentRevisionId,
  conflict,
  isCommittingConflict,
  onCommitConflict,
  onReloadLatest,
  onPreconditionFailed,
  onRestored,
}: {
  organizationSlug: string;
  automationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canUpdateWorkspaceAutomationMemory: boolean;
  hasUnsavedChanges: boolean;
  currentEtag: string;
  currentRevisionId: string | null;
  conflict: WorkspaceAutomationMemoryConflict | null;
  isCommittingConflict: boolean;
  onCommitConflict: () => void;
  onReloadLatest: () => void;
  onPreconditionFailed: (
    revision: WorkspaceAutomationMemoryRevisionDto,
    workspaceAutomationMemory: WorkspaceAutomationMemoryRecordDto,
    etag: string,
  ) => void;
  onRestored: (workspaceAutomationMemory: WorkspaceAutomationMemoryRecordDto, etag: string) => void;
}) {
  const queryClient = useQueryClient();
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const [restoreRevision, setRestoreRevision] =
    useState<WorkspaceAutomationMemoryRevisionDto | null>(null);

  const revisionsQuery = useInfiniteQuery({
    queryKey: workspaceAutomationMemoryRevisionQueryKey(organizationSlug, automationId),
    initialPageParam: 0,
    enabled: open && conflict === null,
    queryFn: async ({ pageParam }) => {
      const response = await apiClient.api.orgs[":organizationSlug"].automations[
        ":automationId"
      ].memory.revisions.$get({
        param: { organizationSlug, automationId },
        query: {
          limit: String(revisionPageSize),
          ...(pageParam > 0 ? { cursor: pageParam } : {}),
        },
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Unable to load automation memory history"));
      }

      return (await response.json()) as WorkspaceAutomationMemoryRevisionListResponse;
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const revisions = useMemo(
    () =>
      revisionsQuery.data?.pages.flatMap((page) => page.workspaceAutomationMemoryRevisions) ?? [],
    [revisionsQuery.data],
  );
  const effectiveRevisionId =
    selectedRevisionId && revisions.some((revision) => revision.revisionId === selectedRevisionId)
      ? selectedRevisionId
      : (revisions[0]?.revisionId ?? null);

  const revisionQuery = useQuery({
    queryKey: [
      ...workspaceAutomationMemoryRevisionQueryKey(organizationSlug, automationId),
      "detail",
      effectiveRevisionId,
    ],
    enabled: open && conflict === null && effectiveRevisionId !== null,
    queryFn: async () => {
      if (!effectiveRevisionId) {
        throw new Error("Automation memory revision is required");
      }

      const response = await apiClient.api.orgs[":organizationSlug"].automations[
        ":automationId"
      ].memory.revisions[":revisionId"].$get({
        param: { organizationSlug, automationId, revisionId: effectiveRevisionId },
      });

      if (!response.ok) {
        throw new Error(await readApiError(response, "Unable to load automation memory revision"));
      }

      return response.json();
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (revision: WorkspaceAutomationMemoryRevisionDto) => {
      const response = await apiClient.api.orgs[":organizationSlug"].automations[
        ":automationId"
      ].memory.revisions[":revisionId"].restore.$post(
        {
          param: { organizationSlug, automationId, revisionId: revision.revisionId },
        },
        { headers: { "If-Match": currentEtag } },
      );

      if (response.status === 412) {
        const latestWorkspaceAutomationMemory = parseWorkspaceAutomationMemoryPreconditionFailure(
          await response.json(),
        );
        if (latestWorkspaceAutomationMemory) {
          return {
            kind: "stale" as const,
            workspaceAutomationMemory: latestWorkspaceAutomationMemory,
            etag: response.headers.get("etag") ?? '"0"',
          };
        }
        throw new Error("Automation memory changed after it was loaded");
      }

      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Unable to restore automation memory revision"),
        );
      }

      const body = await response.json();
      return {
        kind: "restored" as const,
        workspaceAutomationMemory: body.workspaceAutomationMemory,
        etag: response.headers.get("etag") ?? '"0"',
      };
    },
    onSuccess: async (result, revision) => {
      setRestoreRevision(null);
      if (result.kind === "stale") {
        onPreconditionFailed(revision, result.workspaceAutomationMemory, result.etag);
        return;
      }

      onRestored(result.workspaceAutomationMemory, result.etag);
      setSelectedRevisionId(result.workspaceAutomationMemory.revisionId);
      await queryClient.invalidateQueries({
        queryKey: workspaceAutomationMemoryRevisionQueryKey(organizationSlug, automationId),
      });
      toast.success(`Restored as version ${result.workspaceAutomationMemory.version}`);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const selectedDetail = revisionQuery.data?.workspaceAutomationMemoryRevision;
  const previousDetail = revisionQuery.data?.previousWorkspaceAutomationMemoryRevision;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex h-[min(85dvh,52rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
          <DialogHeader className="border-b border-border px-6 py-5 pe-14">
            <DialogTitle className="flex items-center gap-2">
              <HistoryIcon className="size-4" />
              Automation memory history
            </DialogTitle>
            <DialogDescription>
              Review saved versions, compare changes, or restore earlier memory.
            </DialogDescription>
          </DialogHeader>

          {conflict ? (
            <WorkspaceAutomationMemoryConflictView
              conflict={conflict}
              isCommitting={isCommittingConflict}
              onCommit={onCommitConflict}
              onReload={onReloadLatest}
            />
          ) : (
            <div className="grid min-h-0 flex-1 grid-rows-[minmax(10rem,auto)_1fr] md:grid-cols-[16rem_1fr] md:grid-rows-1">
              <aside className="min-h-0 overflow-y-auto border-b border-border p-3 md:border-e md:border-b-0">
                {revisionsQuery.isLoading ? (
                  <div className="flex h-32 items-center justify-center text-muted-foreground">
                    <Spinner />
                  </div>
                ) : revisions.length === 0 ? (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                    No committed versions yet.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {revisions.map((revision) => (
                      <button
                        key={revision.revisionId}
                        type="button"
                        aria-pressed={effectiveRevisionId === revision.revisionId}
                        className={cn(
                          "w-full rounded-md px-3 py-2.5 text-start transition-colors hover:bg-muted",
                          effectiveRevisionId === revision.revisionId && "bg-muted",
                        )}
                        onClick={() => setSelectedRevisionId(revision.revisionId)}
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-foreground">
                            Version {revision.version}
                          </span>
                          {revision.isCurrent ? <Badge variant="outline">Current</Badge> : null}
                        </span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {revision.summary}
                        </span>
                        <span className="mt-1 block text-xs text-muted-foreground">
                          {revision.createdByName ?? "Unknown author"} -{" "}
                          {formatRevisionTimestamp(revision.createdAt)}
                        </span>
                      </button>
                    ))}
                    {revisionsQuery.hasNextPage ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="mt-2 w-full"
                        disabled={revisionsQuery.isFetchingNextPage}
                        onClick={() => revisionsQuery.fetchNextPage()}
                      >
                        {revisionsQuery.isFetchingNextPage ? "Loading" : "Load older versions"}
                      </Button>
                    ) : null}
                  </div>
                )}
              </aside>

              <div className="flex min-h-0 flex-col">
                {revisionQuery.isLoading ? (
                  <div className="flex flex-1 items-center justify-center text-muted-foreground">
                    <Spinner />
                  </div>
                ) : selectedDetail ? (
                  <>
                    <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          Version {selectedDetail.version}: {selectedDetail.summary}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Compared with{" "}
                          {previousDetail
                            ? `version ${previousDetail.version}`
                            : "an empty document"}
                        </p>
                      </div>
                      {canUpdateWorkspaceAutomationMemory &&
                      selectedDetail.revisionId !== currentRevisionId ? (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={hasUnsavedChanges}
                          title={
                            hasUnsavedChanges
                              ? "Commit or discard your draft before restoring a version"
                              : undefined
                          }
                          onClick={() => setRestoreRevision(selectedDetail)}
                        >
                          <RotateCcwIcon className="size-4" />
                          Restore
                        </Button>
                      ) : null}
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto bg-background">
                      <WorkspaceAutomationMemoryDiff
                        previousContent={previousDetail?.content ?? ""}
                        selectedContent={selectedDetail.content}
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
                    Select a committed version to inspect its changes.
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={restoreRevision !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setRestoreRevision(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore version {restoreRevision?.version ?? ""}</AlertDialogTitle>
            <AlertDialogDescription>
              This creates a new current version with the selected content. Existing history remains
              unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoreMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!restoreRevision || restoreMutation.isPending}
              onClick={() => {
                if (restoreRevision) {
                  restoreMutation.mutate(restoreRevision);
                }
              }}
            >
              {restoreMutation.isPending ? "Restoring" : "Restore version"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
