---
name: log-view
description: "Explains how the /session-log view in the Maestro desktop app is built end-to-end: a tab bar (065) grouping one tab per LIVE SESSION by project — current project plus every recent one, not just the open one — above the thin left step list, the center framed log pane, and the right Input/Process/Output detail panel; how log entries map to Instance segments within whichever tab is selected; how channel_delivery entries (`037`) attach to the RECEIVING instance rather than the sender; how a resumed agent's two cards (`039`) are each correlated to their own run by bounding every agent_id lookup by log position (`042`); how an ended session keeps a greyed, capped, evictable tab instead of vanishing; how a project being forgotten forces a full tab-bar reset rather than a per-session end; and how the maestro-session-log.js / maestro-subagent-log.js / maestro-inject-agent-context.js hooks write the log each tab reads — which since `064` is the PER-SESSION .claude/maestro_sessions/<session_id>/log.jsonl, one fixed file per session for its whole life, discovered across the current-plus-recent project allow-list by tailSessionLogs() (065) rather than resolved by mtime. Use when the user is working inside apps/maestro and asks how the session-log view or its tabs work, how cards/instances are derived, where SUCCESS/FAILURE comes from, why the log or a tab is empty, why a tab disappeared or greyed out, why a step has no status icon, how dispatch/handoff entries are produced by the hooks, why a delivered channel payload does or doesn't show up on the right card, or how a resumed agent's (`039`) two cards each get their own run's input/offeredSkills/deliveries (`042`)."
metadata:
  type: concept-skill
  version: "2.4"
  last-update: d83231be731d77a77ad7bf6bfbc0b47c24647a08
---

# Log View

The `/session-log` route (`src/renderer/src/routes/session-log.tsx`) is a **read-only debugger** for Maestro workflow sessions. Since `065` it shows **one tab per live session, across every project the app knows about** (the current project plus the recent-projects list) — not just the open one. Each tab reads its own `<projectRoot>/.claude/maestro_sessions/<session_id>/log.jsonl` (`064`) and, once selected, presents it in three panes: a **thin left step list** (step names with status icons), a **center framed log** (humanized tool calls per step in rounded bordered sections), and a **right detail panel** (Input/Process/Output for the selected step). Clicking a step in any pane selects it across all three; switching tabs swaps which session's entries those three panes render, without touching the other tabs' state.

This is the **read side** of the Maestro runtime: it displays what the hook scripts write. See the `maestro-architecture` skill for the full HANDOFF routing contract, and the `workflow-view` skill for the sibling `/workflows` authoring view.

| Sub-concept | Covers |
| --- | --- |
| [`sub-concepts/log-entry-schema.md`](sub-concepts/log-entry-schema.md) | The `SessionLogEntry` JSONL shape per `kind`, the derived `Instance`, and the skills-triage audit (`offeredSkills` vs `skillsTriage` vs `unaccountedSkills`). |
| [`sub-concepts/instance-correlation.md`](sub-concepts/instance-correlation.md) | How `buildInstances` segments by `origin` and correlates `input`/`offeredSkills`/`delivered` by `agent_id` bounded to a `(p, h)` log window (`042`, `039`, `037`). |
| [`sub-concepts/hook-writers.md`](sub-concepts/hook-writers.md) | The write side: the three hook scripts, their entry formats, `hooks.json` registration, SessionEnd cleanup, and why status needs `maestro-subagent-log.js`. |
| [`sub-concepts/tailing-and-tabs.md`](sub-concepts/tailing-and-tabs.md) | `tailSessionLogs` vs the legacy single-session tail (`064`/`065`), the poll loop, `tails` vs `logSubscribers` (`038`), and the `reduceSessionLog`/`pickSelection` tab state machine. |
| [`sub-concepts/panes.md`](sub-concepts/panes.md) | What each of the three panes renders: icons, colors, badges, and the detail panel's sections. |

## Layout

```
┌──────────────────────────────── TopNav (top-nav.tsx) ────────────────────────────────┐
│ Workflows | Rules | Session Log                                                  ☀    │
├────────────────────────────────── SessionLogTabs (065) ──────────────────────────────┤
│ project-a: [10:02] [10:14 (ended) ✕]     project-b (recent): [09:58]                 │
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

**No workflow selector and no YAML preview toggle** — TopNav is rendered bare (no `workflowSelector` or `onPreviewToggle` props). The **tab bar** (`session-log-tabs.tsx`, `065`) sits above the three panes: one group per project (current project first when it has any tracked session, then recent projects in `project:get` order — project name shown once per group, not repeated per tab), one button per session labelled by its start time. An **ended** session's tab stays, dimmed (`opacity-60`) with an "(ended)" label and a close (✕) button, instead of disappearing. When there are no tracked sessions in any known project, the whole three-pane layout is replaced by an **empty state**: a centred `ScrollText` icon + "No live sessions in any known project" message ("A tab appears here while a Maestro session is running, in this project or a recent one.") + a `● live / ○ connecting…` indicator.

## Data flow

```
App-wide (src/renderer/src/routes/__root.tsx)
  <SessionLogProvider>  (src/renderer/src/utils/session-log-context.tsx)
    └── window.maestro.log.subscribe({ onInit, onEntry, onEnd, onReset })
          MAIN process (src/main/ipc.ts) owns ONE poll loop per window:
          tailSessionLogs(allowedProjectRoots, …) walks every session dir
          under every project in the current+recent allow-list and pushes,
          per (projectRoot, sessionId):
          `log:init` / `log:entry` / `log:end` — `log:reset` is untagged
          and means "drop everything" (see sub-concepts/tailing-and-tabs.md)
          state: Map<sessionKey, SessionRecord> (keyed by `${projectRoot} ${sessionId}`)
                                     │
          reduceSessionLog(prev, event) — the ONE pure fold, unit-tested alone
          (see sub-concepts/tailing-and-tabs.md)
                                     │
       ┌─────────────────────────────┘
       ▼
SessionLogPage (src/renderer/src/routes/session-log.tsx)
  const { sessions, connected, dismiss } = useSessionLog()   // sessions: SessionRecord[]
  selectedKey state, kept stable by:
    useEffect(() => pickSelection(sessions, selectedKey))    // the OTHER pure function
  selected = sessions.find(sessionKey(s) === selectedKey)
  instances = useMemo(() => selected ? buildInstances(selected.entries) : [])  → Instance[]
  activeId state (which step is selected, scoped to the selected tab)
  cwd = selected?.projectRoot ?? currentProject?.root  // the TAB's own project, not the open one
       │
       ├──▶ SessionLogTabs (065, above the 3 panes)
       │      groups `sessions` by projectRoot, one tab per session,
       │      onSelect(projectRoot, sessionId) → setSelectedKey(sessionKey(...))
       │      onClose(projectRoot, sessionId) → dismiss(...) (ended tabs only)
       │
       ├──▶ SessionLogCards (left) / SessionLogView (center) / SessionLogDetail (right)
       │      render `instances` + `activeInstance` — see sub-concepts/panes.md
       │
       └── isEmpty = sessions.length === 0 → the "no live sessions in any known
           project" empty state (see Layout)

TopNav (every Maestro page): "● Session Log" dot driven by useSessionLog().connected
```

The upstream writers that produce those entries — `maestro-session-log.js` (PreToolUse),
`maestro-subagent-log.js` (SubagentStart/Stop), `maestro-inject-agent-context.js` (SubagentStart,
`channel_delivery`) and `maestro-session-cleanup.sh` (SessionEnd) — are in
[`sub-concepts/hook-writers.md`](sub-concepts/hook-writers.md). All four append to **one file per
Claude Code session** since `064` — including every subagent a run spawns, which is what makes
`agent_id` correlation possible at all.

## File-by-file map

Renderer paths are relative to `apps/maestro/`.

| Concern                                                                                                                        | File                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Route, state, tab selection, 3-pane grid, scroll-sync, empty state                                                              | `src/renderer/src/routes/session-log.tsx`                                             |
| **Tab bar** — one group per project, one tab per session, ended-tab dimming/label/close button (`065`)                        | `src/renderer/src/components/session-log-tabs.tsx`                                    |
| Left step list with status icons (CircleCheck/CircleX/AlertTriangle)                                                           | `src/renderer/src/components/session-log-cards.tsx`                                   |
| Center framed log pane, click-to-select, live indicator, per-section anchors                                                   | `src/renderer/src/components/session-log-view.tsx`                                    |
| Right detail panel: Input/Process/Output sections                                                                              | `src/renderer/src/components/session-log-detail.tsx`                                  |
| **The tail itself** — one poll loop per window, `tailSessionLogs(allowedProjectRoots, …)` walks every session across the current+recent allow-list and pushes `log:init`/`log:entry`/`log:end` per (projectRoot, sessionId); `tails` (running watchers) and `logSubscribers` (who asked, `038`) are separate sets | `src/main/ipc.ts` (`startTail`, `retargetTails`, `allowedProjectRoots`)               |
| The typed channel contract — `log:init`/`log:entry`/`log:end` now carry `{projectRoot, sessionId, …}`; `log:reset` stays untagged and means "drop everything" | `src/shared/ipc.ts` (`SessionLogInitEvent`/`SessionLogEntryEvent`/`SessionLogEndEvent`, `log:subscribe`, `log:unsubscribe`) |
| App-wide subscriber: `SessionLogProvider`, `useSessionLog()`, the keyed `Map<sessionKey, SessionRecord>`, the pure `reduceSessionLog`/`pickSelection` | `src/renderer/src/utils/session-log-context.tsx`                                      |
| `parseLogLines` + `readSessionLog` + legacy single-session `tailSessionLog`/`sessionLogFileFor` (kept for `test/core/session-log.test.ts`'s differential coverage; no longer what `/session-log`'s live tail uses) + the current `tailSessionLogs` (`065`) | `session-log.ts` in `apps/maestro/src/core/`                                          |
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
| Source file (ephemeral, append-only, gitignored)                                                                               | `<projectRoot>/.claude/maestro_sessions/<session_id>/log.jsonl` (`064`)               |
| Path resolution + session-id validation (`sessionLogFileFor`, `sessionPathsFor`, `listSessionIds`)                             | `session-log.ts` / `session-paths.ts` in `apps/maestro/src/core/`                     |

## Things that bite

- **The log is ephemeral.** Deleted at SessionEnd by `maestro-session-cleanup.sh`, whose only job that is. The desktop window outlives any session, so an empty page is the normal between-sessions state, not an error. The file only exists during and immediately after an active Maestro session.
- **Status comes exclusively from the SubagentStop handoff entry.** If `maestro-subagent-log.js` is not registered, all steps will have `status: null` and default to green checkmarks. If a real workflow agent (has an `agent_type`) exits without a parseable `HANDOFF:` line (crash, force-stop, broken Maestro contract), the status will be `"unknown"` (shown as yellow warning icon). A `SubagentStop` with **no `agent_type`** is instead logged as `kind:"transition"` (a neutral grey card) — a boundary that isn't a workflow handoff, not a failed agent, so it deliberately does **not** show a yellow warning.
- **`channels:pending` (the `/maestro` backlog view) is a DIFFERENT read of a DIFFERENT thing.** This route shows deliveries that already happened, reconstructed from the append-only log; `/maestro`'s `pendingLanes()` (`src/core/handoff-channels.ts`) shows undelivered files still sitting in `.claude/channels/`. Neither reads the other's data source, and neither writes anything — see `maestro-architecture` for the channel file lifecycle and `agents-view` for where a route's channel path (`.claude/channels/<receiver>/<sender>.1.md`) is surfaced as a label.
