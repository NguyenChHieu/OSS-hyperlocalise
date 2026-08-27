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
import { FeatureTeaserPage } from "@/components/feature-teaser/feature-teaser-page";
import {
  getWorkspaceFeatureFlagEnabled,
  workspaceAutomationsFlag,
} from "@/lib/flags/workspace-flags";
import { requireAppAuthContext } from "@/lib/workos/app-auth";

import { VisualWorkflowEditor } from "../../_components/visual-workflow-editor/visual-workflow-editor";

export default async function VisualWorkflowNewPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const auth = await requireAppAuthContext({ organizationSlug });
  const automationsEnabled = await getWorkspaceFeatureFlagEnabled(workspaceAutomationsFlag, auth);

  if (!automationsEnabled) {
    return <FeatureTeaserPage feature="automations" scope="workspace" />;
  }

  return (
    <div className="-mx-4 -my-5 flex min-h-0 flex-1 flex-col overflow-hidden sm:-mx-6 lg:-mx-8">
      <VisualWorkflowEditor />
    </div>
  );
}
