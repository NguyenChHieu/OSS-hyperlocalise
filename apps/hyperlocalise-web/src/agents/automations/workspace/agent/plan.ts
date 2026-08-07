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
import {
  hasWorkspaceAutomationGithubAgentTool,
  hasWorkspaceAutomationGithubWorkflow,
} from "@/lib/agents/workspace-automation-github-mapping";
import {
  hasWorkspaceAutomationAssignTranslateWithAgentTool,
  hasWorkspaceAutomationContentfulWorkflow,
  hasWorkspaceAutomationCreateNativeTmsJobTool,
  hasWorkspaceAutomationKnowledgeTool,
  hasWorkspaceAutomationKnowledgeUpdatesAllowed,
  type WorkspaceAutomationRecord,
  type WorkspaceAutomationToolConfig,
} from "@/lib/agents/workspace-automations";

import { getTemplateExecutorAgent } from "./workspace-template-manifest";

export const WORKSPACE_ORCHESTRATOR_TOOL_NAMES = [
  "use_github_repository",
  "run_github_workflows",
  "run_contentful_translation",
  "create_native_tms_job",
  "assign_translate_with_agent",
  "use_semrush",
  "use_ahrefs",
  "notify_slack",
  "notify_email",
  "recall_memory",
  "save_memory",
] as const;

export type WorkspaceOrchestratorToolName = (typeof WORKSPACE_ORCHESTRATOR_TOOL_NAMES)[number];

export type WorkspaceOrchestratorPlan = {
  tools: WorkspaceOrchestratorToolName[];
};

export type WorkspaceOrchestratorTriggerContext = {
  templateSkillId?: string | null;
};

const WORKFLOW_TOOLS: WorkspaceOrchestratorToolName[] = [
  "use_github_repository",
  "run_github_workflows",
  "run_contentful_translation",
  "create_native_tms_job",
  "assign_translate_with_agent",
  "use_semrush",
  "use_ahrefs",
];

const NOTIFICATION_TOOLS: WorkspaceOrchestratorToolName[] = ["notify_slack", "notify_email"];

// Not part of WORKFLOW_TOOLS: memory tools are general availability, not ordered workflow steps,
// so they skip orderWorkflowTools' template-skill-executor reordering entirely.
//
// recall_memory is read-only, so planHasActionableTool below excludes it. save_memory is
// deliberately NOT in this list even though it's a memory tool: forcing every planned tool via
// toolChoice ({type:"tool",...}) is the only way agent.ts's ToolLoopAgent reliably reaches the
// tools planned after it — the underlying loop only continues past a step that produced zero tool
// calls, so a toolChoice: "auto" step risked the model ending the run before a later forced
// notification tool ever ran (a real Codex finding against an earlier version of this file). It's
// still not "invented content on every run" per the *original* finding against forcing it: its
// schema accepts entry: null as an explicit "nothing to remember" decision.
const MEMORY_TOOLS: WorkspaceOrchestratorToolName[] = ["recall_memory"];
const SAVE_MEMORY_TOOLS: WorkspaceOrchestratorToolName[] = ["save_memory"];

function workflowToolEnabled(
  tool: WorkspaceOrchestratorToolName,
  toolConfig: WorkspaceAutomationToolConfig,
): boolean {
  switch (tool) {
    case "use_github_repository":
      return hasWorkspaceAutomationGithubAgentTool(toolConfig);
    case "run_github_workflows":
      return hasWorkspaceAutomationGithubWorkflow(toolConfig);
    case "run_contentful_translation":
      return hasWorkspaceAutomationContentfulWorkflow(toolConfig);
    case "create_native_tms_job":
      return hasWorkspaceAutomationCreateNativeTmsJobTool(toolConfig);
    case "assign_translate_with_agent":
      return hasWorkspaceAutomationAssignTranslateWithAgentTool(toolConfig);
    case "use_semrush":
      return Boolean(toolConfig.semrush?.enabled && toolConfig.semrush.connectionId);
    case "use_ahrefs":
      return Boolean(toolConfig.ahrefs?.enabled && toolConfig.ahrefs.connectionId);
    default:
      return false;
  }
}

function notificationToolEnabled(
  tool: WorkspaceOrchestratorToolName,
  toolConfig: WorkspaceAutomationToolConfig,
): boolean {
  switch (tool) {
    case "notify_slack":
      return Boolean(toolConfig.slack?.enabled && toolConfig.slack.channelId);
    case "notify_email":
      return Boolean(
        toolConfig.email?.enabled &&
        toolConfig.email.recipients &&
        toolConfig.email.recipients.length > 0,
      );
    default:
      return false;
  }
}

function memoryToolEnabled(
  tool: WorkspaceOrchestratorToolName,
  toolConfig: WorkspaceAutomationToolConfig,
): boolean {
  switch (tool) {
    case "recall_memory":
      return hasWorkspaceAutomationKnowledgeTool(toolConfig);
    case "save_memory":
      return hasWorkspaceAutomationKnowledgeUpdatesAllowed(toolConfig);
    default:
      return false;
  }
}

function orderWorkflowTools(input: {
  toolConfig: WorkspaceAutomationToolConfig;
  templateSkillId?: string | null;
}): WorkspaceOrchestratorToolName[] {
  const enabled = WORKFLOW_TOOLS.filter((tool) => workflowToolEnabled(tool, input.toolConfig));
  if (enabled.length <= 1) {
    return enabled;
  }

  const executorAgent = input.templateSkillId
    ? getTemplateExecutorAgent(input.templateSkillId)
    : null;

  if (executorAgent === "contentful") {
    return [
      ...enabled.filter((tool) => tool === "run_contentful_translation"),
      ...enabled.filter((tool) => tool === "run_github_workflows"),
      ...enabled.filter((tool) => tool === "use_github_repository"),
      ...enabled.filter((tool) => tool === "create_native_tms_job"),
      ...enabled.filter((tool) => tool === "assign_translate_with_agent"),
      ...enabled.filter((tool) => tool === "use_semrush"),
      ...enabled.filter((tool) => tool === "use_ahrefs"),
    ];
  }

  return [
    ...enabled.filter((tool) => tool === "use_github_repository"),
    ...enabled.filter((tool) => tool === "run_github_workflows"),
    ...enabled.filter((tool) => tool === "run_contentful_translation"),
    ...enabled.filter((tool) => tool === "create_native_tms_job"),
    ...enabled.filter((tool) => tool === "assign_translate_with_agent"),
    ...enabled.filter((tool) => tool === "use_semrush"),
    ...enabled.filter((tool) => tool === "use_ahrefs"),
  ];
}

export function buildWorkspaceOrchestratorPlan(
  automation: WorkspaceAutomationRecord,
  triggerContext?: WorkspaceOrchestratorTriggerContext,
): WorkspaceOrchestratorPlan {
  const workflowTools = orderWorkflowTools({
    toolConfig: automation.toolConfig,
    templateSkillId: triggerContext?.templateSkillId,
  });
  const notificationTools = NOTIFICATION_TOOLS.filter((tool) =>
    notificationToolEnabled(tool, automation.toolConfig),
  );
  const memoryTools = MEMORY_TOOLS.filter((tool) => memoryToolEnabled(tool, automation.toolConfig));
  const saveMemoryTools = SAVE_MEMORY_TOOLS.filter((tool) =>
    memoryToolEnabled(tool, automation.toolConfig),
  );

  // recall_memory runs first and save_memory runs last before notifications: every planned tool
  // executes strictly in this order (agent.ts's prepareStep forces each one in turn), so recalled
  // guidance lands before the workflow tools it's meant to inform, and a memory write reflects
  // what those tools actually did before the run's notification summarizes the outcome.
  return {
    tools: [...memoryTools, ...workflowTools, ...saveMemoryTools, ...notificationTools],
  };
}

/**
 * Whether the plan includes at least one tool beyond a read-only memory recall — callers use this
 * instead of a raw plan.tools.length check to decide whether a run is meaningful enough to
 * dispatch. recall_memory being the only planned tool means the run would read Memory and take no
 * other action; save_memory, workflow, and notification tools all count since each can produce a
 * real effect.
 */
export function planHasActionableTool(plan: WorkspaceOrchestratorPlan): boolean {
  return plan.tools.some((tool) => !MEMORY_TOOLS.includes(tool));
}
