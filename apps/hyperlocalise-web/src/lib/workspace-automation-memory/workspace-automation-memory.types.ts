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
export type WorkspaceAutomationMemoryRecord = {
  revisionId: string | null;
  version: number;
  content: string;
  summary: string | null;
  includeOrgKnowledge: boolean;
  updatedAt: string | null;
  updatedByUserId: string | null;
};

export type WorkspaceAutomationMemoryRevision = {
  revisionId: string;
  version: number;
  content: string;
  summary: string;
  createdAt: string;
  createdByUserId: string | null;
  createdByName: string | null;
  isCurrent: boolean;
};

export type WorkspaceAutomationMemoryRevisionMetadata = Omit<
  WorkspaceAutomationMemoryRevision,
  "content"
>;

export type WorkspaceAutomationMemoryCommitResult = {
  workspaceAutomationMemory: WorkspaceAutomationMemoryRecord;
  changed: boolean;
};

export type WorkspaceAutomationMemoryCommitError = {
  code: "precondition_failed";
  current: WorkspaceAutomationMemoryRecord;
};

export type WorkspaceAutomationMemoryRestoreError =
  | WorkspaceAutomationMemoryCommitError
  | { code: "revision_not_found" };

export type CurrentWorkspaceAutomationMemoryRow = {
  revisionId: string;
  version: number;
  content: string;
  summary: string;
  includeOrgKnowledge: boolean;
  updatedAt: Date;
  updatedByUserId: string | null;
};

export type WorkspaceAutomationMemoryRevisionAuthorRow = {
  createdByUserId: string | null;
  createdByFirstName: string | null;
  createdByLastName: string | null;
};
