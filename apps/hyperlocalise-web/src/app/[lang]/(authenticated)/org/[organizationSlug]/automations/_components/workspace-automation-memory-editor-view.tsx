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
import { useState } from "react";
import Link from "next/link";
import { FloppyDiskIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { HistoryIcon } from "lucide-react";
import { FormattedMessage, useIntl } from "react-intl";

import type { WorkspaceAutomationMemoryRecordDto } from "@/api/routes/workspace-automation/workspace-automation-memory.schema";
import { MarkdownEditor } from "@/components/markdown-editor/markdown-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { WORKSPACE_AUTOMATION_MEMORY_SUMMARY_MAX_LENGTH } from "@/lib/workspace-automation-memory/workspace-automation-memory.shared";
import { cn } from "@/lib/primitives/cn";

import { workspaceAutomationMemoryEditorMessages } from "./workspace-automation-memory-editor.messages";

function formatUpdatedAt(value: string | null, notSavedYet: string) {
  if (!value) {
    return notSavedYet;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(value));
}

export type WorkspaceAutomationMemoryEditorViewProps = {
  content: string;
  onContentChange: (value: string) => void;
  summary: string;
  onSummaryChange: (value: string) => void;
  includeOrgKnowledge: boolean;
  onIncludeOrgKnowledgeChange: (value: boolean) => void;
  organizationSlug: string;
  savedWorkspaceAutomationMemory: WorkspaceAutomationMemoryRecordDto | null;
  characterCount: number;
  characterLimit: number;
  isOverLimit: boolean;
  hasChanges: boolean;
  canSave: boolean;
  canUpdateWorkspaceAutomationMemory: boolean;
  isLoading: boolean;
  isSaving: boolean;
  onOpenHistory: () => void;
  onSubmit: () => Promise<void>;
};

export function WorkspaceAutomationMemoryEditorView({
  content,
  onContentChange,
  summary,
  onSummaryChange,
  includeOrgKnowledge,
  onIncludeOrgKnowledgeChange,
  organizationSlug,
  savedWorkspaceAutomationMemory,
  characterCount,
  characterLimit,
  isOverLimit,
  hasChanges,
  canSave,
  canUpdateWorkspaceAutomationMemory,
  isLoading,
  isSaving,
  onOpenHistory,
  onSubmit,
}: WorkspaceAutomationMemoryEditorViewProps) {
  const intl = useIntl();
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="flex min-h-[24rem] items-center justify-center text-muted-foreground">
        <Spinner />
      </div>
    );
  }

  return (
    <>
      <section className="flex min-h-[24rem] flex-col">
        <div className="flex flex-wrap items-center justify-end gap-3 py-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              <FormattedMessage
                {...workspaceAutomationMemoryEditorMessages.lastUpdated}
                values={{
                  timestamp: formatUpdatedAt(
                    savedWorkspaceAutomationMemory?.updatedAt ?? null,
                    intl.formatMessage(workspaceAutomationMemoryEditorMessages.notSavedYet),
                  ),
                }}
              />
            </span>
            {savedWorkspaceAutomationMemory?.version ? (
              <>
                <span aria-hidden>·</span>
                <span>
                  <FormattedMessage
                    {...workspaceAutomationMemoryEditorMessages.version}
                    values={{ version: savedWorkspaceAutomationMemory.version }}
                  />
                </span>
              </>
            ) : null}
          </div>
        </div>
        <Separator />

        <div className="flex flex-1 flex-col">
          <Field data-invalid={isOverLimit} className="flex-1 gap-2">
            <MarkdownEditor
              value={content}
              onChange={onContentChange}
              disabled={!canUpdateWorkspaceAutomationMemory}
              chrome="minimal"
              ariaLabel={intl.formatMessage(
                workspaceAutomationMemoryEditorMessages.memoryAriaLabel,
              )}
              placeholder={intl.formatMessage(
                workspaceAutomationMemoryEditorMessages.memoryPlaceholder,
              )}
              className={cn(
                "px-1 py-6",
                "[&_.tiptap]:min-h-[16rem] [&_.tiptap]:text-[15px] [&_.tiptap]:leading-7",
              )}
            />
            {isOverLimit ? (
              <FieldError>
                <FormattedMessage
                  {...workspaceAutomationMemoryEditorMessages.overLimitError}
                  values={{ limit: characterLimit }}
                />
              </FieldError>
            ) : null}
          </Field>

          <Separator />
          <label className="flex items-center gap-2 py-3 text-sm text-foreground">
            <Switch
              checked={includeOrgKnowledge}
              disabled={!canUpdateWorkspaceAutomationMemory}
              onCheckedChange={onIncludeOrgKnowledgeChange}
            />
            <FormattedMessage
              {...workspaceAutomationMemoryEditorMessages.includeOrgKnowledgeLabel}
            />
          </label>
          {/* Manage used to open the org Knowledge editor; it now opens this one. Name the scope
              and keep a route back, so the org-level document is still one click away. */}
          <p className="pb-3 text-xs text-muted-foreground">
            <FormattedMessage
              {...workspaceAutomationMemoryEditorMessages.includeOrgKnowledgeHint}
              values={{
                link: (chunks) => (
                  <Link href={`/org/${organizationSlug}/knowledge`} className="underline">
                    {chunks}
                  </Link>
                ),
              }}
            />
          </p>

          <Separator />
          <div className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>
                <FormattedMessage
                  {...workspaceAutomationMemoryEditorMessages.characterCount}
                  values={{ count: characterCount, limit: characterLimit }}
                />
              </span>
              <span aria-hidden>·</span>
              <span className={cn(hasChanges && "text-foreground")}>
                <FormattedMessage
                  {...(hasChanges
                    ? workspaceAutomationMemoryEditorMessages.unsavedChanges
                    : workspaceAutomationMemoryEditorMessages.changesSaved)}
                />
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={onOpenHistory}>
                <HistoryIcon data-icon="inline-start" />
                <FormattedMessage {...workspaceAutomationMemoryEditorMessages.history} />
              </Button>
              {canUpdateWorkspaceAutomationMemory ? (
                <Button type="button" disabled={!canSave} onClick={() => setSaveDialogOpen(true)}>
                  <HugeiconsIcon icon={FloppyDiskIcon} strokeWidth={1.8} data-icon="inline-start" />
                  {isSaving ? (
                    <FormattedMessage {...workspaceAutomationMemoryEditorMessages.committing} />
                  ) : (
                    <FormattedMessage {...workspaceAutomationMemoryEditorMessages.commitChanges} />
                  )}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <form
            className="flex flex-col gap-6"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await onSubmit();
                setSaveDialogOpen(false);
              } catch {
                // The mutation reports the error and leaves the dialog open for retry.
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>
                <FormattedMessage {...workspaceAutomationMemoryEditorMessages.saveDialogTitle} />
              </DialogTitle>
              <DialogDescription>
                <FormattedMessage
                  {...workspaceAutomationMemoryEditorMessages.saveDialogDescription}
                />
              </DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="workspace-automation-memory-summary">
                <FormattedMessage {...workspaceAutomationMemoryEditorMessages.versionNoteLabel} />
              </FieldLabel>
              <Input
                id="workspace-automation-memory-summary"
                value={summary}
                maxLength={WORKSPACE_AUTOMATION_MEMORY_SUMMARY_MAX_LENGTH}
                autoFocus
                onChange={(event) => onSummaryChange(event.target.value)}
                placeholder={intl.formatMessage(
                  workspaceAutomationMemoryEditorMessages.versionNotePlaceholder,
                )}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSaveDialogOpen(false)}>
                <FormattedMessage {...workspaceAutomationMemoryEditorMessages.cancel} />
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? (
                  <FormattedMessage {...workspaceAutomationMemoryEditorMessages.committing} />
                ) : (
                  <FormattedMessage {...workspaceAutomationMemoryEditorMessages.saveVersion} />
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
