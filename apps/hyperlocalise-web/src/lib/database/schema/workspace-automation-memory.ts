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
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { workspaceAutomations } from "./agents";
import { organizations, users } from "./organizations";

/**
 * Stores one automation-scoped markdown memory note consulted before that automation runs.
 */
export const workspaceAutomationMemories = pgTable(
  "workspace_automation_memories",
  {
    automationId: uuid("automation_id")
      .primaryKey()
      .references(() => workspaceAutomations.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id").notNull().defaultRandom(),
    version: integer("version").notNull().default(1),
    content: text("content").notNull().default(""),
    summary: text("summary").notNull().default("Initial version"),
    includeOrgKnowledge: boolean("include_org_knowledge").notNull().default(true),
    updatedByUserId: uuid("updated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("workspace_automation_memories_revision_id_key").on(table.revisionId),
    index("idx_workspace_automation_memories_organization_id").on(table.organizationId),
    check(
      "workspace_automation_memories_content_length_check",
      sql`char_length(${table.content}) <= 20000`,
    ),
    check(
      "workspace_automation_memories_summary_length_check",
      sql`char_length(${table.summary}) <= 160`,
    ),
    check("workspace_automation_memories_version_check", sql`${table.version} >= 1`),
  ],
);

/**
 * Stores immutable snapshots after an automation memory revision is superseded.
 */
export const workspaceAutomationMemoryRevisions = pgTable(
  "workspace_automation_memory_revisions",
  {
    id: uuid("id").primaryKey(),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => workspaceAutomations.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    content: text("content").notNull(),
    summary: text("summary").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("workspace_automation_memory_revisions_automation_version_key").on(
      table.automationId,
      table.version,
    ),
    index("idx_workspace_automation_memory_revisions_organization_id").on(table.organizationId),
    check(
      "workspace_automation_memory_revisions_content_length_check",
      sql`char_length(${table.content}) <= 20000`,
    ),
    check(
      "workspace_automation_memory_revisions_summary_length_check",
      sql`char_length(${table.summary}) <= 160`,
    ),
    check("workspace_automation_memory_revisions_version_check", sql`${table.version} >= 1`),
  ],
);
