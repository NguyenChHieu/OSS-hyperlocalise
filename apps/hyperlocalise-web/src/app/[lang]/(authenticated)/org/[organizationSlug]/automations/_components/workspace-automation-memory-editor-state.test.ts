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

import {
  getWorkspaceAutomationMemoryEditorState,
  shouldApplyWorkspaceAutomationMemoryRefresh,
} from "./workspace-automation-memory-editor-state";

describe("getWorkspaceAutomationMemoryEditorState", () => {
  it("treats a toggle-only change as a change eligible to save", () => {
    const state = getWorkspaceAutomationMemoryEditorState({
      content: "Same content",
      savedContent: "Same content",
      includeOrgKnowledge: false,
      savedIncludeOrgKnowledge: true,
      canUpdateWorkspaceAutomationMemory: true,
      isSaving: false,
    });

    expect(state.hasChanges).toBe(true);
    expect(state.canSave).toBe(true);
  });

  it("reports no changes when content and toggle both match the saved values", () => {
    const state = getWorkspaceAutomationMemoryEditorState({
      content: "Same content",
      savedContent: "Same content",
      includeOrgKnowledge: true,
      savedIncludeOrgKnowledge: true,
      canUpdateWorkspaceAutomationMemory: true,
      isSaving: false,
    });

    expect(state.hasChanges).toBe(false);
    expect(state.canSave).toBe(false);
  });
});

describe("shouldApplyWorkspaceAutomationMemoryRefresh", () => {
  it("blocks a background refresh while the toggle has unsaved changes", () => {
    expect(
      shouldApplyWorkspaceAutomationMemoryRefresh({
        content: "Same content",
        savedContent: "Same content",
        includeOrgKnowledge: false,
        savedIncludeOrgKnowledge: true,
      }),
    ).toBe(false);
  });

  it("allows a background refresh when nothing is dirty", () => {
    expect(
      shouldApplyWorkspaceAutomationMemoryRefresh({
        content: "Same content",
        savedContent: "Same content",
        includeOrgKnowledge: true,
        savedIncludeOrgKnowledge: true,
      }),
    ).toBe(true);
  });
});
