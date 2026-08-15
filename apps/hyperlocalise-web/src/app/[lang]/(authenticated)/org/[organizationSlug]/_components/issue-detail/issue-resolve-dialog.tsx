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
import { useEffect, useState } from "react";
import { FormattedMessage, useIntl } from "react-intl";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { TypographyMuted } from "@/components/ui/typography";
import { cn } from "@/lib/primitives/cn";

import { IssueAssigneePicker } from "./issue-assignee-picker";
import {
  issueResolutionReasonValues,
  issueResolutionReasonLabel,
  type IssueResolutionReasonValue,
} from "./issue-detail-utils";
import { issueResolveDialogMessages as messages } from "./issue-resolve-dialog.messages";
import { issueSheetSharedMessages as sharedMessages } from "../../projects/[projectId]/issue-sheet/_components/issue-sheet-shared.messages";
import type { AssignableIssueMember } from "./use-assignable-issue-members";

/** The five choices the ticket specifies. "Won't fix" is the wont_fix status, not a reason
 * value — see issue-status-transitions.ts. */
type ResolveChoice = IssueResolutionReasonValue | "wont_fix";

const RESOLVE_CHOICES: ResolveChoice[] = [...issueResolutionReasonValues, "wont_fix"];

export type IssueResolveSubmitInput =
  | {
      status: "resolved";
      resolutionReason: IssueResolutionReasonValue;
      verifierUserId: string | null;
    }
  | { status: "wont_fix"; verifierUserId: string | null };

export type IssueResolveDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: AssignableIssueMember[];
  membersLoading: boolean;
  isSubmitting: boolean;
  onSubmit: (input: IssueResolveSubmitInput) => void;
};

const verifierPickerLabels = {
  unassigned: messages.verifierUnassigned,
  triggerAria: messages.verifierTrigger,
};

export function IssueResolveDialog({
  open,
  onOpenChange,
  members,
  membersLoading,
  isSubmitting,
  onSubmit,
}: IssueResolveDialogProps) {
  const intl = useIntl();
  const [choice, setChoice] = useState<ResolveChoice | null>(null);
  const [verifierUserId, setVerifierUserId] = useState<string | null>(null);
  const [showValidation, setShowValidation] = useState(false);

  useEffect(() => {
    if (!open) {
      // Reset once the close animation finishes, not immediately, so the dialog doesn't visibly
      // blank out while it's still closing.
      const timeout = setTimeout(() => {
        setChoice(null);
        setVerifierUserId(null);
        setShowValidation(false);
      }, 200);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [open]);

  const handleSubmit = () => {
    if (!choice) {
      setShowValidation(true);
      return;
    }
    onSubmit(
      choice === "wont_fix"
        ? { status: "wont_fix", verifierUserId }
        : { status: "resolved", resolutionReason: choice, verifierUserId },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <FormattedMessage {...messages.title} />
          </DialogTitle>
          <DialogDescription>
            <FormattedMessage {...messages.description} />
          </DialogDescription>
        </DialogHeader>

        <fieldset className="grid gap-2" disabled={isSubmitting}>
          {RESOLVE_CHOICES.map((value) => {
            const inputId = `issue-resolve-choice-${value}`;
            const label =
              value === "wont_fix"
                ? intl.formatMessage(sharedMessages.statusWontFix)
                : issueResolutionReasonLabel(intl, value);
            return (
              <div
                key={value}
                className={cn(
                  "flex items-center gap-2 rounded-lg border border-border px-3 py-2 has-[:checked]:border-primary has-[:checked]:bg-primary/5",
                )}
              >
                <input
                  type="radio"
                  id={inputId}
                  name="issue-resolve-choice"
                  value={value}
                  checked={choice === value}
                  onChange={() => {
                    setChoice(value);
                    setShowValidation(false);
                  }}
                  className="size-4"
                />
                <Label htmlFor={inputId} className="flex-1 cursor-pointer font-normal">
                  {label}
                </Label>
              </div>
            );
          })}
        </fieldset>
        {showValidation ? (
          <TypographyMuted className="text-destructive">
            <FormattedMessage {...messages.reasonRequired} />
          </TypographyMuted>
        ) : null}

        <div className="grid gap-1.5">
          <Label>
            <FormattedMessage {...messages.verifierLabel} />
          </Label>
          <IssueAssigneePicker
            value={verifierUserId}
            onChange={setVerifierUserId}
            members={members}
            isLoading={membersLoading}
            disabled={isSubmitting}
            labels={verifierPickerLabels}
          />
          <TypographyMuted>
            <FormattedMessage {...messages.verifierHint} />
          </TypographyMuted>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            <FormattedMessage {...messages.cancel} />
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
            <FormattedMessage {...(isSubmitting ? messages.submitting : messages.submit)} />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
