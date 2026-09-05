---
name: log-view
description: "Explains how the /session-log view in the Maestro desktop app is built end-to-end: the thin left step list, the center framed log pane, the right Input/Process/Output detail panel, how log entries map to Instance segments, how channel_delivery entries (`037`) attach to the RECEIVING instance rather than the sender, how a resumed agent's two cards (`039`) are each correlated to their own run by bounding every agent_id lookup by log position (`042`), and how the maestro-session-log.js / maestro-subagent-log.js / maestro-inject-agent-context.js hooks write the maestro_session.log.jsonl it reads. Use when the user is working inside apps/maestro and asks how the session-log view works, how cards/instances are derived, where SUCCESS/FAILURE comes from, why the log is empty, why a step has no status icon, how dispatch/handoff entries are produced by the hooks, why a delivered channel payload does or doesn't show up on the right card, or how a resumed agent's (`039`) two cards each get their own run's input/offeredSkills/deliveries (`042`)."
metadata:
  type: concept-skill
  version: "2.3"
  last-update: e90c2a974a94dc6c1709097f36b4563af9bdd468
---

# Log View

The `/session-log` route (`src/renderer/src/routes/session-log.tsx`) is a **read-only debugger** for Maestro workflow sessions. It reads `<projectRoot>/.claude/maestro_session.log.jsonl` and presents it in three panes: a **thin left step list** (step names with status icons), a **center framed log** (humanized tool calls per step in rounded bordered sections), and a **right detail panel** (Input/Process/Output for the selected step). Clicking a step in any pane selects it across all three.

This is the **read side** of the Maestro runtime: it displays what the hook scripts write. See the `maestro-architecture` skill for the **write side** (how the log is produced and the full HANDOFF routing contract). See the `workflow-view` skill for the sibling `/workflows` authoring view.

## Layout

```
┌──────────────────────────────── TopNav (top-nav.tsx) ────────────────────────────────┐
│ Workflows | Rules | Session Log                                                  ☀    │
├────────────┬─────────────────────────────────────┬──────────────────────────────────┤
│ Left       │ Center — SessionLogView              │ Right — SessionLogDetail          │
│ Cards      │ (session-log-view.tsx)               │ (session-log-detail.tsx)          │
│ (cards.tsx)│                                      │                                   │
│            │  Agents Flow                 ● live  │  Logs: Backend (1)                │
│ Workflow   │                                      │                                   │
│            │  ┌────────────────────────────────┐  │  Input                            │
│ ✓ Main Ses │  │ Main Session                   │  │  Create a button component…       │
│ ✓ Backend  │  │ - calling `backend` agent      │  │  Delivered from @scribe  channel   │
│ ✓ Human R  │  │ - …                            │  │  Process                          │
│ ✗ Test     │  └────────────────────────────────┘  │  - [Backend]: read file `…`       │
│ ✓ Backend  │                                      │  - [Backend]: wrote file `…`      │
│ ✓ Test     │  ┌════════════════════════════════┐  │  - …                              │
│ ⚠ Reviewer │  ║ Backend (1)  ⤓1     «green»    ║  │                                   │
│ ✓ Scribe   │  ║ - calling backend agent        ║  │  Output                           │
│            │  ║ - [Backend]: read file `…`     ║  │  Created a button component …     │
│            │  ║ - [Backend]: wrote file `…`    ║  │                                   │
│            │  └════════════════════════════════┘  │                                   │
│            │                                      │                                   │
│            │  ┌────────────────────────────────┐  │                                   │
│            │  │ Human Review                   │  │                                   │
│            │  │ - …                            │  │                                   │
│            │  └────────────────────────────────┘  │                                   │
│            │                                      │                                   │
└────────────┴─────────────────────────────────────┴──────────────────────────────────┘
   180px                     1fr                                320px
```

**No workflow selector and no YAML preview toggle** — TopNav is rendered bare (no `workflowSelector` or `onPreviewToggle` props). When the log file is absent the whole three-pane layout is replaced by an **empty state**: a centred `ScrollText` icon + "No session log found" message + a `● live / ○ connecting…` indicator (the log is ephemeral, so this is the normal between-sessions condition).

## Data flow

```
App-wide (src/renderer/src/routes/__root.tsx)
  <SessionLogProvider>  (src/renderer/src/utils/session-log-context.tsx)
    └── window.maestro.log.subscribe({ onInit, onEntry, onReset })
          MAIN process (src/main/ipc.ts) owns the tail: it polls
          maestro_session.log.jsonl and pushes over the `log:init` /
          `log:entry` / `log:reset` channels
          → init (full snapshot) / entry (new line) / reset (file deleted)
          events update: entries[], connected
                                     │
       ┌─────────────────────────────┘
       ▼
SessionLogPage (src/renderer/src/routes/session-log.tsx)
  const { entries, connected } = useSessionLog()
  instances = useMemo(() => buildInstances(entries))  → Instance[]
  activeId state (which step is selected)
  activeInstance = instances.find(id === activeId)
  sectionRefs: Record<id, HTMLDivElement|null>  (one per instance section in the center pane)
       │
       ├──▶ SessionLogCards (left)
       │      renders Instance[] as a compact step list with status icons
       │      onSelect(id): setActiveId(id) + sectionRefs[id].scrollIntoView()
       │
       ├──▶ SessionLogView (center)
       │      renders per-instance sections in rounded bordered frames
       │      onClick on a frame: onSelect(id) → selects step across all panes
       │      selected frame gets border-2 colored by status (green/red/yellow)
       │      header shows "● live" / "○ reconnecting…" from connected
       │
       └──▶ SessionLogDetail (right)
              shows Input / Process / Output for the activeInstance
              Input = instance.input (spawning message from dispatch entry)
              Process = humanized log lines (same as center pane)
              Output = instance.output (final message from handoff entry)

TopNav (every Maestro page): "● Session Log" dot driven by useSessionLog().connected
```

**Upstream — where the log comes from:**

```
Active Maestro session
  PreToolUse hook   → maestro-session-log.js       → tool-call entry      (ts, origin, log)
  SubagentStart     → maestro-subagent-log.js       → dispatch entry      (kind:"dispatch", agent, agent_id, input)
  SubagentStart     → maestro-inject-agent-context.js → channel_delivery entry (kind:"channel_delivery", sender, receiver, agent_id, content) — (`036`/`037`)
  SubagentStop      → maestro-subagent-log.js       → handoff entry       (kind:"handoff", agent_id, status, label, output)
  SessionEnd        → maestro-session-cleanup.sh    → DELETE maestro_session.log.jsonl
```

All four hooks append to the same file. All are no-ops when `maestro.json` is absent. The file is deleted at SessionEnd, so the empty state is normal.

**`channel_delivery` is written by the INJECTOR, not the logger script.** `maestro-inject-agent-context.js` is the same `SubagentStart` hook that inlines a channel payload as `additionalContext` (see `maestro-architecture`'s HANDOFF routing contract) — it appends this log entry itself, at the same moment, so the log has a durable record of what was inlined without a second hook reading the same channel file. `origin` is hardcoded `"main_session"` on this entry, same as a `dispatch` entry — it is not written into the receiving agent's own segment, which is exactly why `buildInstances` correlates it by `agent_id` across the whole array rather than by which segment it landed in (see below).

## File-by-file map

Renderer paths are relative to `apps/maestro/`.

| Concern                                                                                                                        | File                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Route, state, 3-pane grid, scroll-sync, empty state                                                                            | `src/renderer/src/routes/session-log.tsx`                                             |
| Left step list with status icons (CircleCheck/CircleX/AlertTriangle)                                                           | `src/renderer/src/components/session-log-cards.tsx`                                   |
| Center framed log pane, click-to-select, live indicator, per-section anchors                                                   | `src/renderer/src/components/session-log-view.tsx`                                    |
| Right detail panel: Input/Process/Output sections                                                                              | `src/renderer/src/components/session-log-detail.tsx`                                  |
| **The tail itself** — polls the JSONL, pushes `log:init`/`log:entry`/`log:reset`; `tails` (running watchers) and `logSubscribers` (who asked, `038`) are separate sets | `src/main/ipc.ts`                                                                     |
| The typed channel contract                                                                                                     | `src/shared/ipc.ts` (`log:subscribe`, `log:unsubscribe`, and the three push channels) |
| App-wide subscriber: `SessionLogProvider`, `useSessionLog()`                                                                   | `src/renderer/src/utils/session-log-context.tsx`                                      |
| `parseLogLines` + `readSessionLog`                                                                                             | `session-log.ts` in `apps/maestro/src/core/`                                          |
| The `SessionLogEntry` shape crossing the wire                                                                                  | `contracts.ts` in `apps/maestro/src/core/`, re-exported by `src/shared/ipc.ts`        |
| Pure transforms `buildInstances` + `humanizeLog` + `parseSkillsTriage` + `unaccountedSkills` + `Instance`/`SkillsTriage` types | `src/renderer/src/utils/session-log.ts`                                               |
| Top bar — nav links incl. `ScrollText` + global `●` live dot                                                                   | `src/renderer/src/components/top-nav.tsx`                                             |
| `titleFromName` — origin string → display name                                                                                 | `src/renderer/src/utils/text.ts` (re-export of `src/core/text.ts`)                    |
| Yellow color tokens (`--yellow`, `--yellow-dim`)                                                                               | `packages/styles/scss/abstracts/_tokens.scss`                                         |
| **Writer — tool-call entries** (PreToolUse, matcher `.*`)                                                                      | `plugins/maestro/scripts/maestro-session-log.js`                             |
| **Writer — dispatch + handoff entries** (SubagentStart/Stop, matcher `.*`)                                                     | `plugins/maestro/scripts/maestro-subagent-log.js`                            |
| **Writer — `channel_delivery` entries** (SubagentStart, matcher `.*`)                                                          | `plugins/maestro/scripts/maestro-inject-agent-context.js`                    |
| The read-only `pendingLanes()` — `/maestro`'s undrained-backlog view, NOT this route's data (`037`)                            | `handoff-channels.ts` in `apps/maestro/src/core/`                             |
| Shared append helper (`appendSessionLog`, `readStdin`)                                                                         | `plugins/maestro/scripts/lib/maestro-session.cjs`                            |
| Hook registration (all three hooks registered here)                                                                            | `plugins/maestro/hooks/hooks.json`                                           |
| Source file (ephemeral, append-only, gitignored)                                                                               | `<projectRoot>/.claude/maestro_session.log.jsonl`                                     |

## The data model

### `SessionLogEntry` — what the JSONL file contains

Every line is a JSON object with at least `{ ts, origin, log }`. Additional fields are present only on `dispatch`/`handoff` entries:

```ts
interface SessionLogEntry {
  ts: string; // ISO-8601 UTC timestamp
  origin: string; // "main_session" | agent_type (e.g. "backend", "Explore")
  log: string; // human-readable one-liner: "Read(/path)", "Bash(cmd)", "→ backend", "HANDOFF: success"

  // Present only on dispatch entries (SubagentStart):
  kind?: "dispatch";
  agent?: string; // the subagent's agent_type
  agent_id?: string; // unique identifier — links this dispatch to its matching handoff
  input?: string; // full spawning message (what the main session said to spawn this agent)
  offered_skills?: { loaded: string[]; referenced: string[] }; // skills the SubagentStart hook surfaced to this agent

  // Present only on handoff entries (SubagentStop with an agent_type):
  kind?: "handoff";
  agent_id?: string; // matches the dispatch entry for this run
  status?: "success" | "condition" | "unknown";
  label?: string | null; // raw HANDOFF label; null for "success" outcome
  output?: string; // full final message (agent's last message, incl. HANDOFF: line + payload)

  // Present only on transition entries (SubagentStop with NO agent_type):
  kind?: "transition";
  output?: string; // the final message of the non-workflow turn (e.g. "waiting on the user")

  // Present only on channel_delivery entries (SubagentStart, `036`/`037`) — a payload the injector
  // inlined for the RECEIVING agent's next invocation. origin is always "main_session" here, same
  // as a dispatch entry; agent_id is the receiver's own dispatch/handoff correlation key, NOT a
  // fresh id of its own.
  kind?: "channel_delivery";
  agent_id?: string; // the receiving instance's agent_id — same key input/offeredSkills use
  sender?: string; // bare agent name that wrote the payload
  receiver?: string; // bare agent name it was delivered to
  content?: string; // the payload body, inlined verbatim (no stamp — that's stripped before logging)
}
```

A missing `kind` = a plain tool-call entry from `maestro-session-log.js`. The schema is **backward compatible**: old logs (tool-call-only) parse and display correctly; `dispatch`/`handoff`/`transition` fields simply don't appear.

**Transition vs handoff.** A `SubagentStop` only carries an `agent_type` when a real workflow agent is handing off. When `agent_type` is empty — a subagent stop that is not a workflow boundary at all — there is no HANDOFF contract to parse, so `maestro-subagent-log.js` writes a `kind:"transition"` entry with `origin:"transition"` instead of letting it fall back to `origin:"unknown"` + `status:"unknown"`. This is what keeps non-workflow boundaries from masquerading as failed/unknown agent runs.

### `Instance` — the derived client model

`buildInstances` in `src/renderer/src/utils/session-log.ts` groups entries into segments:

```ts
interface Instance {
  id: number; // position in the ordered list (stable key for all three panes)
  origin: string; // raw origin string
  displayName: string; // "Main Session" | titleFromName(origin)
  startIndex: number; // index of first entry in the flat entries[] array
  entries: SessionLogEntry[];

  status: "success" | "condition" | "unknown" | "transition" | null; // null = main_session; "transition" = non-workflow boundary
  label: string | null; // condition label, e.g. "tests_failed" (null for success)
  input: string | null; // spawning message from the matching dispatch entry
  output: string | null; // final message from this segment's handoff entry
  skillsTriage: SkillsTriage | null; // parsed { loaded[], skipped[{id,reason}] } from the agent's report
  offeredSkills: { loaded: string[]; referenced: string[] } | null; // from the dispatch entry's offered_skills
  delivered: ChannelDelivery[]; // channel_delivery entries logged at THIS instance's own SubagentStart (`037`); [] not omitted
}
```

`ChannelDelivery` is `{ sender, receiver, agent_id, content }` — the shape the detail panel's
"Delivered from @`<sender>`" block renders (`session-log-detail.tsx`). Always an array, even when
empty, so a template never has to special-case "no deliveries" from "not yet computed".

`skillsTriage` is parsed from `output` by `parseSkillsTriage` (pure, in `session-log.ts`): it grabs the last fenced ` ```json ` block, `JSON.parse`s it, and reads the `skillsTriage` field every skill-receiving agent emits in its final report (see `plugins/maestro/agents/*.md`). Any parse/shape failure yields `null`, so the section is simply omitted — fully backward compatible with older logs and agents that don't emit it. The triage data is already in `output`; that parse is a pure read-side interpretation.

`offeredSkills` is the _other_ side of the diff: the skills the `SubagentStart` hook actually surfaced, written onto the **dispatch** entry by `maestro-subagent-log.js` (correlated to the instance by `agent_id`, same as `input`). `unaccountedSkills(inst)` is the diff — skills that were offered but appear in neither `triage.loaded` nor `triage.skipped`, i.e. the agent **silently dropped** them. It returns `[]` unless both sides are present (a diff is only meaningful when we know what was offered _and_ what was reported). This is what makes the triage auditable rather than self-reported: a hollow _reason_ flags a lazy skip, but an unaccounted skill catches a skill the agent omitted from its report entirely.

## Left pane — step list (`session-log-cards.tsx`)

A thin (180px) vertical list of step names with status icons. Each row:

- **Status icon** (from `lucide-react`):
  - `"success"` → `CircleCheck` in `text-(--green)`
  - `"condition"` → `CircleX` in `text-(--red)`
  - `"unknown"` → `AlertTriangle` in `text-(--yellow)`
  - `"transition"` → hollow `Circle` in `text-(--ink-3)` (neutral — a non-workflow boundary, not an error)
  - Main Session (`status: null`) → `CircleCheck` in `text-(--green)` (default)
- **Click** → `onSelect(id)` → `setActiveId(id)` + `scrollIntoView` on the matching center-pane section.
- **Active step** → `font-medium` + a `border-b-2` underline colored by status (green/red/yellow).
- **Skills badge** (right-aligned, only when `inst.skillsTriage` is set) → compact `<loaded>` in `--green`, `/<skipped>` in `--yellow`, and `/<unaccounted>` in `--red`. Lets you scan which steps skipped or silently dropped skills without opening each detail panel.
- **Delivery count** (`037`) → an `Inbox` icon + `inst.delivered.length` when non-zero, the same at-a-glance class of signal as the skills badge. Omitted when `delivered` is empty.

## Center pane — framed log (`session-log-view.tsx`)

A header row ("Agents Flow" + `● live` indicator) above a scrollable body of per-instance sections. Each section is wrapped in a **rounded bordered frame** (`border rounded-lg p-4`):

- **Click** anywhere in the frame → `onSelect(id)` → selects the step across all panes.
- **Selected frame** → `border-2` colored by status: `border-[var(--green)]` / `border-[var(--red)]` / `border-[var(--yellow)]` / `border-[var(--line-2)]` (transition, neutral).
- **Default frame** → `border border-(--line)`.
- Content: humanized log lines via `humanizeLog(entry)`, same as before.
- **Section header** shows the `displayName` and, when `inst.skillsTriage` is set, a `<N> loaded · <N> skipped · <N> unaccounted` badge (green / yellow / red — each segment shown only when non-zero). It also shows a delivery count (`037`), the same value as the left pane's badge.

## Right pane — detail panel (`session-log-detail.tsx`)

Shows the selected instance's data in three sections:

- **Header:** "Logs: {displayName}"
- **Input:** the instance's `input` field — the full spawning message sent by the main session — followed by each entry in `inst.delivered` (`037`), rendered as "Delivered from @`<sender>`" plus a "channel" badge and the content verbatim in a `<pre>` block, in log order. Renders nothing extra when `delivered` is empty; shows "No input captured" for main_session instances or when there is neither a dispatch entry nor a delivery.
- **Process:** the humanized log lines (same content as the center pane section for this step).
- **Skills Triage:** (only when `instance.skillsTriage` is set) the agent's own account of which injected skills it loaded vs deliberately skipped, audited against what was offered. **Loaded** render as green chips; **Unaccounted** (`unaccountedSkills(instance)` — offered but reported in neither loaded nor skipped) render as red chips; **Skipped** render as `id — reason`, with a hollow reason (`< 8` chars) flagged in `--yellow`. Hollow reasons surface lazy _explicit_ skips; the red unaccounted group surfaces skills the agent dropped _silently_ — caught by diffing the dispatch entry's `offered_skills` against the report.
- **Output:** the instance's `output` field — the agent's full final message including the HANDOFF line. Shows "No output captured" for main_session or when no handoff entry exists.
- When no step is selected, shows "Select a step to view details".

## Deriving instances (`buildInstances`)

`buildInstances` in `src/renderer/src/utils/session-log.ts` (pure, no Node imports) walks entries in order and starts a **new segment whenever `origin` changes**. This means:

- The same agent appearing after a main-session interlude becomes a **separate step** (correct — it's a second invocation). Before `039` this also meant a fresh `agent_id`, since each invocation was a cold `Task`; a **resumed** run (`SendMessage` to an agent with a completed run this session) still segments into a separate step, but now shares its `agent_id` with the run it resumed. `042` bounds every agent_id lookup by position in the log so the two segments still each get their own `input`/`offeredSkills`/`delivered` — see below and "Things that bite".
- The main session itself segments into multiple "Main Session" steps when subagents interleave (normal for sequential Maestro dispatch).
- Parallel subagents would fragment, but Maestro runs agents sequentially, so interleaving is rare.

**Status/label/output** are populated from the first `kind:"handoff"` entry found within the segment (matching `origin`); a `kind:"transition"` entry instead sets `status:"transition"` and keeps its message as `output`. **Input** is correlated by `agent_id`, bounded by position in the log (`042`): resolve the segment's own handoff index `h` (or, when the segment has no handoff — an in-flight or killed agent — the end of THAT SEGMENT, which for a genuinely in-flight agent is the end of the log; not `entries.length` unconditionally, or a killed agent's card would reach forward and claim the dispatch of a later run of the same type) and the previous handoff index `p` — the nearest handoff for that same `agent_id` sitting before `h`, `-1` when there is none, then take the *latest* `dispatch` entry for that `agent_id` whose index falls in `(p, h)` — not the last one in the whole file. Fallback: if the segment's handoff has no `agent_id` (or there is no handoff at all), search for a `dispatch` entry matching by `agent` type instead, over the same `(p, h)` window — `p`/`h` here come from `lastEndByOrigin`, tracking the end of the previous segment sharing that `origin`, since there's no `agent_id` to key off in this branch.

**Deliveries are windowed the same way, over the same `agent_id` (`037`, bounded by `042`).** Every
`channel_delivery` entry in `entries[]` is grouped up front into a `Map<agent_id, {index, delivery}[]>`
(entries preserved in log order), because a `channel_delivery` entry's `origin` is hardcoded
`"main_session"` by the injector and lands in whichever main_session segment happens to be current at
write time — **never** in the receiving instance's own segment. Segment membership therefore cannot be
used to attach a delivery; only `agent_id` can. For each non-main-session instance, the SAME id that
already resolved `input`/`offeredSkills` looks the map up, filtered to entries whose index falls in
that instance's own `(p, h)` window — so a delivery logged between two runs of a resumed agent lands on
the later run's card only, never both. An `agent_id` matching no instance is simply never pulled out of
the map — nothing crashes, nothing attaches to an arbitrary instance; it is just absent from every
card. This is why `delivered` is populated in the *same* per-instance loop as `input`/`offeredSkills`,
not a separate pass.

## Runtime — how the log gets written

This is the relationship between the page and the custom hooks/scripts.

### `maestro-session-log.js` — tool-call entries (PreToolUse)

- **Hook event:** `PreToolUse`, matcher `.*` — fires on every tool call from any agent.
- **What it writes:** `{ ts, origin, log }`. `origin = p.agent_type || "main_session"`. `log` is a compact summary: `Read(/path)`, `Bash(cmd[:60])`, `Write(/path)`, `Skill(name)`, bare tool name for unknowns.
- **Gate:** exits immediately if `<cwd>/.claude/maestro.json` doesn't exist (Maestro not configured).
- **Append-only** (`fs.appendFileSync`) — parallel subagents can write concurrently without race conditions.
- Run from `${CLAUDE_PLUGIN_ROOT}/scripts/` — edits take effect immediately without reinstall.

### `maestro-subagent-log.js` — dispatch + handoff entries (SubagentStart/Stop)

- **Hook events:** both `SubagentStart` and `SubagentStop`, matcher `.*` — the same script handles both, branching on `hook_event_name`.
- **On SubagentStart** → writes a `kind:"dispatch"` entry:
  ```json
  {
    "ts": "…",
    "origin": "main_session",
    "kind": "dispatch",
    "agent": "<agent_type>",
    "agent_id": "<agent_id>",
    "input": "<last_assistant_message>",
    "log": "→ <agent_type>"
  }
  ```
  `last_assistant_message` on SubagentStart = the main session's message that triggered the subagent spawn. This is the **Input** shown in the right detail panel.
- **On SubagentStop with an `agent_type`** → parses `last_assistant_message` for a `HANDOFF:` line (last occurrence, tolerant of surrounding backticks/asterisks), writes a `kind:"handoff"` entry:
  ```json
  {
    "ts": "…",
    "origin": "<agent_type>",
    "kind": "handoff",
    "agent_id": "<agent_id>",
    "status": "success|condition|unknown",
    "label": "<label|null>",
    "output": "<last_assistant_message>",
    "log": "HANDOFF: <label>"
  }
  ```
  `last_assistant_message` on SubagentStop = the agent's entire final message, including `HANDOFF:` + any `handoff_details` payload. This is the **Output** shown in the right detail panel. `agent_id` is shared across both entries for correlation.
- **On SubagentStop with NO `agent_type`** → not a real workflow handoff. Writes a `kind:"transition"` entry instead, so it can't masquerade as a failed/unknown agent run:
  ```json
  { "ts": "…", "origin": "transition", "kind": "transition", "output": "<last_assistant_message>", "log": "transition" }
  ```
  `buildInstances` segments this as its own neutral card (`status:"transition"`, displayName "Transition" via `titleFromName`); the message is kept as `output` for the detail panel.
- **`parseHandoff`:** takes the last `HANDOFF:` match; `"success"` (case-insensitive) → `status:"success"`, any other label → `status:"condition"`, no match → `status:"unknown"`.
- Same gate and append-only pattern as `maestro-session-log.js`.

### Hook registration (`hooks.json`)

```json
"SubagentStart": [{ "matcher": ".*", "hooks": [
  { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/maestro-inject-agent-context.js"] },
  { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/maestro-subagent-log.js"] }
]}],
"SubagentStop": [{ "matcher": ".*", "hooks": [
  { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/maestro-subagent-log.js"] }
]}],
"PreToolUse":  [{ "matcher": ".*", "hooks": [
  { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/maestro-session-log.js"] }
]}]
```

`maestro-inject-agent-context.js` and `maestro-subagent-log.js` are both registered under SubagentStart — order is irrelevant since they write to different logical concerns (additionalContext vs. the log file). `maestro-subagent-log.js` runs from the plugin dir (not the project copy), so edits to it are immediate.

### SessionEnd cleanup

`maestro-session-cleanup.sh` (SessionEnd hook) deletes both `maestro_session.log.jsonl` and `maestro_session.json`. The page's empty state is therefore the expected condition when no Maestro session is active — it is not an error.

### Why SUCCESS/FAILURE requires `maestro-subagent-log.js`

The plain tool-call log from `maestro-session-log.js` has **no outcome data** — it records only that a tool was called. The subagent's `HANDOFF:` line lives in its transcript (the `last_assistant_message` at SubagentStop time), which is only accessible to a SubagentStop hook. Without `maestro-subagent-log.js`, all instance `status` fields would be `null` and no icons would render status colors. See `maestro-architecture` for the full HANDOFF routing contract and how the orchestrator uses the same label to route the workflow.

## Things that bite

- **The log is ephemeral.** Deleted at SessionEnd by `maestro-session-cleanup.sh`, whose only job that is. The desktop window outlives any session, so an empty page is the normal between-sessions state, not an error. The file only exists during and immediately after an active Maestro session.
- **Status comes exclusively from the SubagentStop handoff entry.** If `maestro-subagent-log.js` is not registered, all steps will have `status: null` and default to green checkmarks. If a real workflow agent (has an `agent_type`) exits without a parseable `HANDOFF:` line (crash, force-stop, broken Maestro contract), the status will be `"unknown"` (shown as yellow warning icon). A `SubagentStop` with **no `agent_type`** is instead logged as `kind:"transition"` (a neutral grey card) — a boundary that isn't a workflow handoff, not a failed agent, so it deliberately does **not** show a yellow warning.
- **The log path comes from the open project, not `process.cwd()`.** Main resolves it from the project store's current root; `currentRoot()` in `main/ipc.ts` is the single place that answers "which project". The app's own cwd is irrelevant and always wrong here.
- **The tail polls, it does not `fs.watch`.** Main uses `setInterval` + a read + a line-count diff. Watch APIs are unreliable across editors that write via rename and across network/virtualised filesystems, and the hooks append constantly enough that a poll is cheap. The tail lives in main, so exactly one poll loop runs no matter how many routes are mounted.
- **`reset` event on SessionEnd.** When the JSONL file disappears (deleted by `maestro-session-cleanup.sh`), the server emits `reset: {}` and `lineCount` drops to 0. The provider clears `entries`, the page shows the empty state. A new session's `init` event re-fills it. This is the normal SessionEnd → new session cycle without a page reload.
- **`window.maestro.log.subscribe` is single-owner.** Main keeps one tail per `webContents.id` and stops the old one before starting a new one — so a second subscriber _steals_ the tail, and the first unsubscribe then stops it for both. The owner is `SessionLogProvider`; every other consumer reads from it with `useSessionLog()`. A test pins the call site to that one file.
- **The tail is retargeted on a project switch**, in `main/ipc.ts`. Without that, the window keeps streaming the previously-opened repo's session log while showing the new project everywhere else.
- **`tails` and `logSubscribers` answer two different questions, and `retargetTails` needs the second one.** `tails` (`Map<webContentsId, stop>`) is "which windows have a running watcher"; `logSubscribers` (`Set<number>`, `038`) is "which windows asked for one". They're the same set only while a project is open — a window that subscribes with no project open gets an empty `logInit` and `startTail` returns before ever touching `tails`, so `retargetTails` iterating `tails.keys()` would never revisit it once a project opened, leaving `/session-log` dead for that window's whole life. `logSubscribe` adds to `logSubscribers` *before* calling `startTail`; both `logUnsubscribe` and the window's `destroyed` listener remove from it. `retargetTails` reads `logSubscribers`, never `tails.keys()` and never `BrowserWindow.getAllWindows()` (the latter would start a tail for a window that never subscribed at all).
- **Live stream is app-wide.** `SessionLogProvider` mounts in `__root.tsx`, so the subscription is maintained on every page. Entries accumulate in context even while the user is on `/workflows` or `/rules`; `/session-log` sees the full current state when you navigate to it.
- **There is no loader; the first paint is empty.** The provider starts with `entries: []` until main's `init` push arrives, so navigating to the route shows a brief empty state — acceptable for a debugging tool, and the alternative is a loader that races the subscription.
- **Instances segment by origin change.** The same agent appearing twice in the log produces two steps — that's intentional (second run = second step). Parallel subagents would interleave their tool-call lines, fragmenting into many steps. Maestro runs subagents sequentially, so this is normally not an issue in practice. `agent_id` correlation keeps input↔output paired correctly even in edge-case interleaving.
- **`humanizeLog` returns `null` for bare `Agent`/`Task(...)` lines.** These PreToolUse entries capture the tool dispatch from the main session, but the richer `kind:"dispatch"` entry from `maestro-subagent-log.js` covers the same event more informatively. The nulls are intentionally filtered in `session-log-view.tsx`. Do not "fix" them.
- **`session-log.ts` must remain node-free.** It is renderer code. All `fs`/`path` work belongs in `src/main/`; `test/isolation.test.ts` fails the build on a `node:` builtin, a `@repo/claude-fs` import, or an import of the `src/core/index.ts` **barrel** anywhere outside `src/main/` — the barrel re-exports `fs` and `child_process`, so type-only imports must name `src/core/contracts.ts` instead.
- **`maestro-subagent-log.js` runs from the plugin dir, not the project copy.** Unlike `maestro-set-session-workflow.cjs` and `maestro-render-orchestrator.cjs` (which are copied into `.claude/scripts/` at install time), the SubagentStart/Stop scripts run directly from `${CLAUDE_PLUGIN_ROOT}/scripts/`. Editing `maestro-subagent-log.js` takes effect immediately for all projects. Adding or removing the hook registration in `hooks.json` requires a new Claude session to pick up.
- **Large messages in `input`/`output`.** A spawning message that includes injected skills + handoff templates can be several kilobytes. The right detail panel sections are scrollable. The JSONL file stores the full messages; that's intentional for debugging fidelity.
- **`--yellow` color token.** Added in `packages/styles/scss/abstracts/_tokens.scss` alongside `--green`/`--red`. Used for "unknown" status (subagent with no parseable HANDOFF line). Both light and dark mode variants exist.
- **A resumed run (`039`) puts two `dispatch`/`handoff` pairs under one `agent_id` — `buildInstances` bounds every lookup by log POSITION rather than by `agent_id` alone, so the two cards don't cross-contaminate (`042`).** A condition-edge loop-back that resumes an agent with a completed run this session (see `maestro-architecture`'s Runtime lifecycle) keeps the SAME `agent_id` across both invocations — `SubagentStart`/`SubagentStop` fire again, so `maestro-subagent-log.js` appends a second `dispatch`/`handoff` pair correlated to it. Before `042`, `dispatchByAgentId` was a plain `Map` filled by one forward pass (last-write-wins), so BOTH segments — including the first run's own — read back the resumed run's `input`/`offeredSkills`, and `deliveredByAgentId` (pushing onto an array, so no data loss but no separation either) meant both cards rendered every delivery logged under that `agent_id`. The fix: for each segment, resolve its own handoff index `h` (or the end of that segment when there is none — an in-flight/killed agent) and the previous handoff index `p` for that `agent_id` (`-1` when there is none), then bound the dispatch lookup, the name-based fallback, and the delivery filter all to `(p, h)` — the log is append-only, so a run's own boundary is already implicit in file order; no new hook state (no run counter, no id change) was needed. Segmentation itself was never affected (still one card per `origin` change) — it was only `input`/`offeredSkills`/`delivered` that could misattribute across a resumed agent's two cards.
- **A `channel_delivery` entry's `origin` tells you nothing about who received it (`037`).** It is
  always `"main_session"`, hardcoded by the injector, exactly like a `dispatch` entry — so grouping
  log entries by segment (the way `buildInstances` starts a new `Instance` on every `origin` change)
  would put every delivery on a Main Session card, never on the agent it was delivered to. The only
  correct correlation key is `agent_id`, shared with the receiving instance's own dispatch/handoff.
  If a delivery is ever missing from the card it plainly belongs on, check that its `agent_id`
  actually matches that instance's `handoff?.agent_id ?? dispatch?.agent_id` before suspecting the
  render layer.
- **`channels:pending` (the `/maestro` backlog view) is a DIFFERENT read of a DIFFERENT thing.** This
  route shows deliveries that already happened, reconstructed from the append-only log; `/maestro`'s
  `pendingLanes()` (`src/core/handoff-channels.ts`) shows undelivered files still sitting in
  `.claude/channels/`. Neither reads the other's data source, and neither writes anything — see
  `maestro-architecture` for the channel file lifecycle and `agents-view` for where a route's channel
  path (`.claude/channels/<receiver>/<sender>.1.md`) is surfaced as a label.
