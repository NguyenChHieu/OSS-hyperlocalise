# Automation knowledge memories

## Problem

Workspace automations can use GitHub, Contentful, translation, Slack, and email
tools, but they cannot opt into the organization knowledge base. Teams already
edit that guidance under **Knowledge**; automations should reuse it as a
built-in tool with manage/edit in the automation UI.

## Decision

Treat organization knowledge memory as a built-in automation tool named
**Memories**.

- Store opt-in in `toolConfig.knowledge: { enabled: boolean }`.
- Show **Memories** under a **Built-in** group in Add Tool.
- When enabled, show a Tools row with **Manage** and remove.
- **Manage** opens a sheet that reuses `KnowledgeMemoryEditor`.
- Gate adding Memories on the `workspace-knowledge` flag and
  `workspace:update` for edits (same as the Knowledge page).
- At run time, when enabled, select relevant knowledge and append it to
  composed orchestrator instructions. Do not add a forced orchestrator tool
  call; knowledge guides other planned tools.
- Memories alone does not count as an activatable workflow tool.

## Behavior

1. User adds **Memories** from Add Tool → Built-in.
2. Tools list shows Memories with **Manage** and delete.
3. **Manage** edits the shared org knowledge markdown memory.
4. On run, if `toolConfig.knowledge.enabled`, load memory, select context from
   automation name/instructions, and inject under `## Workspace knowledge`.

## Out of scope

Per-automation private memories, translation-memory (TM) tools, outbound MCP
servers, and forcing a `consult_knowledge_memory` tool step.

---

# Update 2026-08-03 — recall and save become explicit tool calls

Minh confirmed the MVP direction for how automations interact with Memory: still one memory
store (org-level `Memory.md`), still no per-automation store, but access moves from passive
prompt injection to explicit tool calls the agent decides to make.

## What changes

- `toolConfig.knowledge` gets a second field, `allowUpdates` (meaningless without `enabled`),
  surfaced in the UI as two toggles: **Use organization memory** / **Allow memory updates**.
  The tool permission plus the automation's own user-written instructions is the whole approval
  boundary — no automatic risk classification, no approval inbox, by design for MVP.
- **Recall becomes a tool call.** Previously, `toolConfig.knowledge.enabled` caused
  `selectKnowledgeMemoryContext` output to be silently pasted into the composed instructions
  before every run (step 4 above). That's replaced by a `recall_memory` tool
  (`tools/recall_memory.ts`) the agent calls with its own query, reusing the same
  `selectKnowledgeMemoryContext` call but driven by a model-supplied question instead of an
  automatic one. `compose-workspace-instructions.ts` adds a one-line nudge when the tool is
  available, so automations don't silently lose the always-present context they used to get.
- **Save is new**, append-only. `save_memory.ts` appends to `Memory.md` through the same
  `commitKnowledgeMemoryForOrganization` compare-and-swap a human edit goes through, so an
  agent-authored append is a normal, restorable revision — same optimistic concurrency, same
  50,000-character cap (enforced in the tool itself, since it calls the commit function
  directly rather than through the HTTP route where that cap normally lives). It cannot edit,
  replace, or delete existing content. There's no human actor for these commits —
  `updatedByUserId` is `null` (the column and the shared `commitVersionedDocument` type were
  widened to allow this); real provenance (automation name, run id) goes in the revision
  `summary` instead.

## Still out of scope

Per-automation memory, Upstash, automatic write triggers without an explicit tool call,
contradiction/dedup handling, and any approval workflow beyond the tool-permission gate itself.
