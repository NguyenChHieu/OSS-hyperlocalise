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
import { isTriggerType } from "./node-catalog";
import type { MockValidationIssue, VisualWorkflowRfEdge, VisualWorkflowRfNode } from "./types";

export function validateMockWorkflow(
  nodes: readonly VisualWorkflowRfNode[],
  edges: readonly VisualWorkflowRfEdge[],
): MockValidationIssue[] {
  const issues: MockValidationIssue[] = [];
  const triggers = nodes.filter((node) => isTriggerType(node.data.catalogType));

  if (triggers.length === 0) {
    issues.push({ code: "missing_trigger" });
  } else if (triggers.length > 1) {
    issues.push({ code: "multiple_triggers" });
  }

  const incoming = new Set(edges.map((edge) => edge.target));
  for (const node of nodes) {
    if (isTriggerType(node.data.catalogType)) {
      continue;
    }
    if (!incoming.has(node.id)) {
      issues.push({ code: "orphan_node", nodeId: node.id });
    }
  }

  return issues;
}
