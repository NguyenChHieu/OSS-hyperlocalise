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
import { cn } from "@/lib/primitives/cn";

import type { IssueStatusValue } from "./issue-detail-utils";

function OpenStatusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <circle cx="8" cy="8" r="6" className="stroke-muted-foreground" strokeWidth="1.75" />
    </svg>
  );
}

function InProgressStatusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <circle cx="8" cy="8" r="6" className="stroke-amber-500" strokeWidth="1.75" />
      <path d="M8 2a6 6 0 0 1 0 12Z" className="fill-amber-500" />
    </svg>
  );
}

function AwaitingVerificationStatusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <circle cx="8" cy="8" r="6" className="stroke-sky-500" strokeWidth="1.75" />
      <path
        d="M8 4.5V8l2.5 1.5"
        className="stroke-sky-500"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ResolvedStatusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <circle cx="8" cy="8" r="7" className="fill-green-500" />
      <path
        d="M5 8.2 7 10.2 11 6"
        stroke="white"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function VerifiedStatusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <circle cx="8" cy="8" r="7" className="fill-indigo-500" />
      <path
        d="M4.7 8.2 6.7 10.2 8.7 8.2M7.3 8.2 9.3 10.2 11.3 6.2"
        stroke="white"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WontFixStatusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <circle cx="8" cy="8" r="7" className="fill-muted-foreground" />
      <path
        d="M5.5 5.5 10.5 10.5M10.5 5.5 5.5 10.5"
        stroke="white"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

const STATUS_ICON: Record<IssueStatusValue, (props: { className?: string }) => JSX.Element> = {
  open: OpenStatusIcon,
  in_progress: InProgressStatusIcon,
  awaiting_verification: AwaitingVerificationStatusIcon,
  resolved: ResolvedStatusIcon,
  verified: VerifiedStatusIcon,
  wont_fix: WontFixStatusIcon,
};

const DEFAULT_STATUS_ICON = STATUS_ICON.open;

export function IssueStatusIcon({
  status,
  className,
}: {
  status: string;
  className?: string;
  strokeWidth?: number;
}) {
  const Icon = STATUS_ICON[status as IssueStatusValue] ?? DEFAULT_STATUS_ICON;

  return <Icon className={cn("size-4 shrink-0", className)} />;
}
