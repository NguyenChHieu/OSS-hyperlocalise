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
import { isStepCount, ToolLoopAgent } from "ai";

import { getHyperlocaliseAgentModel } from "@/lib/agent-runtime/loops/model";
import {
  WORKSPACE_ORCHESTRATOR_STEP_LIMIT,
  WORKSPACE_ORCHESTRATOR_TIMEOUT,
} from "@/lib/agent-runtime/subagents/constants";
import { hyperlocaliseAgentMaxOutputTokens } from "@/lib/agent-runtime/loops/hyperlocalise-agent";

import { buildWorkspaceOrchestratorTools } from "./build-workspace-orchestrator-tools";
import type { WorkspaceOrchestratorSession } from "./context";

export function createWorkspaceOrchestratorAgent(session: WorkspaceOrchestratorSession) {
  const tools = buildWorkspaceOrchestratorTools(session);
  const plannedToolCount = session.plan.tools.length;
  const optionalTools = session.plan.optionalTools ?? [];
  // WORKSPACE_ORCHESTRATOR_STEP_LIMIT is a floor, not a ceiling: prepareStep below forces the
  // exact next planned tool at each step, then offers each optional tool its own step (or
  // toolChoice: "none" past both lists), so there's no way for the loop to run past
  // plannedToolCount + optionalTools.length + 1 steps regardless of how high this is set. Capping
  // it with Math.min instead used to silently drop any planned tool beyond the limit — e.g. Memory
  // enabled on an automation already planning 6 tools pushed the 7th (often the Slack/email
  // notification) past the cap, so it never ran even though the automation reported success.
  const stepLimit = Math.max(
    WORKSPACE_ORCHESTRATOR_STEP_LIMIT,
    plannedToolCount + optionalTools.length + 1,
  );

  return new ToolLoopAgent({
    model: getHyperlocaliseAgentModel(),
    instructions: session.composedInstructions,
    tools,
    activeTools: [...session.plan.tools, ...optionalTools],
    runtimeContext: session,
    maxOutputTokens: hyperlocaliseAgentMaxOutputTokens,
    timeout: WORKSPACE_ORCHESTRATOR_TIMEOUT,
    stopWhen: isStepCount(stepLimit),
    prepareStep: ({ stepNumber }) => {
      const toolName = session.plan.tools[stepNumber];
      if (toolName) {
        return {
          activeTools: [toolName],
          toolChoice: { type: "tool", toolName },
        };
      }

      // One step per optional tool, after every forced tool has run: offered but never forced —
      // toolChoice: "auto" lets the model decide whether to call it (or call nothing and finish)
      // based on the automation's own instructions, instead of being required to call it every run.
      const optionalToolName = optionalTools[stepNumber - plannedToolCount];
      if (optionalToolName) {
        return {
          activeTools: [optionalToolName],
          toolChoice: "auto",
        };
      }

      return {
        toolChoice: "none",
      };
    },
  });
}
