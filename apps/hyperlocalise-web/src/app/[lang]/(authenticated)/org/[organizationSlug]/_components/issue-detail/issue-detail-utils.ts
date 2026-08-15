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
import type { IntlShape } from "react-intl";

import { issueSheetSharedMessages as sharedMessages } from "../../projects/[projectId]/issue-sheet/_components/issue-sheet-shared.messages";
import {
  issueTypeValues,
  type IssueTypeValue,
} from "../../projects/[projectId]/issue-sheet/_components/issue-sheet-constants";

export const issueStatusValues = [
  "open",
  "in_progress",
  "awaiting_verification",
  "resolved",
  "verified",
  "wont_fix",
] as const;
export type IssueStatusValue = (typeof issueStatusValues)[number];

export const issueResolutionReasonValues = [
  "fixed",
  "source_updated",
  "duplicate",
  "not_reproducible",
] as const;
export type IssueResolutionReasonValue = (typeof issueResolutionReasonValues)[number];

export const issuePriorityValues = ["P0", "P1", "P2"] as const;
export type IssuePriorityValue = (typeof issuePriorityValues)[number];

export const issueLinkKindValues = [
  "cat_segment",
  "native_issue",
  "provider_issue",
  "agent_run",
  "url",
  "manual",
] as const;
export type IssueLinkKindValue = (typeof issueLinkKindValues)[number];

export type IssueDetailIssue = {
  id: string;
  title: string;
  description: string;
  issueType: string;
  status: string;
  targetLocale: string | null;
  sourcePath: string | null;
  segmentId: string | null;
  translationKeyId: string | null;
  linkedCommentId: string | null;
  linkedAgentRunId: string | null;
  linkKind: string | null;
  linkLabel: string | null;
  linkUrl: string | null;
  // Which static issue template (if any) prefilled this issue at creation. Provenance only, may
  // reference a template key that no longer exists — render through issueSheetTemplateLabel,
  // which falls back to a formatted version of the raw key.
  templateKey: string | null;
  assigneeUserId: string | null;
  reporter: string | null;
  assignee: string | null;
  key: string | null;
  sourceText: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolutionReason: string | null;
  resolvedByUserId: string | null;
  verifierUserId: string | null;
  verifiedAt: string | null;
  verifiedByUserId: string | null;
  values: Record<string, unknown>;
  isWatching: boolean;
};

function formatUnknownLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// Record<IssueStatusValue, ...> makes this compile-enforced: adding a status to
// issueStatusValues without adding it here is a type error, not a silent fallback.
const STATUS_MESSAGE: Record<IssueStatusValue, keyof typeof sharedMessages> = {
  open: "statusOpen",
  in_progress: "statusInProgress",
  awaiting_verification: "statusAwaitingVerification",
  resolved: "statusResolved",
  verified: "statusVerified",
  wont_fix: "statusWontFix",
};

export function issueStatusLabel(intl: IntlShape, status: string) {
  const key = STATUS_MESSAGE[status as IssueStatusValue];
  if (!key) {
    return formatUnknownLabel(status);
  }
  return intl.formatMessage(sharedMessages[key]);
}

// wont_fix has no reason value of its own; the status itself is self-describing.
const RESOLUTION_REASON_MESSAGE: Record<
  IssueResolutionReasonValue | "unspecified",
  keyof typeof sharedMessages
> = {
  fixed: "resolutionReasonFixed",
  source_updated: "resolutionReasonSourceUpdated",
  duplicate: "resolutionReasonDuplicate",
  not_reproducible: "resolutionReasonNotReproducible",
  unspecified: "resolutionReasonUnspecified",
};

export function issueResolutionReasonLabel(intl: IntlShape, reason: string) {
  const key = RESOLUTION_REASON_MESSAGE[reason as IssueResolutionReasonValue | "unspecified"];
  if (!key) {
    return formatUnknownLabel(reason);
  }
  return intl.formatMessage(sharedMessages[key]);
}

export function issueTypeLabel(intl: IntlShape, value: string) {
  switch (value as IssueTypeValue) {
    case "general_question":
      return intl.formatMessage(sharedMessages.issueTypeGeneralQuestion);
    case "translation_mistake":
      return intl.formatMessage(sharedMessages.issueTypeTranslationMistake);
    case "context_request":
      return intl.formatMessage(sharedMessages.issueTypeContextRequest);
    case "source_mistake":
      return intl.formatMessage(sharedMessages.issueTypeSourceMistake);
    case "glossary_violation":
      return intl.formatMessage(sharedMessages.issueTypeGlossaryViolation);
    case "qa_failure":
      return intl.formatMessage(sharedMessages.issueTypeQaFailure);
    default:
      return formatUnknownLabel(value);
  }
}

const STATUS_VARIANT: Record<IssueStatusValue, "success" | "outline" | "warning" | "secondary"> = {
  open: "secondary",
  in_progress: "warning",
  awaiting_verification: "warning",
  resolved: "success",
  verified: "success",
  wont_fix: "outline",
};

export function issueStatusVariant(status: string) {
  return STATUS_VARIANT[status as IssueStatusValue] ?? "secondary";
}

/**
 * Legal values for the plain status dropdown, given the current status. Closing
 * (resolved/wont_fix) and verifying stay reachable from the dropdown, but selecting a closing
 * value must route through the resolve dialog rather than firing the mutation directly (see
 * issue-detail-panel.tsx) — the dialog is what actually collects the required reason. Once
 * closed, only the dedicated Reopen control can move an issue, not this dropdown, since reopen
 * takes an optional comment the dropdown has no room for. `awaiting_verification` is never a
 * directly selectable value; it's a consequence of closing with a verifier designated.
 */
export function issueDetailLegalDropdownStatuses(current: string): IssueStatusValue[] {
  if (current === "open" || current === "in_progress") {
    return ["open", "in_progress", "resolved", "wont_fix"];
  }
  if (current === "awaiting_verification") {
    return ["awaiting_verification", "verified"];
  }
  return [current as IssueStatusValue];
}

export function issuePriorityVariant(priority: string) {
  switch (priority as IssuePriorityValue) {
    case "P0":
      return "destructive" as const;
    case "P1":
      return "warning" as const;
    case "P2":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

export function linkKindLabel(intl: IntlShape, value: string) {
  switch (value as IssueLinkKindValue) {
    case "cat_segment":
      return intl.formatMessage(sharedMessages.linkKindCatSegment);
    case "native_issue":
      return intl.formatMessage(sharedMessages.linkKindNativeIssue);
    case "provider_issue":
      return intl.formatMessage(sharedMessages.linkKindProviderIssue);
    case "agent_run":
      return intl.formatMessage(sharedMessages.linkKindAgentRun);
    case "url":
      return intl.formatMessage(sharedMessages.linkKindUrl);
    case "manual":
      return intl.formatMessage(sharedMessages.linkKindManual);
    default:
      return formatUnknownLabel(value);
  }
}

export function buildIssueCatHref(
  organizationSlug: string,
  projectId: string,
  issue: Pick<IssueDetailIssue, "sourcePath" | "targetLocale" | "segmentId">,
) {
  if (!issue.sourcePath || !issue.targetLocale) {
    return null;
  }
  const params = new URLSearchParams({
    sourcePath: issue.sourcePath,
    locale: issue.targetLocale,
  });
  if (issue.segmentId) {
    params.set("segment", issue.segmentId);
  }
  return `/org/${organizationSlug}/projects/${encodeURIComponent(projectId)}/files/cat?${params.toString()}`;
}

export function isHttpOrHttpsUrl(url: string) {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function isExternalHttpUrl(url: string) {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const parsed = new URL(url);
    return isHttpOrHttpsUrl(url) && parsed.origin !== window.location.origin;
  } catch {
    return false;
  }
}

export function buildIssueDetailHref({
  organizationSlug,
  projectId,
  issueId,
}: {
  organizationSlug: string;
  projectId: string;
  issueId: string;
}) {
  return `/org/${encodeURIComponent(organizationSlug)}/projects/${encodeURIComponent(projectId)}/issue-sheet/${encodeURIComponent(issueId)}`;
}

const ISSUE_BREADCRUMB_TITLE_MAX_LENGTH = 72;

export function truncateIssueTitleForBreadcrumb(
  title: string,
  maxLength = ISSUE_BREADCRUMB_TITLE_MAX_LENGTH,
) {
  const trimmed = title.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function issueSheetApiPath(organizationSlug: string, projectId: string) {
  return `/api/orgs/${encodeURIComponent(organizationSlug)}/projects/${encodeURIComponent(projectId)}/issue-sheet`;
}

export { issueTypeValues };
export type { IssueTypeValue };
