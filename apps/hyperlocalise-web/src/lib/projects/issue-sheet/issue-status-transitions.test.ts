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
import { describe, expect, it } from "vite-plus/test";

import { isErr, isOk } from "@/lib/primitives/result/results";

import {
  assertIssueStatusTransition,
  assertVerifierReassignment,
  ISSUE_STATUSES,
  type IssueStatus,
} from "./issue-status-transitions";

const RESOLVER_ID = "11111111-1111-1111-1111-111111111111";
const VERIFIER_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_ID = "33333333-3333-3333-3333-333333333333";

// translator: write_back:translation but not teams:write (the route-level baseline, no override).
// localization_manager: holds teams:write, the manager-override role for verify/reopen/reassign.
const TRANSLATOR = "translator" as const;
const MANAGER = "localization_manager" as const;

type EdgeExpectation = {
  reasonRequired?: true;
  verifierGated?: true;
};

/**
 * Every edge the state machine allows, keyed "from->to". Anything not listed here is expected to
 * be rejected as invalid_status_transition. Mirrors the state model in the HL-501 plan, kept
 * independent of the module's private ALLOWED_EDGES so this test doesn't just echo the
 * implementation.
 */
const ALLOWED: Record<string, EdgeExpectation> = {
  "open->in_progress": {},
  "open->resolved": { reasonRequired: true },
  "open->awaiting_verification": { reasonRequired: true },
  "open->wont_fix": {},
  "in_progress->open": {},
  "in_progress->resolved": { reasonRequired: true },
  "in_progress->awaiting_verification": { reasonRequired: true },
  "in_progress->wont_fix": {},
  "awaiting_verification->verified": { verifierGated: true },
  "awaiting_verification->open": { verifierGated: true },
  "resolved->awaiting_verification": {},
  "resolved->open": {},
  "verified->open": {},
  "wont_fix->open": {},
};

const ALL_PAIRS: [IssueStatus, IssueStatus][] = ISSUE_STATUSES.flatMap((from) =>
  ISSUE_STATUSES.map((to): [IssueStatus, IssueStatus] => [from, to]),
);

describe("assertIssueStatusTransition", () => {
  it.each(ALL_PAIRS)("from %s to %s", (from, to) => {
    const expectation = ALLOWED[`${from}->${to}`];
    const baseInput = {
      from,
      to,
      actorUserId: OTHER_ID,
      actorRole: TRANSLATOR,
      verifierUserId: null,
    };

    if (!expectation) {
      const result = assertIssueStatusTransition(baseInput);
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe("invalid_status_transition");
      }
      return;
    }

    if (expectation.reasonRequired) {
      const withoutReason = assertIssueStatusTransition(baseInput);
      expect(isErr(withoutReason)).toBe(true);
      if (isErr(withoutReason)) {
        expect(withoutReason.error.code).toBe("resolution_reason_required");
      }

      const withReason = assertIssueStatusTransition({ ...baseInput, reason: "fixed" });
      expect(isOk(withReason)).toBe(true);
      return;
    }

    // Not reason-bearing: a reason must be rejected even though the transition is legal.
    const withUnexpectedReason = assertIssueStatusTransition({ ...baseInput, reason: "fixed" });
    expect(isErr(withUnexpectedReason)).toBe(true);
    if (isErr(withUnexpectedReason)) {
      expect(withUnexpectedReason.error.code).toBe("resolution_reason_not_allowed");
    }

    if (expectation.verifierGated) {
      const asStranger = assertIssueStatusTransition({ ...baseInput, verifierUserId: VERIFIER_ID });
      expect(isErr(asStranger)).toBe(true);
      if (isErr(asStranger)) {
        expect(asStranger.error.code).toBe("verification_not_permitted");
      }

      const asVerifier = assertIssueStatusTransition({
        ...baseInput,
        actorUserId: VERIFIER_ID,
        verifierUserId: VERIFIER_ID,
      });
      expect(isOk(asVerifier)).toBe(true);

      const asManager = assertIssueStatusTransition({
        ...baseInput,
        actorRole: MANAGER,
        verifierUserId: VERIFIER_ID,
      });
      expect(isOk(asManager)).toBe(true);
      return;
    }

    // Legal, no reason, no verifier gate: any actor may perform it (route-level baseline only).
    expect(isOk(assertIssueStatusTransition(baseInput))).toBe(true);
  });

  it("rejects every same-state transition", () => {
    for (const status of ISSUE_STATUSES) {
      const result = assertIssueStatusTransition({
        from: status,
        to: status,
        actorUserId: OTHER_ID,
        actorRole: TRANSLATOR,
        verifierUserId: null,
      });
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe("invalid_status_transition");
      }
    }
  });

  it("does not require reason-bearing permission for resolved -> awaiting_verification", () => {
    // Reached by designating a verifier on an already-resolved issue, not by a client-authored
    // status change, so no verifier/manager gate applies here.
    const result = assertIssueStatusTransition({
      from: "resolved",
      to: "awaiting_verification",
      actorUserId: OTHER_ID,
      actorRole: TRANSLATOR,
      verifierUserId: VERIFIER_ID,
    });
    expect(isOk(result)).toBe(true);
  });
});

describe("assertVerifierReassignment", () => {
  it("allows a no-op reassignment to the same value", () => {
    const result = assertVerifierReassignment({
      currentVerifierUserId: VERIFIER_ID,
      nextVerifierUserId: VERIFIER_ID,
      actorUserId: OTHER_ID,
      actorRole: TRANSLATOR,
    });
    expect(isOk(result)).toBe(true);
  });

  it("allows setting a verifier for the first time by any actor", () => {
    const result = assertVerifierReassignment({
      currentVerifierUserId: null,
      nextVerifierUserId: VERIFIER_ID,
      actorUserId: RESOLVER_ID,
      actorRole: TRANSLATOR,
    });
    expect(isOk(result)).toBe(true);
  });

  it("allows the current verifier to change or clear themselves", () => {
    const changed = assertVerifierReassignment({
      currentVerifierUserId: VERIFIER_ID,
      nextVerifierUserId: OTHER_ID,
      actorUserId: VERIFIER_ID,
      actorRole: TRANSLATOR,
    });
    expect(isOk(changed)).toBe(true);

    const cleared = assertVerifierReassignment({
      currentVerifierUserId: VERIFIER_ID,
      nextVerifierUserId: null,
      actorUserId: VERIFIER_ID,
      actorRole: TRANSLATOR,
    });
    expect(isOk(cleared)).toBe(true);
  });

  it("allows a teams:write holder to override an unrelated verifier", () => {
    const result = assertVerifierReassignment({
      currentVerifierUserId: VERIFIER_ID,
      nextVerifierUserId: OTHER_ID,
      actorUserId: RESOLVER_ID,
      actorRole: MANAGER,
    });
    expect(isOk(result)).toBe(true);
  });

  it("rejects an unrelated editor reassigning an existing verifier", () => {
    const result = assertVerifierReassignment({
      currentVerifierUserId: VERIFIER_ID,
      nextVerifierUserId: OTHER_ID,
      actorUserId: RESOLVER_ID,
      actorRole: TRANSLATOR,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe("verifier_reassignment_not_permitted");
    }
  });

  it("rejects an unrelated editor clearing an existing verifier", () => {
    const result = assertVerifierReassignment({
      currentVerifierUserId: VERIFIER_ID,
      nextVerifierUserId: null,
      actorUserId: RESOLVER_ID,
      actorRole: TRANSLATOR,
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe("verifier_reassignment_not_permitted");
    }
  });
});
