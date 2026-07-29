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

export const workspaceAutomationMemoryEditorMessages = defineMessages({
  lastUpdated: {
    defaultMessage: "Saved {timestamp}",
    id: "+uxs3wAaoY",
    description: "Shows when automation memory was last saved",
  },
  notSavedYet: {
    defaultMessage: "Not saved yet",
    id: "bJEzufuAMI",
    description: "Shown when automation memory has never been saved",
  },
  memoryPlaceholder: {
    defaultMessage: "Add rules, constraints, or context specific to this automation…",
    id: "SKnqRs0g1W",
    description: "Placeholder for the automation memory editor",
  },
  memoryAriaLabel: {
    defaultMessage: "This automation's memory",
    id: "p5WLLGqte5",
    description: "Accessible label for the automation memory editor",
  },
  includeOrgKnowledgeLabel: {
    defaultMessage: "Also include organization-wide Memory",
    id: "jfGMJ5b7My",
    description: "Checkbox label controlling whether org-wide Knowledge Memory is also applied",
  },
  versionNoteLabel: {
    defaultMessage: "Version note (optional)",
    id: "plxwzkWTV8",
    description: "Label for the optional automation memory version note field",
  },
  versionNotePlaceholder: {
    defaultMessage: "Updated escalation rules",
    id: "5Y2/K7j6jZ",
    description: "Placeholder for the optional automation memory version note field",
  },
  overLimitError: {
    defaultMessage: "Automation memory must be {limit} characters or less.",
    id: "s1AGd+ZQ+h",
    description: "Error when automation memory exceeds the character limit",
  },
  characterCount: {
    defaultMessage: "{count}/{limit} characters",
    id: "JpOEI9GgBD",
    description: "Character count for the automation memory editor",
  },
  unsavedChanges: {
    defaultMessage: "Unsaved changes",
    id: "zBbOqD5BM8",
    description: "Status shown when automation memory has local changes",
  },
  changesSaved: {
    defaultMessage: "All changes saved",
    id: "PExFLDcDfN",
    description: "Status shown when automation memory matches the saved version",
  },
  history: {
    defaultMessage: "History",
    id: "Gu93a0Uln2",
    description: "Button to open automation memory revision history",
  },
  committing: {
    defaultMessage: "Saving",
    id: "oLAXW5+BbG",
    description: "Commit button label while automation memory is saving",
  },
  commitChanges: {
    defaultMessage: "Save changes",
    id: "BTqZ13otSp",
    description: "Commit button label for automation memory",
  },
  saveDialogTitle: {
    defaultMessage: "Save changes",
    id: "zdzoPv1xTx",
    description: "Title of the dialog used to save automation memory",
  },
  saveDialogDescription: {
    defaultMessage: "Optionally describe what changed for version history.",
    id: "/KsHfLF/ys",
    description: "Description in the automation memory save dialog",
  },
  cancel: {
    defaultMessage: "Cancel",
    id: "4685Uas50y",
    description: "Button that closes the automation memory save dialog",
  },
  saveVersion: {
    defaultMessage: "Save version",
    id: "yj+u9BadFU",
    description: "Button that saves a new automation memory version",
  },
  version: {
    defaultMessage: "Version {version}",
    id: "hbbJLJsUxw",
    description: "Shows the current automation memory version number",
  },
});
