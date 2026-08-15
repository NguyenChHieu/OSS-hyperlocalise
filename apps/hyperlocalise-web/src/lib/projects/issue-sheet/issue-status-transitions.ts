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
import { hasCapability } from "@/api/auth/policy";
import type { OrganizationMembershipRole } from "@/lib/database/types";
import { err, ok, type Result } from "@/lib/primitives/result/results";

/**
 * HL-501 issue status state machine.
 *
 *   open ⇄ in_progress ──┬────────────────────────► wont_fix        (terminal, no verification)
 *                        │
 *                        ├─ close, no verifier ───► resolved
 *                        │                              │ designate verifier
 *                        └─ close, verifier set ─► awaiting_verification ◄┘
 *                                                       │ verify
 *                                                       ▼
 *                                                    verified
 *
 *   any closed state ──reopen──► open
 *
 * Won't-fix is deliberately excluded from verification (see HL-501 plan decision 1/4): it is
 * terminal and reached directly, never via awaiting_verification.
 */
export const ISSUE_STATUSES = [
  "open",
  "in_progress",
  "awaiting_verification",
  "resolved",
  "verified",
  "wont_fix",
] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

/**
 * Client-settable resolution reasons. "won't fix" is not a reason value, it is the `wont_fix`
 * status. "unspecified" is a machine sentinel written only by CSV import / the legacy backfill
 * migration and is intentionally not part of this type — see
 * `issueSheetStoredResolutionReasonSchema` in issue-sheet.schema.ts.
 */
export const ISSUE_RESOLUTION_REASONS = [
  "fixed",
  "source_updated",
  "duplicate",
  "not_reproducible",
] as const;
export type IssueResolutionReason = (typeof ISSUE_RESOLUTION_REASONS)[number];

/** Statuses that carry a non-null `resolutionReason` column value. */
const REASON_BEARING_STATUSES = new Set<IssueStatus>(["resolved", "awaiting_verification"]);

/** Every (from, to) pair the state machine allows, independent of reason/permission checks. */
const ALLOWED_EDGES: Record<IssueStatus, ReadonlySet<IssueStatus>> = {
  open: new Set(["in_progress", "resolved", "awaiting_verification", "wont_fix"]),
  in_progress: new Set(["open", "resolved", "awaiting_verification", "wont_fix"]),
  // Reached only when a verifier is designated while the issue is already resolved; not a
  // client-authored status transition, see the service-level derivation in
  // issue-sheet-service.ts.
  resolved: new Set(["awaiting_verification", "open"]),
  awaiting_verification: new Set(["verified", "open"]),
  verified: new Set(["open"]),
  wont_fix: new Set(["open"]),
};

export type IssueStatusTransitionError =
  | { code: "invalid_status_transition" }
  | { code: "resolution_reason_required" }
  | { code: "resolution_reason_not_allowed" }
  | { code: "verification_not_permitted" };

export type IssueVerifierReassignmentError = { code: "verifier_reassignment_not_permitted" };

function isVerifierOrManager(input: {
  actorUserId: string;
  actorRole: OrganizationMembershipRole;
  verifierUserId: string | null;
}): boolean {
  if (hasCapability(input.actorRole, "teams:write")) {
    return true;
  }
  return input.verifierUserId != null && input.actorUserId === input.verifierUserId;
}

/**
 * Validates one status transition: whether the edge exists in the state machine, whether a
 * resolution reason is required/allowed for it, and (for verify / reopen-from-awaiting-
 * verification) whether the actor is the designated verifier or holds `teams:write`.
 *
 * Callers must widen the row inside the same locked `SELECT ... FOR UPDATE` used to compute
 * `from` and `verifierUserId`, so concurrent verify/reopen calls cannot both win — see
 * issue-sheet-service.ts.
 *
 * Every other permission baseline (that the actor may mutate the issue at all) is enforced by
 * the route's `isWriteBackTranslationAllowed` guard before this function is ever called; this
 * function only adds the *extra* restriction that applies to verify/reopen/reassignment.
 */
export function assertIssueStatusTransition(input: {
  from: IssueStatus;
  to: IssueStatus;
  reason?: IssueResolutionReason;
  actorUserId: string;
  actorRole: OrganizationMembershipRole;
  verifierUserId: string | null;
}): Result<void, IssueStatusTransitionError> {
  if (input.from === input.to || !ALLOWED_EDGES[input.from].has(input.to)) {
    return err({ code: "invalid_status_transition" });
  }

  const reasonRequired =
    REASON_BEARING_STATUSES.has(input.to) &&
    (input.from === "open" || input.from === "in_progress");
  if (reasonRequired && input.reason == null) {
    return err({ code: "resolution_reason_required" });
  }
  if (!reasonRequired && input.reason != null) {
    return err({ code: "resolution_reason_not_allowed" });
  }

  const needsVerifierPermission =
    input.to === "verified" || (input.to === "open" && input.from === "awaiting_verification");
  if (
    needsVerifierPermission &&
    !isVerifierOrManager({
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      verifierUserId: input.verifierUserId,
    })
  ) {
    return err({ code: "verification_not_permitted" });
  }

  return ok(undefined);
}

/**
 * Validates a `verifierUserId` field change, independent of any status transition (a verifier
 * may be designated on an open issue well before it is closed). Setting a null verifier for the
 * first time needs no extra check beyond the route's baseline mutation permission; changing or
 * clearing an already-designated verifier is restricted to the current verifier or a `teams:write`
 * holder, so an editor cannot appoint themselves and bypass review.
 */
export function assertVerifierReassignment(input: {
  currentVerifierUserId: string | null;
  nextVerifierUserId: string | null;
  actorUserId: string;
  actorRole: OrganizationMembershipRole;
}): Result<void, IssueVerifierReassignmentError> {
  if (
    input.currentVerifierUserId === input.nextVerifierUserId ||
    input.currentVerifierUserId == null ||
    hasCapability(input.actorRole, "teams:write") ||
    input.actorUserId === input.currentVerifierUserId
  ) {
    return ok(undefined);
  }
  return err({ code: "verifier_reassignment_not_permitted" });
}
