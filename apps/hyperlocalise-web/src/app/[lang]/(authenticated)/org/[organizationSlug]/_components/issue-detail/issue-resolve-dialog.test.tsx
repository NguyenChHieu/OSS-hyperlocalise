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
// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntlProvider } from "react-intl";
import { describe, expect, it, vi } from "vite-plus/test";

import { IssueResolveDialog, type IssueResolveSubmitInput } from "./issue-resolve-dialog";
import type { AssignableIssueMember } from "./use-assignable-issue-members";

const verifier: AssignableIssueMember = {
  userId: "user_verifier",
  workosUserId: "workos_verifier",
  email: "verifier@example.com",
  firstName: "Vera",
  lastName: "Fier",
  displayName: "Vera Fier",
  avatarUrl: null,
  isCurrentUser: false,
};

function renderDialog(props: {
  currentVerifierUserId: string | null;
  onSubmit: (input: IssueResolveSubmitInput) => void;
}) {
  return render(
    <IntlProvider locale="en" messages={{}}>
      <IssueResolveDialog
        open
        onOpenChange={() => {}}
        members={[verifier]}
        membersLoading={false}
        isSubmitting={false}
        currentVerifierUserId={props.currentVerifierUserId}
        onSubmit={props.onSubmit}
      />
    </IntlProvider>,
  );
}

describe("IssueResolveDialog", () => {
  it("retains an already-designated verifier when resolving without touching the picker", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderDialog({ currentVerifierUserId: verifier.userId, onSubmit });

    await user.click(screen.getByLabelText("Fixed"));
    await user.click(screen.getByRole("button", { name: "Resolve" }));

    expect(onSubmit).toHaveBeenCalledWith({
      status: "resolved",
      resolutionReason: "fixed",
      verifierUserId: verifier.userId,
    });
  });

  it("hides the verifier picker and omits verifierUserId when choosing won't fix", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderDialog({ currentVerifierUserId: verifier.userId, onSubmit });

    await user.click(screen.getByLabelText("Won’t fix"));
    expect(screen.queryByText("Vera Fier")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Resolve" }));

    expect(onSubmit).toHaveBeenCalledWith({ status: "wont_fix" });
  });
});
