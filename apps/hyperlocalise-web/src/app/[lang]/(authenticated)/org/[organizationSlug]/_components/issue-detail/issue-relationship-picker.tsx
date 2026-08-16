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
import { useState } from "react";
import { FormattedMessage, useIntl, type IntlShape } from "react-intl";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { issueRelationshipPickerMessages as messages } from "./issue-relationship-picker.messages";
import { IssueStatusIcon } from "./issue-status-icon";
import type { IssueRelationshipRequestKind } from "./use-issue-relationship-mutations";
import { useIssueRelationshipSearch } from "./use-issue-relationship-search";

const RELATIONSHIP_KINDS: IssueRelationshipRequestKind[] = [
  "related",
  "blocks",
  "blocked_by",
  "duplicate_of",
];

function kindLabel(intl: IntlShape, kind: IssueRelationshipRequestKind) {
  switch (kind) {
    case "related":
      return intl.formatMessage(messages.kindRelated);
    case "blocks":
      return intl.formatMessage(messages.kindBlocks);
    case "blocked_by":
      return intl.formatMessage(messages.kindBlockedBy);
    case "duplicate_of":
      return intl.formatMessage(messages.kindDuplicateOf);
  }
}

export function IssueRelationshipPicker({
  organizationSlug,
  excludeIssueId,
  disabled = false,
  onSelect,
}: {
  organizationSlug: string;
  excludeIssueId: string;
  disabled?: boolean;
  onSelect: (input: { relatedIssueId: string; kind: IssueRelationshipRequestKind }) => void;
}) {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<IssueRelationshipRequestKind>("related");
  const [query, setQuery] = useState("");

  const searchQuery = useIssueRelationshipSearch({
    organizationSlug,
    excludeIssueId,
    query,
    enabled: open,
  });
  const results = searchQuery.data ?? [];

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery("");
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            className="gap-1.5"
          />
        }
      >
        <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
        <FormattedMessage {...messages.addButton} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0" sideOffset={4}>
        <div className="border-b border-border p-2">
          <Select
            value={kind}
            onValueChange={(value) => setKind(value as IssueRelationshipRequestKind)}
          >
            <SelectTrigger className="h-8 w-full text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RELATIONSHIP_KINDS.map((value) => (
                <SelectItem key={value} value={value}>
                  {kindLabel(intl, value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={intl.formatMessage(messages.searchPlaceholder)}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>
              {searchQuery.isFetching ? (
                <FormattedMessage {...messages.loading} />
              ) : (
                <FormattedMessage {...messages.empty} />
              )}
            </CommandEmpty>
            <CommandGroup>
              {results.map((issue) => (
                <CommandItem
                  key={issue.issueId}
                  value={issue.issueId}
                  onSelect={() => {
                    onSelect({ relatedIssueId: issue.issueId, kind });
                    setOpen(false);
                    setQuery("");
                  }}
                >
                  <IssueStatusIcon status={issue.status} />
                  <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
