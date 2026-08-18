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
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/database";
import { IssueSheetService } from "@/lib/projects/issue-sheet/issue-sheet-service";
import { ensureDefaultWorkspaceTeam } from "@/lib/teams/default-workspace-team";

import type { EmulatorIdentity } from "./emulator-identity";

export type IssueSheetBulkFixture = {
  organizationSlug: string;
  projectId: string;
  issueTitles: [string, string];
};

export async function provisionIssueSheetBulkFixture(
  identity: EmulatorIdentity,
): Promise<IssueSheetBulkFixture> {
  const [organization] = await db
    .select({ id: schema.organizations.id, slug: schema.organizations.slug })
    .from(schema.organizations)
    .where(eq(schema.organizations.slug, identity.organizationSlug))
    .limit(1);

  if (!organization?.slug) {
    throw new Error(`E2E organization not found for slug ${identity.organizationSlug}`);
  }

  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.workosUserId, identity.workosUserId))
    .limit(1);

  if (!user) {
    throw new Error(`E2E user not found for WorkOS user ${identity.workosUserId}`);
  }

  const team = await ensureDefaultWorkspaceTeam(organization.id);
  const projectId = `project_${randomUUID()}`;

  await db.insert(schema.projects).values({
    id: projectId,
    organizationId: organization.id,
    teamId: team.id,
    createdByUserId: user.id,
    name: `Bulk E2E ${Date.now()}`,
    description: "",
    translationContext: "",
    sourceLocale: "en-US",
    targetLocales: ["fr-FR"],
  });

  const issueSheetService = new IssueSheetService(db);
  const issueTitles = ["Bulk issue one", "Bulk issue two"] as const;

  for (const title of issueTitles) {
    await issueSheetService.createIssue({
      organizationId: organization.id,
      projectId,
      actorUserId: user.id,
      body: { title },
    });
  }

  return {
    organizationSlug: organization.slug,
    projectId,
    issueTitles,
  };
}
