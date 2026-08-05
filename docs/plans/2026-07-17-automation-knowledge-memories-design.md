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

# Update 2026-08-01 — per-automation Memory shipped

Per-automation memories were listed **out of scope** above. They shipped anyway
in [#1616](https://github.com/hyperlocalise/hyperlocalise/pull/1616). This
section records what actually changed and the decision still open, so the doc
stops disagreeing with the code.

## Why the scope changed

Org knowledge is shared by every automation in the workspace. Teams running
several automations wanted guidance that applies to *one* of them without
leaking into the rest — a nightly sync's escalation rules should not steer an
unrelated marketing-copy automation. The out-of-scope call assumed one shared
document would be enough; it was not.

## Two distinct concepts

Keeping these separate matters — they were starting to blur under the shared
"Memories" label:

- **Knowledge** — human-curated, **org-wide**, edited on the Knowledge page.
  Stored in `knowledge_memories`. Unchanged by #1616.
- **Memory** — human-curated, **per-automation**, edited from that automation's
  Manage sheet. Stored in `workspace_automation_memories`.

Both are versioned markdown documents sharing the same commit/revision
machinery (`src/lib/versioned-document/`), and both are injected into the
orchestrator prompt via the same selector
(`selectKnowledgeMemoryContext`).

## The `includeOrgKnowledge` tri-state — a known sharp edge

An automation can have its own Memory *and* still want org Knowledge alongside
it. That is the "Also include organization-wide Memory" checkbox. It interacts
with the older `toolConfig.knowledge.enabled` toggle as a **tri-state**
(`run-workspace-orchestrator.ts`):

| Automation Memory | Org knowledge decided by |
|---|---|
| empty | `toolConfig.knowledge.enabled` (legacy toggle, unchanged) |
| non-empty, include **on** | forced **in** — overrides the legacy toggle |
| non-empty, include **off** | forced **out** — overrides the legacy toggle |

This is genuinely awkward, and worth being explicit about why it is not simply
collapsed into one flag: `includeOrgKnowledge` **defaults to `true`**, so making
it unconditionally authoritative would start injecting org knowledge into
automations that have `knowledge.enabled === false` and no Memory at all — a
silent behaviour change for existing users. Collapsing it properly needs a
nullable column (`null` = "not set, defer to the legacy toggle") plus a
migration.

That migration is deliberately **not** done yet, because the open question
below could remove the need for it entirely. The three paths are pinned by
tests in `resolve-workspace-automation-memory.test.ts` so the semantics cannot
drift in the meantime.

## Open question — human-curated documents vs agent-written facts

`cursor[bot]` reviewed #1616 and argued per-automation Memory should not be a
human-edited document at all: agents should own it, writing and recalling facts
through tools, with humans limited to inspect/clear.

That is a real product question and worth deciding deliberately. Two things to
be clear about when deciding it:

- The review names **Upstash AgentKit** as the target. As of this writing
  Upstash has **no footprint in this repository** — no dependency, no design
  note, no prior decision. It should be evaluated on its merits, not treated as
  settled direction.
- Earlier research (see the truncation work behind
  [#1636](https://github.com/hyperlocalise/hyperlocalise/pull/1636)) concluded
  an external retrieval backend does **not** address the prompt-truncation
  problem it was originally raised for. That answers a *different* question than
  agent-owned memory, so it is not a rebuttal — but it does mean the two should
  not be conflated.

Agent-written memory is plausible as an **addition** later (there is precedent:
several orchestrator tools already write back during a run). It does not
require deleting the human-curated layer. **Decision owner: Minh.**

---

# Update 2026-08-03 — MVP decision: no per-automation store, tool-mediated org Memory

Minh decided the open question above. The per-automation Memory design (previous section) is
**abandoned for MVP**, not extended. There is still only one memory store — the org-level
`Memory.md` — and #1616 was reworked to match rather than merged as originally shipped.

## The decision

- `workspace_automation_memories` and its revision table are removed. No separate agent/automation
  memory store. The per-automation Manage sheet, editor, and REST routes from the previous section
  no longer exist.
- Automations get controlled access to the single org `Memory.md` through two `toolConfig.knowledge`
  fields and the automation's own user-written instructions, which is the approval boundary:
  - `enabled` ("Use organization memory") — same field as before, now also gates a callable
    `recall_memory` tool instead of silently pasting content into composed instructions.
  - `allowUpdates` ("Allow memory updates") — new, meaningless without `enabled`. Gates a callable
    `save_memory` tool that appends to the shared `Memory.md`.
- No automatic risk classification, no approval inbox, no per-automation trust levels. The tool
  permission plus the automation's own instructions are the only gate, by design, for MVP.

## Recall became a tool call, not passive injection

Before this change, `toolConfig.knowledge.enabled` caused `selectKnowledgeMemoryContext` output to
be silently pasted into the composed instructions before every run
(`resolve-workspace-automation-knowledge.ts`, now deleted). Minh confirmed recall should instead be
a real tool call the agent decides to make (`recall_memory.ts`), reusing the same
`selectKnowledgeMemoryContext` call but driven by a model-supplied query instead of an automatic
one. `compose-workspace-instructions.ts` adds a one-line nudge when the tool is available, so
automations that relied on the old always-present context aren't silently worse off.

## Save is append-only

`save_memory.ts` appends to the existing `Memory.md` through the same
`commitKnowledgeMemoryForOrganization` compare-and-swap every human edit goes through, so an
agent-authored append is a normal, restorable revision — same optimistic concurrency, same
50,000-character cap (checked in the tool, since it calls the commit function directly rather than
through the HTTP route where that cap was previously enforced). It cannot edit, replace, or delete
existing content. There is no human actor for these commits — `updatedByUserId` is `null` (the
column and the shared `commitVersionedDocument` type were widened to allow this); real provenance
(automation name, run id) goes in the revision `summary` instead.

## What this makes moot

The `includeOrgKnowledge` tri-state described above no longer applies — there is no separate
automation Memory for it to arbitrate between. `resolveWorkspaceAutomationMemoryContext` and its
resolver are deleted along with the table.

## Still out of scope

Everything the earlier open question flagged as unresolved stays unresolved, deliberately: Upstash,
automatic write triggers without an explicit tool call, contradiction/dedup handling, and any
approval workflow. If agent-written memory needs those later, they're new scope on top of this,
not a gap in it.
