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
import { z } from "zod";

import {
  WORKSPACE_AUTOMATION_MEMORY_CONTENT_MAX_LENGTH,
  WORKSPACE_AUTOMATION_MEMORY_SUMMARY_MAX_LENGTH,
  normalizeWorkspaceAutomationMemoryContent,
} from "@/lib/workspace-automation-memory/workspace-automation-memory.shared";

export const updateWorkspaceAutomationMemoryBodySchema = z.object({
  content: z
    .string()
    .transform(normalizeWorkspaceAutomationMemoryContent)
    .pipe(z.string().max(WORKSPACE_AUTOMATION_MEMORY_CONTENT_MAX_LENGTH)),
  summary: z.string().trim().min(1).max(WORKSPACE_AUTOMATION_MEMORY_SUMMARY_MAX_LENGTH).optional(),
  includeOrgKnowledge: z.boolean().optional(),
});

export const workspaceAutomationMemoryRevisionParamsSchema = z.object({
  automationId: z.string().uuid(),
  revisionId: z.string().uuid(),
});

export const workspaceAutomationMemoryRevisionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.coerce.number().int().positive().optional(),
});

export const workspaceAutomationMemoryRecordSchema = z.object({
  revisionId: z.string().uuid().nullable(),
  version: z.number().int().nonnegative(),
  content: z.string(),
  summary: z.string().nullable(),
  includeOrgKnowledge: z.boolean(),
  updatedAt: z.string().datetime().nullable(),
  updatedByUserId: z.string().nullable(),
});

export const workspaceAutomationMemoryResponseSchema = z.object({
  workspaceAutomationMemory: workspaceAutomationMemoryRecordSchema,
});

export const workspaceAutomationMemoryRevisionMetadataSchema = z.object({
  revisionId: z.string().uuid(),
  version: z.number().int().positive(),
  summary: z.string(),
  createdAt: z.string().datetime(),
  createdByUserId: z.string().nullable(),
  createdByName: z.string().nullable(),
  isCurrent: z.boolean(),
});

export const workspaceAutomationMemoryRevisionSchema =
  workspaceAutomationMemoryRevisionMetadataSchema.extend({
    content: z.string(),
  });

export const workspaceAutomationMemoryRevisionListResponseSchema = z.object({
  workspaceAutomationMemoryRevisions: z.array(workspaceAutomationMemoryRevisionMetadataSchema),
  nextCursor: z.number().int().positive().nullable(),
});

export const workspaceAutomationMemoryRevisionResponseSchema = z.object({
  workspaceAutomationMemoryRevision: workspaceAutomationMemoryRevisionSchema,
  previousWorkspaceAutomationMemoryRevision: workspaceAutomationMemoryRevisionSchema.nullable(),
});

export type UpdateWorkspaceAutomationMemoryBody = z.infer<
  typeof updateWorkspaceAutomationMemoryBodySchema
>;
export type WorkspaceAutomationMemoryRecordDto = z.infer<
  typeof workspaceAutomationMemoryRecordSchema
>;
export type WorkspaceAutomationMemoryResponse = z.infer<
  typeof workspaceAutomationMemoryResponseSchema
>;
export type WorkspaceAutomationMemoryRevisionMetadataDto = z.infer<
  typeof workspaceAutomationMemoryRevisionMetadataSchema
>;
export type WorkspaceAutomationMemoryRevisionDto = z.infer<
  typeof workspaceAutomationMemoryRevisionSchema
>;
export type WorkspaceAutomationMemoryRevisionListResponse = z.infer<
  typeof workspaceAutomationMemoryRevisionListResponseSchema
>;
export type WorkspaceAutomationMemoryRevisionResponse = z.infer<
  typeof workspaceAutomationMemoryRevisionResponseSchema
>;
