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
import { FormattedMessage, useIntl } from "react-intl";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";

import { issueReopenControlMessages as messages } from "./issue-reopen-control.messages";

export type IssueReopenControlProps = {
  disabled?: boolean;
  isSubmitting: boolean;
  onReopen: (comment: string | null) => void;
  className?: string;
};

export function IssueReopenControl({
  disabled = false,
  isSubmitting,
  onReopen,
  className,
}: IssueReopenControlProps) {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setComment("");
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
            className={className}
          />
        }
      >
        <FormattedMessage {...messages.trigger} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 grid gap-2">
        <Textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder={intl.formatMessage(messages.commentPlaceholder)}
          rows={3}
          disabled={isSubmitting}
        />
        <Button
          type="button"
          size="sm"
          disabled={isSubmitting}
          onClick={() => {
            onReopen(comment.trim() || null);
            setOpen(false);
            setComment("");
          }}
        >
          <FormattedMessage {...messages.confirm} />
        </Button>
      </PopoverContent>
    </Popover>
  );
}
