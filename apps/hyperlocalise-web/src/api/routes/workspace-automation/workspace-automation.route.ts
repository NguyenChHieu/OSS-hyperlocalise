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
import { and, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { validator } from "hono/validator";

import { hasCapability } from "@/api/auth/policy";
import { isWorkspaceOperatorRole } from "@/api/auth/roles";
import { workosAuthMiddleware, type AuthVariables } from "@/api/auth/workos";
import {
  apiErrorResponse,
  badRequestResponse,
  conflictResponse,
  forbiddenResponse,
  notFoundResponse,
  serviceUnavailableResponse,
} from "@/api/response.schema";
import {
  withWorkspaceResourceLimit,
  workspaceResourceFeatureIds,
  workspaceResourceLimitErrorDetails,
  workspaceResourceLimitMessage,
  type WorkspaceResourceLimitError,
} from "@/lib/billing/workspace-resource-limits";
import { dispatchManualWorkspaceAutomationRun } from "@/lib/agents/workspace-automation-dispatcher";
import {
  createWorkspaceAutomation,
  getWorkspaceAutomationById,
  getWorkspaceAutomationRunById,
  listWorkspaceAutomationRuns,
  listWorkspaceAutomations,
  updateWorkspaceAutomation,
  type WorkspaceAutomationConfigValidationError,
  type WorkspaceAutomationRepositoryTarget,
  type WorkspaceAutomationToolConfig,
} from "@/lib/agents/workspace-automations";
import { db, schema } from "@/lib/database";
import { isErr } from "@/lib/primitives/result/results";
import {
  commitWorkspaceAutomationMemory,
  getWorkspaceAutomationMemory,
  setWorkspaceAutomationMemoryIncludeOrgKnowledge,
} from "@/lib/workspace-automation-memory/workspace-automation-memory";
import {
  getWorkspaceAutomationMemoryRevision,
  listWorkspaceAutomationMemoryRevisions,
  restoreWorkspaceAutomationMemoryRevision,
} from "@/lib/workspace-automation-memory/workspace-automation-memory-revisions";
import type { WorkspaceAutomationMemoryRecord } from "@/lib/workspace-automation-memory/workspace-automation-memory.types";

import {
  createWorkspaceAutomationBodySchema,
  createWorkspaceAutomationRunBodySchema,
  listWorkspaceAutomationRunsQuerySchema,
  listWorkspaceAutomationsQuerySchema,
  updateWorkspaceAutomationBodySchema,
  workspaceAutomationIdParamSchema,
} from "./workspace-automation.schema";
import {
  updateWorkspaceAutomationMemoryBodySchema,
  workspaceAutomationMemoryRevisionListQuerySchema,
  workspaceAutomationMemoryRevisionParamsSchema,
} from "./workspace-automation-memory.schema";

const validateListQuery = validator("query", (value, c) => {
  const parsed = listWorkspaceAutomationsQuerySchema.safeParse(value);
  if (!parsed.success) {
    return badRequestResponse(
      c,
      "invalid_query_params",
      "Query parameters are invalid.",
      parsed.error.flatten(),
    );
  }
  return parsed.data;
});

const validateAutomationParams = validator("param", (value, c) => {
  const parsed = workspaceAutomationIdParamSchema.safeParse(value);
  if (!parsed.success) {
    return badRequestResponse(c, "invalid_workspace_automation_id");
  }
  return parsed.data;
});

const validateCreateBody = validator("json", (value, c) => {
  const parsed = createWorkspaceAutomationBodySchema.safeParse(value);
  if (!parsed.success) {
    return badRequestResponse(
      c,
      "invalid_workspace_automation_payload",
      "Automation payload is invalid.",
      parsed.error.flatten(),
    );
  }
  return parsed.data;
});

const validateUpdateBody = validator("json", (value, c) => {
  const parsed = updateWorkspaceAutomationBodySchema.safeParse(value);
  if (!parsed.success) {
    return badRequestResponse(
      c,
      "invalid_workspace_automation_payload",
      "Automation payload is invalid.",
      parsed.error.flatten(),
    );
  }
  return parsed.data;
});

const validateRunsQuery = validator("query", (value, c) => {
  const parsed = listWorkspaceAutomationRunsQuerySchema.safeParse(value);
  if (!parsed.success) {
    return badRequestResponse(
      c,
      "invalid_query_params",
      "Query parameters are invalid.",
      parsed.error.flatten(),
    );
  }
  return parsed.data;
});

const validateRunBody = validator("json", (value, c) => {
  const parsed = createWorkspaceAutomationRunBodySchema.safeParse(value);
  if (!parsed.success) {
    return badRequestResponse(
      c,
      "invalid_workspace_automation_run_payload",
      "Automation run payload is invalid.",
      parsed.error.flatten(),
    );
  }
  return parsed.data;
});

const validateUpdateMemoryBody = validator("json", (value, c) => {
  const parsed = updateWorkspaceAutomationMemoryBodySchema.safeParse(value);
  if (!parsed.success) {
    return badRequestResponse(
      c,
      "invalid_workspace_automation_memory_payload",
      "Automation memory payload is invalid.",
      parsed.error.flatten(),
    );
  }
  return parsed.data;
});

const validateMemoryRevisionListQuery = validator("query", (value, c) => {
  const parsed = workspaceAutomationMemoryRevisionListQuerySchema.safeParse(value);
  if (!parsed.success) {
    return badRequestResponse(
      c,
      "invalid_query_params",
      "Query parameters are invalid.",
      parsed.error.flatten(),
    );
  }
  return parsed.data;
});

const validateMemoryRevisionParams = validator("param", (value, c) => {
  const parsed = workspaceAutomationMemoryRevisionParamsSchema.safeParse(value);
  if (!parsed.success) {
    return badRequestResponse(c, "invalid_workspace_automation_memory_revision_params");
  }
  return parsed.data;
});

function formatWorkspaceAutomationMemoryEtag(revisionId: string | null) {
  return `"${revisionId ?? "0"}"`;
}

type ParsedWorkspaceAutomationMemoryPrecondition =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "valid"; expectedRevisionId: string | null };

function parseWorkspaceAutomationMemoryIfMatch(
  value: string | undefined,
): ParsedWorkspaceAutomationMemoryPrecondition {
  if (value === undefined) {
    return { kind: "missing" };
  }

  const match = /^"([^"]+)"$/u.exec(value.trim());
  if (!match) {
    return { kind: "invalid" };
  }

  const token = match[1];
  if (token === "0") {
    return { kind: "valid", expectedRevisionId: null };
  }

  return workspaceAutomationMemoryRevisionParamsSchema.shape.revisionId.safeParse(token).success
    ? { kind: "valid", expectedRevisionId: token }
    : { kind: "invalid" };
}

type WorkspaceAutomationMemoryRouteContext = Context<{ Variables: AuthVariables }>;

function setWorkspaceAutomationMemoryEtag(
  c: WorkspaceAutomationMemoryRouteContext,
  workspaceAutomationMemory: WorkspaceAutomationMemoryRecord,
) {
  c.header("ETag", formatWorkspaceAutomationMemoryEtag(workspaceAutomationMemory.revisionId));
}

function validateWorkspaceAutomationMemoryPrecondition(c: WorkspaceAutomationMemoryRouteContext) {
  const precondition = parseWorkspaceAutomationMemoryIfMatch(c.req.header("If-Match"));
  if (precondition.kind === "missing") {
    return apiErrorResponse(
      c,
      428,
      "workspace_automation_memory_precondition_required",
      "Reload this automation's memory before committing changes",
    );
  }
  if (precondition.kind === "invalid") {
    return badRequestResponse(
      c,
      "invalid_workspace_automation_memory_precondition",
      "If-Match must contain the current automation memory ETag",
    );
  }
  return precondition;
}

function workspaceAutomationMemoryPreconditionFailedResponse(
  c: WorkspaceAutomationMemoryRouteContext,
  current: WorkspaceAutomationMemoryRecord,
) {
  setWorkspaceAutomationMemoryEtag(c, current);
  return apiErrorResponse(
    c,
    412,
    "workspace_automation_memory_precondition_failed",
    "This automation's memory changed after it was loaded",
    { workspaceAutomationMemory: current },
  );
}

async function getOwnedGithubRepository(input: { organizationId: string; repositoryId: string }) {
  const [repository] = await db
    .select()
    .from(schema.githubInstallationRepositories)
    .where(
      and(
        eq(schema.githubInstallationRepositories.organizationId, input.organizationId),
        eq(schema.githubInstallationRepositories.id, input.repositoryId),
      ),
    )
    .limit(1);

  return repository ?? null;
}

async function projectExists(input: { organizationId: string; projectId: string }) {
  const [project] = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.organizationId, input.organizationId),
        eq(schema.projects.id, input.projectId),
      ),
    )
    .limit(1);

  return Boolean(project);
}

async function contentfulConnectionExists(input: { organizationId: string; connectionId: string }) {
  const [connection] = await db
    .select({ id: schema.contentfulConnections.id })
    .from(schema.contentfulConnections)
    .where(
      and(
        eq(schema.contentfulConnections.organizationId, input.organizationId),
        eq(schema.contentfulConnections.id, input.connectionId),
      ),
    )
    .limit(1);

  return Boolean(connection);
}

async function validateAutomationReferences(input: {
  organizationId: string;
  repositoryTarget: WorkspaceAutomationRepositoryTarget;
  toolConfig: WorkspaceAutomationToolConfig;
}): Promise<
  | "ok"
  | "github_repository_not_found"
  | "github_repository_not_enabled"
  | "github_repository_archived"
  | "project_not_found"
  | "contentful_connection_not_found"
> {
  if (
    input.repositoryTarget.kind === "github" &&
    input.repositoryTarget.githubInstallationRepositoryId
  ) {
    const repository = await getOwnedGithubRepository({
      organizationId: input.organizationId,
      repositoryId: input.repositoryTarget.githubInstallationRepositoryId,
    });

    if (!repository) {
      return "github_repository_not_found";
    }
    if (!repository.enabled) {
      return "github_repository_not_enabled";
    }
    if (repository.archived) {
      return "github_repository_archived";
    }
  }

  const projectId = input.toolConfig.github?.projectId;
  if (projectId) {
    const foundProject = await projectExists({
      organizationId: input.organizationId,
      projectId,
    });
    if (!foundProject) {
      return "project_not_found";
    }
  }

  const contentfulProjectId = input.toolConfig.contentful?.projectId;
  if (contentfulProjectId) {
    const foundProject = await projectExists({
      organizationId: input.organizationId,
      projectId: contentfulProjectId,
    });
    if (!foundProject) {
      return "project_not_found";
    }
  }

  const contentfulConnectionId = input.toolConfig.contentful?.connectionId;
  if (contentfulConnectionId) {
    const foundConnection = await contentfulConnectionExists({
      organizationId: input.organizationId,
      connectionId: contentfulConnectionId,
    });
    if (!foundConnection) {
      return "contentful_connection_not_found";
    }
  }

  return "ok";
}

function parseNextRunAt(value: string | null | undefined) {
  return value === undefined ? undefined : value === null ? null : new Date(value);
}

function mapAutomationError(c: Parameters<typeof badRequestResponse>[0], error: unknown) {
  if (error instanceof Error) {
    if (error.message === "workspace_automation_not_found") {
      return notFoundResponse(c, "workspace_automation_not_found");
    }
  }

  throw error;
}

function mapAutomationConfigValidationError(
  c: Parameters<typeof badRequestResponse>[0],
  error: WorkspaceAutomationConfigValidationError,
) {
  return badRequestResponse(c, error.code, error.message);
}

function mapReferenceError(
  c: Parameters<typeof badRequestResponse>[0],
  error: Exclude<Awaited<ReturnType<typeof validateAutomationReferences>>, "ok">,
) {
  switch (error) {
    case "github_repository_not_found":
      return notFoundResponse(c, error);
    case "github_repository_not_enabled":
      return badRequestResponse(c, error, "Enable this repository before configuring automation.");
    case "github_repository_archived":
      return badRequestResponse(
        c,
        error,
        "Cannot configure automation for an archived repository.",
      );
    case "project_not_found":
      return notFoundResponse(c, error);
    case "contentful_connection_not_found":
      return notFoundResponse(c, error);
  }
}

function mapWorkspaceResourceLimitError(
  c: Parameters<typeof conflictResponse>[0],
  error: WorkspaceResourceLimitError,
) {
  if (error.code === "workspace_resource_limit_check_failed") {
    return serviceUnavailableResponse(
      c,
      error.code,
      "Unable to verify automation limits. Try again later.",
    );
  }

  return conflictResponse(
    c,
    error.code,
    workspaceResourceLimitMessage(error.featureId),
    workspaceResourceLimitErrorDetails(error),
  );
}

export function createWorkspaceAutomationRoutes() {
  return new Hono<{ Variables: AuthVariables }>()
    .use("*", workosAuthMiddleware)
    .use("*", async (c, next) => {
      if (!isWorkspaceOperatorRole(c.var.auth.membership.role)) {
        return forbiddenResponse(c);
      }
      return next();
    })
    .get("/", validateListQuery, async (c) => {
      const query = c.req.valid("query");
      const automations = await listWorkspaceAutomations({
        organizationId: c.var.auth.organization.localOrganizationId,
        status: query.status,
        limit: query.limit,
        offset: query.offset,
      });

      return c.json({ automations }, 200);
    })
    .post("/", validateCreateBody, async (c) => {
      const payload = c.req.valid("json");
      const organizationId = c.var.auth.organization.localOrganizationId;

      const referenceError = await validateAutomationReferences({
        organizationId,
        repositoryTarget: payload.repositoryTarget,
        toolConfig: payload.toolConfig,
      });
      if (referenceError !== "ok") {
        return mapReferenceError(c, referenceError);
      }

      try {
        const createInput = {
          organizationId,
          authorUserId: c.var.auth.user.localUserId,
          status: payload.status,
          name: payload.name,
          instructions: payload.instructions,
          triggerConfig: payload.triggerConfig,
          repositoryTarget: payload.repositoryTarget,
          toolConfig: payload.toolConfig,
          nextRunAt: parseNextRunAt(payload.nextRunAt),
        };

        let result;
        if (payload.status !== "archived") {
          const limitWrapped = await withWorkspaceResourceLimit(
            {
              organizationId,
              featureId: workspaceResourceFeatureIds.automations,
            },
            (tx) => createWorkspaceAutomation({ ...createInput, db: tx }),
          );
          if (!limitWrapped.ok) {
            return mapWorkspaceResourceLimitError(c, limitWrapped.error);
          }
          result = limitWrapped.value;
        } else {
          result = await createWorkspaceAutomation(createInput);
        }

        if (isErr(result)) {
          return mapAutomationConfigValidationError(c, result.error);
        }

        return c.json({ automation: result.value, recentRuns: [] }, 201);
      } catch (error) {
        return mapAutomationError(c, error);
      }
    })
    .get("/:automationId", validateAutomationParams, async (c) => {
      const params = c.req.valid("param");
      const organizationId = c.var.auth.organization.localOrganizationId;
      const automation = await getWorkspaceAutomationById({
        automationId: params.automationId,
        organizationId,
      });

      if (!automation) {
        return notFoundResponse(c, "workspace_automation_not_found");
      }

      const recentRuns = await listWorkspaceAutomationRuns({
        automationId: automation.id,
        organizationId,
        limit: 10,
      });

      return c.json({ automation, recentRuns }, 200);
    })
    .patch("/:automationId", validateAutomationParams, validateUpdateBody, async (c) => {
      const params = c.req.valid("param");
      const payload = c.req.valid("json");
      const organizationId = c.var.auth.organization.localOrganizationId;
      const existing = await getWorkspaceAutomationById({
        automationId: params.automationId,
        organizationId,
      });

      if (!existing) {
        return notFoundResponse(c, "workspace_automation_not_found");
      }

      const referenceError = await validateAutomationReferences({
        organizationId,
        repositoryTarget: payload.repositoryTarget ?? existing.repositoryTarget,
        toolConfig: payload.toolConfig ?? existing.toolConfig,
      });
      if (referenceError !== "ok") {
        return mapReferenceError(c, referenceError);
      }

      try {
        const updateInput = {
          automationId: params.automationId,
          organizationId,
          status: payload.status,
          name: payload.name,
          instructions: payload.instructions,
          triggerConfig: payload.triggerConfig,
          repositoryTarget: payload.repositoryTarget,
          toolConfig: payload.toolConfig,
          nextRunAt: parseNextRunAt(payload.nextRunAt),
        };
        const shouldEnforceAutomationLimit =
          existing.status === "archived" && payload.status && payload.status !== "archived";

        let result;
        if (shouldEnforceAutomationLimit) {
          const limitWrapped = await withWorkspaceResourceLimit(
            {
              organizationId,
              featureId: workspaceResourceFeatureIds.automations,
            },
            (tx) => updateWorkspaceAutomation({ ...updateInput, db: tx }),
          );
          if (!limitWrapped.ok) {
            return mapWorkspaceResourceLimitError(c, limitWrapped.error);
          }
          result = limitWrapped.value;
        } else {
          result = await updateWorkspaceAutomation(updateInput);
        }
        if (isErr(result)) {
          return mapAutomationConfigValidationError(c, result.error);
        }

        if (!result.value) {
          return notFoundResponse(c, "workspace_automation_not_found");
        }

        const recentRuns = await listWorkspaceAutomationRuns({
          automationId: result.value.id,
          organizationId,
          limit: 10,
        });

        return c.json({ automation: result.value, recentRuns }, 200);
      } catch (error) {
        return mapAutomationError(c, error);
      }
    })
    .delete("/:automationId", validateAutomationParams, async (c) => {
      const params = c.req.valid("param");
      const organizationId = c.var.auth.organization.localOrganizationId;
      const result = await updateWorkspaceAutomation({
        automationId: params.automationId,
        organizationId,
        status: "archived",
        nextRunAt: null,
      });

      if (isErr(result)) {
        return mapAutomationConfigValidationError(c, result.error);
      }

      if (!result.value) {
        return notFoundResponse(c, "workspace_automation_not_found");
      }

      return c.body(null, 204);
    })
    .get("/:automationId/runs", validateAutomationParams, validateRunsQuery, async (c) => {
      const params = c.req.valid("param");
      const query = c.req.valid("query");
      const organizationId = c.var.auth.organization.localOrganizationId;
      const automation = await getWorkspaceAutomationById({
        automationId: params.automationId,
        organizationId,
      });

      if (!automation) {
        return notFoundResponse(c, "workspace_automation_not_found");
      }

      const automationRuns = await listWorkspaceAutomationRuns({
        automationId: automation.id,
        organizationId,
        limit: query.limit,
        offset: query.offset,
      });

      return c.json({ automationRuns }, 200);
    })
    .post("/:automationId/runs", validateAutomationParams, validateRunBody, async (c) => {
      const params = c.req.valid("param");
      const payload = c.req.valid("json");
      const organizationId = c.var.auth.organization.localOrganizationId;
      const automation = await getWorkspaceAutomationById({
        automationId: params.automationId,
        organizationId,
      });

      if (!automation) {
        return notFoundResponse(c, "workspace_automation_not_found");
      }
      if (automation.status === "archived") {
        return badRequestResponse(
          c,
          "workspace_automation_archived",
          "Archived automations cannot be run.",
        );
      }

      const referenceError = await validateAutomationReferences({
        organizationId,
        repositoryTarget: automation.repositoryTarget,
        toolConfig: automation.toolConfig,
      });
      if (referenceError !== "ok") {
        return mapReferenceError(c, referenceError);
      }

      try {
        const result = await dispatchManualWorkspaceAutomationRun({
          automation,
          idempotencyKey: payload.idempotencyKey,
          inputSnapshot: payload.inputSnapshot,
        });

        if (!result) {
          return badRequestResponse(
            c,
            "manual_run_not_supported",
            "Manual runs require at least one enabled workflow or notification tool.",
          );
        }

        const automationRun = await getWorkspaceAutomationRunById({
          runId: result.runId,
          organizationId,
        });
        if (!automationRun) {
          throw new Error("workspace_automation_run_not_found");
        }

        return c.json({ automationRun, dispatch: result }, 202);
      } catch (error) {
        return mapAutomationError(c, error);
      }
    })
    .get("/:automationId/memory", validateAutomationParams, async (c) => {
      const params = c.req.valid("param");
      const organizationId = c.var.auth.organization.localOrganizationId;
      const automation = await getWorkspaceAutomationById({
        automationId: params.automationId,
        organizationId,
      });
      if (!automation) {
        return notFoundResponse(c, "workspace_automation_not_found");
      }

      const workspaceAutomationMemory = await getWorkspaceAutomationMemory({
        automationId: automation.id,
      });
      setWorkspaceAutomationMemoryEtag(c, workspaceAutomationMemory);

      return c.json({ workspaceAutomationMemory }, 200);
    })
    .put("/:automationId/memory", validateAutomationParams, validateUpdateMemoryBody, async (c) => {
      if (!hasCapability(c.var.auth.membership.role, "workspace:update")) {
        return forbiddenResponse(
          c,
          "forbidden",
          "Only workspace admins can update this automation's memory",
        );
      }

      const params = c.req.valid("param");
      const organizationId = c.var.auth.organization.localOrganizationId;
      const automation = await getWorkspaceAutomationById({
        automationId: params.automationId,
        organizationId,
      });
      if (!automation) {
        return notFoundResponse(c, "workspace_automation_not_found");
      }

      const precondition = validateWorkspaceAutomationMemoryPrecondition(c);
      if (precondition instanceof Response) {
        return precondition;
      }

      const payload = c.req.valid("json");
      const result = await commitWorkspaceAutomationMemory({
        automationId: automation.id,
        organizationId,
        updatedByUserId: c.var.auth.user.localUserId,
        content: payload.content,
        summary: payload.summary,
        expectedRevisionId: precondition.expectedRevisionId,
      });

      if (isErr(result)) {
        return workspaceAutomationMemoryPreconditionFailedResponse(c, result.error.current);
      }

      if (payload.includeOrgKnowledge !== undefined) {
        await setWorkspaceAutomationMemoryIncludeOrgKnowledge({
          automationId: automation.id,
          organizationId,
          includeOrgKnowledge: payload.includeOrgKnowledge,
        });
      }

      const workspaceAutomationMemory =
        payload.includeOrgKnowledge !== undefined
          ? await getWorkspaceAutomationMemory({ automationId: automation.id })
          : result.value.workspaceAutomationMemory;

      setWorkspaceAutomationMemoryEtag(c, workspaceAutomationMemory);
      return c.json({ workspaceAutomationMemory }, 200);
    })
    .get(
      "/:automationId/memory/revisions",
      validateAutomationParams,
      validateMemoryRevisionListQuery,
      async (c) => {
        const params = c.req.valid("param");
        const organizationId = c.var.auth.organization.localOrganizationId;
        const automation = await getWorkspaceAutomationById({
          automationId: params.automationId,
          organizationId,
        });
        if (!automation) {
          return notFoundResponse(c, "workspace_automation_not_found");
        }

        const query = c.req.valid("query");
        const result = await listWorkspaceAutomationMemoryRevisions({
          automationId: automation.id,
          limit: query.limit,
          cursor: query.cursor,
        });

        return c.json(result, 200);
      },
    )
    .get("/:automationId/memory/revisions/:revisionId", validateMemoryRevisionParams, async (c) => {
      const params = c.req.valid("param");
      const organizationId = c.var.auth.organization.localOrganizationId;
      const automation = await getWorkspaceAutomationById({
        automationId: params.automationId,
        organizationId,
      });
      if (!automation) {
        return notFoundResponse(c, "workspace_automation_not_found");
      }

      const result = await getWorkspaceAutomationMemoryRevision({
        automationId: automation.id,
        revisionId: params.revisionId,
      });
      if (!result) {
        return notFoundResponse(
          c,
          "workspace_automation_memory_revision_not_found",
          "Automation memory revision was not found",
        );
      }

      return c.json(result, 200);
    })
    .post(
      "/:automationId/memory/revisions/:revisionId/restore",
      validateMemoryRevisionParams,
      async (c) => {
        if (!hasCapability(c.var.auth.membership.role, "workspace:update")) {
          return forbiddenResponse(
            c,
            "forbidden",
            "Only workspace admins can restore this automation's memory",
          );
        }

        const params = c.req.valid("param");
        const organizationId = c.var.auth.organization.localOrganizationId;
        const automation = await getWorkspaceAutomationById({
          automationId: params.automationId,
          organizationId,
        });
        if (!automation) {
          return notFoundResponse(c, "workspace_automation_not_found");
        }

        const precondition = validateWorkspaceAutomationMemoryPrecondition(c);
        if (precondition instanceof Response) {
          return precondition;
        }

        const result = await restoreWorkspaceAutomationMemoryRevision({
          automationId: automation.id,
          organizationId,
          revisionId: params.revisionId,
          restoredByUserId: c.var.auth.user.localUserId,
          expectedRevisionId: precondition.expectedRevisionId,
        });

        if (isErr(result)) {
          if (result.error.code === "revision_not_found") {
            return notFoundResponse(
              c,
              "workspace_automation_memory_revision_not_found",
              "Automation memory revision was not found",
            );
          }
          return workspaceAutomationMemoryPreconditionFailedResponse(c, result.error.current);
        }

        setWorkspaceAutomationMemoryEtag(c, result.value.workspaceAutomationMemory);
        return c.json({ workspaceAutomationMemory: result.value.workspaceAutomationMemory }, 200);
      },
    );
}
