---
name: task-queue
description: "Explains the Maestro task queue: the numbered prompt files under .claude/maestro-tasks/, the blockedBy cascade and status.json that decide which are ready, the PostToolUse hook that checks TaskCreate calls against the selected workflow's success path, and the two implementations (tasks.ts and maestro-tasks.cjs) that must agree. Use when working on /to-maestro-tasks, the /maestro-tasks route or the validation hook, when a task won't unblock, or when a close from the UI and one from the orchestrator disagree."
metadata:
  type: concept-skill
  version: "1.1"
  last-update: e90c2a974a94dc6c1709097f36b4563af9bdd468
---

# Task queue

A queue of ready-to-run prompts that `/to-maestro-tasks` writes under
`<project>/.claude/maestro-tasks/`, one numbered markdown file per vertical slice
(`001-verify-workflow-canvas-interactions.md`). The Maestro orchestrator picks them up, classifies
each, and runs it; the desktop app's `/maestro-tasks` route shows the same queue.

The files are workflow-agnostic prompts — a title, what to build, and acceptance criteria — not
instructions to a specific agent. Classification is the orchestrator's job at run time.

## Readiness

`status.json` in the same directory holds one entry per file:

```json
{ "001-….md": { "status": "done", "blockedBy": [] } }
```

`blockedBy` is parsed out of the task file itself (`parseBlockedBy`) and cascades: a task is ready
only when everything it names is done. `closeTask` recomputes the cascade, which is why closing one
task can make several ready at once.

`/to-maestro-tasks` no longer hand-assembles the files for a fresh batch: it hands
`maestro-write-tasks.cjs` a JSON array of slices (title, body, `blockedBy` as indices into that same
array), and the script assigns numbers/slugs, renders each file, and calls `sync()` in one pass —
folding what used to be two separate steps (write the files, then run `maestro-task-status.cjs sync`)
into one script call.

## Two implementations that must agree

`apps/maestro/src/core/tasks.ts` (the app) and `plugins/maestro/scripts/lib/maestro-tasks.cjs` (the
orchestrator) both implement the cascade. **`maestro-tasks.cjs` is the one lib file that is NOT
generated** — it has no `plugin-entries/` source, and is hand-maintained in sync with `tasks.ts`
precisely so a close from the UI and one from the orchestrator cannot disagree about which tasks are
ready. Changing the cascade in one place and not the other is the failure mode this arrangement
exists to prevent.

## Live updates on the `/maestro-tasks` route

The route no longer relies solely on its loader's one-shot `listTasks()` snapshot. `tailTasks`
(`apps/maestro/src/core/tasks.ts`) is a main-process poller — poll-based, not `fs.watch`, for the
same reason the Session Log tail is (see `log-view`'s "the tail polls, it does not `fs.watch`") —
that re-runs `listTasks` on an interval and pushes only when the serialized result changes, so both
a status change in `status.json` and a new task file appearing are caught by the same fingerprint
check. It is wired through a `tasks:subscribe`/`tasks:unsubscribe` push channel
(`src/main/ipc.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`) modeled directly on
`log:subscribe`/`log:unsubscribe`, including single-owner-per-`webContents.id` tails and retargeting
on project switch (`taskTails`/`taskSubscribers`, mirroring `tails`/`logSubscribers`).

Unlike the session log's tail, this one is **not** lifted into a root-level provider — it is
subscribed from inside `maestro-tasks.tsx` itself, since `/maestro-tasks` is the only screen that
reads live task data. Subscribe-on-mount / unsubscribe-on-unmount is enough to guarantee no poll
loop outlives the route. See `log-view` for the pattern this deliberately duplicates rather than
shares — the two poll different files for different shapes of data, so a common tail would have
had to be generic over both.

## The validation hook

`maestro-validate-tasks.js` runs as a **`PostToolUse` hook matching `TaskCreate`**. It checks each
task the orchestrator creates against the selected workflow's success path and warns — **non-blocking,
always** — when:

- a created task matches no node in the workflow (mismatch), or
- a success-path step was skipped (e.g. human review never got a task).

Created tasks are tracked across the session in the ephemeral
`<cwd>/.claude/maestro_session_tasks.json`, deleted at `SessionEnd` with the other session files.
Sequential writes are safe because `TaskCreate` calls come from the main orchestrator session, with
no parallel-subagent race.

A warning here is advisory. Work that legitimately falls outside the active workflow — running
`/create-concept-skills`, for instance — will trip it, and that is expected.

## Files

| File | Role |
| --- | --- |
| `<project>/.claude/maestro-tasks/NNN-*.md` | The prompts. |
| `<project>/.claude/maestro-tasks/status.json` | Status + `blockedBy` per file. |
| `apps/maestro/src/core/tasks.ts` | `tasksDirFor`, `parseBlockedBy`, `listTasks`, `closeTask`. |
| `plugins/maestro/scripts/lib/maestro-tasks.cjs` | Hand-maintained twin. |
| `plugins/maestro/scripts/maestro-validate-tasks.js` | The `PostToolUse` hook. |
| `plugins/maestro/scripts/maestro-task-status.cjs` | Status CLI (`sync`, `done`). |
| `plugins/maestro/scripts/maestro-write-tasks.cjs` | Writes a new batch from structured slice JSON, then calls the same `sync()`. |
| `plugins/maestro/skills/to-maestro-tasks/` | The authoring skill. |
| `apps/maestro/src/renderer/src/routes/maestro-tasks.tsx` | The app's view; owns the `tasks:subscribe` call and applies pushed updates over the loader's initial value. |
| `apps/maestro/src/main/ipc.ts` | `tailTasks` wiring — `taskTails`/`taskSubscribers`, retargeted on project switch. |
| `apps/maestro/src/shared/ipc.ts` | The `tasks:subscribe`/`tasks:unsubscribe`/`tasks:init`/`tasks:update` channel contract. |
| `apps/maestro/src/preload/index.ts` | Exposes `window.maestro.tasks.subscribe`. |

## Relationships

- `maestro-architecture` — the orchestrator that consumes the queue, and the `success-path` the hook
  validates against.
- [`concept-skills-system`](../concept-skills-system/SKILL.md) — the other plugin subsystem split
  across a TS source and a CJS twin.
- `plugin-libs-parity` (in `apps/maestro/.claude/skills`) — the generation rule this file is the
  documented exception to.
- `log-view` (in `apps/maestro/.claude/skills`) — the Session Log tail this queue's live-update
  pipeline mirrors: main-process poller, subscribe/unsubscribe IPC, single-owner-per-window tail,
  retargeted on project switch. The two are separate implementations by design (see above), not a
  shared module.

## Sub-concepts

- [Task files and the cascade](sub-concepts/task-files.md) — the format, `blockedBy`, `status.json`.
- [TaskCreate validation](sub-concepts/task-validation.md) — the hook, its warnings, its limits.
