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
import { FormattedMessage, useIntl, type IntlShape } from "react-intl";
import { Delete02Icon, LinkSquare02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { TypographyP } from "@/components/ui/typography";

import { buildIssueDetailHref } from "./issue-detail-utils";
import { issueRelationshipSectionMessages as messages } from "./issue-relationship-section.messages";
import { IssueRelationshipPicker } from "./issue-relationship-picker";
import { IssueStatusIcon } from "./issue-status-icon";
import { useIssueRelationshipMutations } from "./use-issue-relationship-mutations";
import type {
  IssueRelationship,
  IssueRelationshipPresentedKind,
} from "./use-issue-relationships-query";

const GROUP_ORDER: IssueRelationshipPresentedKind[] = [
  "blocks",
  "blocked_by",
  "related",
  "duplicate_of",
  "duplicate",
];

function groupLabel(intl: IntlShape, kind: IssueRelationshipPresentedKind) {
  switch (kind) {
    case "related":
      return intl.formatMessage(messages.groupRelated);
    case "blocks":
      return intl.formatMessage(messages.groupBlocks);
    case "blocked_by":
      return intl.formatMessage(messages.groupBlockedBy);
    case "duplicate_of":
      return intl.formatMessage(messages.groupDuplicateOf);
    case "duplicate":
      return intl.formatMessage(messages.groupDuplicates);
  }
}

function RelationshipRow({
  relationship,
  organizationSlug,
  onRemove,
  disabled,
}: {
  relationship: IssueRelationship;
  organizationSlug: string;
  onRemove: () => void;
  disabled: boolean;
}) {
  const intl = useIntl();
  return (
    <div className="flex items-center gap-2 py-1">
      <IssueStatusIcon status={relationship.otherIssue.status} />
      <a
        href={buildIssueDetailHref({
          organizationSlug,
          projectId: relationship.otherIssue.projectId,
          issueId: relationship.otherIssue.issueId,
        })}
        className="min-w-0 flex-1 truncate text-sm text-foreground hover:underline"
      >
        {relationship.otherIssue.title}
      </a>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        aria-label={intl.formatMessage(messages.remove)}
        onClick={onRemove}
      >
        <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.8} className="size-3.5" />
      </Button>
    </div>
  );
}

export function IssueRelationshipSection({
  organizationSlug,
  projectId,
  issueId,
  relationships,
  disabled = false,
}: {
  organizationSlug: string;
  projectId: string;
  issueId: string;
  relationships: IssueRelationship[];
  disabled?: boolean;
}) {
  const intl = useIntl();
  const { createRelationship, deleteRelationship, isPending } = useIssueRelationshipMutations({
    organizationSlug,
    projectId,
    issueId,
  });

  const groups = new Map<IssueRelationshipPresentedKind, IssueRelationship[]>();
  for (const relationship of relationships) {
    const list = groups.get(relationship.presentedKind) ?? [];
    list.push(relationship);
    groups.set(relationship.presentedKind, list);
  }

  return (
    <section className="mt-2 grid gap-3 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-2">
        <TypographyP className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
          <HugeiconsIcon
            icon={LinkSquare02Icon}
            strokeWidth={1.8}
            className="size-3.5 text-muted-foreground"
          />
          <FormattedMessage {...messages.heading} />
        </TypographyP>
        <IssueRelationshipPicker
          organizationSlug={organizationSlug}
          excludeIssueId={issueId}
          disabled={disabled || isPending}
          onSelect={(input) => {
            createRelationship.mutate(input, {
              onError: (error) => {
                toast.error(
                  error instanceof Error ? error.message : intl.formatMessage(messages.addError),
                );
              },
            });
          }}
        />
      </div>
      {relationships.length === 0 ? (
        <TypographyP className="text-sm text-muted-foreground">
          <FormattedMessage {...messages.empty} />
        </TypographyP>
      ) : (
        <div className="grid gap-3">
          {GROUP_ORDER.filter((kind) => groups.has(kind)).map((kind) => (
            <div key={kind} className="grid gap-1">
              <span className="text-xs text-muted-foreground">{groupLabel(intl, kind)}</span>
              <div className="grid">
                {groups.get(kind)!.map((relationship) => (
                  <RelationshipRow
                    key={relationship.id}
                    relationship={relationship}
                    organizationSlug={organizationSlug}
                    disabled={disabled || isPending}
                    onRemove={() => {
                      deleteRelationship.mutate(relationship.id, {
                        onError: (error) => {
                          toast.error(
                            error instanceof Error
                              ? error.message
                              : intl.formatMessage(messages.removeError),
                          );
                        },
                      });
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
