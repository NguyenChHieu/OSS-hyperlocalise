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

export const issueReopenControlMessages = defineMessages({
  trigger: {
    defaultMessage: "Reopen",
    id: "WBRMllcHTB",
    description: "Button to reopen a closed issue",
  },
  commentPlaceholder: {
    defaultMessage: "Optional: why is this being reopened?",
    id: "d7v+0NtwTZ",
    description: "Placeholder for the optional reopen comment field",
  },
  confirm: {
    defaultMessage: "Reopen issue",
    id: "Q6BY7lkg1K",
    description: "Button to confirm reopening an issue",
  },
});
