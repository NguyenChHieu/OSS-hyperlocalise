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
import { defineMessages } from "react-intl";

export const issueResolveDialogMessages = defineMessages({
  title: {
    defaultMessage: "Resolve issue",
    id: "lCdsvUXym9",
    description: "Title for the resolve issue dialog",
  },
  description: {
    defaultMessage: "Choose why this issue is being closed.",
    id: "7CDxty9Htq",
    description: "Description for the resolve issue dialog",
  },
  reasonRequired: {
    defaultMessage: "Choose a reason to continue.",
    id: "HAi/YN7JQM",
    description: "Validation message when no resolution reason is selected",
  },
  verifierLabel: {
    defaultMessage: "Verifier (optional)",
    id: "WDkCGhxyei",
    description: "Label for the optional verifier field in the resolve dialog",
  },
  verifierHint: {
    defaultMessage: "Designating a verifier requires their sign-off before this is fully closed.",
    id: "2ETvWhx9sk",
    description: "Hint explaining what designating a verifier does",
  },
  verifierTrigger: {
    defaultMessage: "Select verifier",
    id: "kKn1tu+l6e",
    description: "Accessible label for the verifier picker trigger in the resolve dialog",
  },
  verifierUnassigned: {
    defaultMessage: "No verifier",
    id: "LrX5ESJJsf",
    description: "Verifier picker option for closing without requesting verification",
  },
  cancel: {
    defaultMessage: "Cancel",
    id: "gVbYWfwRTk",
    description: "Button to cancel the resolve dialog",
  },
  submit: {
    defaultMessage: "Resolve",
    id: "Dvy0YHP/F+",
    description: "Button to submit the resolve dialog",
  },
  submitting: {
    defaultMessage: "Resolving…",
    id: "gA9BxXjQOW",
    description: "Submit button label while the resolve request is in flight",
  },
});
