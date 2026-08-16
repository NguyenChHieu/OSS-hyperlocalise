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
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { readApiResponseError } from "@/lib/api-error";

import { issueSheetApiPath } from "./issue-detail-utils";
import { issueFeedQueryKey } from "./use-issue-feed";
import { issueRelationshipsQueryKey } from "./use-issue-relationships-query";

export type IssueRelationshipRequestKind = "related" | "blocks" | "blocked_by" | "duplicate_of";

export function useIssueRelationshipMutations({
  organizationSlug,
  projectId,
  issueId,
}: {
  organizationSlug: string;
  projectId: string;
  issueId: string;
}) {
  const queryClient = useQueryClient();
  const relationshipsKey = issueRelationshipsQueryKey(organizationSlug, projectId, issueId);
  const feedKey = issueFeedQueryKey(organizationSlug, projectId, issueId);
  const basePath = `${issueSheetApiPath(organizationSlug, projectId)}/${issueId}/relationships`;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: relationshipsKey });
    void queryClient.invalidateQueries({ queryKey: feedKey });
  };

  const createRelationship = useMutation({
    mutationFn: async (input: { relatedIssueId: string; kind: IssueRelationshipRequestKind }) => {
      const response = await fetch(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw await readApiResponseError(response, "Failed to create relationship");
      }
    },
    onSuccess: invalidate,
  });

  const deleteRelationship = useMutation({
    mutationFn: async (relationshipId: string) => {
      const response = await fetch(`${basePath}/${relationshipId}`, { method: "DELETE" });
      if (!response.ok) {
        throw await readApiResponseError(response, "Failed to remove relationship");
      }
    },
    onSuccess: invalidate,
  });

  return {
    createRelationship,
    deleteRelationship,
    isPending: createRelationship.isPending || deleteRelationship.isPending,
  };
}
