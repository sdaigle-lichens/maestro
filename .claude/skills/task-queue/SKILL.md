---
name: task-queue
description: "Explains the Maestro task queue: the numbered prompt files under .claude/maestro-tasks/, the blockedBy cascade and status.json that decide which are ready, the PostToolUse hook that checks TaskCreate calls against the selected workflow's success path, the two implementations (tasks.ts and maestro-tasks.cjs) that must agree, and the claims subsystem (claims.ts / maestro-task-status.cjs) that lets two concurrent sessions claim different ready tasks. Use when working on /to-maestro-tasks, the /maestro-tasks route or the validation hook, when a task won't unblock, when a close from the UI and one from the orchestrator disagree, or when two sessions might grab the same task."
metadata:
  type: concept-skill
  version: "1.2"
  last-update: d83231be731d77a77ad7bf6bfbc0b47c24647a08
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

**A second pair, added by `066`, does the same for claims.** `apps/maestro/src/core/claims.ts`
(`claimTask`/`releaseTask`/`readClaims`/`isSessionLive`) and the claim/release logic hand-written
directly inside `plugins/maestro/scripts/maestro-task-status.cjs` — not in `lib/`, and not
generated; there is no `plugin-entries/claims.ts` — must independently stay in sync the same way.
Parity between the two is checked in `test/core/claims.test.ts` and
`test/core/task-claims-cli.test.ts`, not by `parity.test.ts`'s snapshot-diff pattern, since there is
no legacy CJS claims module being replaced.

## Claims (`066`)

Claims are how two concurrent sessions asking for "the next ready task" get two **different** tasks,
without touching `status.json` or the `done`/`ready`/`blocked` enum — a claim is an overlay on
`ready`, never a fourth status.

```
<project>/.claude/maestro-tasks/claims/
  .gitignore              "*", written by ensureClaimsDir() on first create
  <task-file>.md.json     { session_id, claimed_at, project_root }
```

- **Created with an exclusive `fs` create (`flag: "wx"`).** The create either succeeds (this session
  won the race) or fails with `EEXIST` (someone else has it — take the next ready task instead).
  `EEXIST` is never an error condition here.
- **Liveness is derived, never trusted from the file's own content.** A claim is live iff its
  session's `maestro_sessions/<id>/` directory still exists AND that session's `log.jsonl` was
  modified within `CLAIM_IDLE_CAP_MS` (15 minutes, named beside `CHANNEL_AGE_CAP_MS` in
  `handoff-channels.ts`) — `064`'s per-session log already doubles as a heartbeat, so no new one was
  needed. A clean `SessionEnd` deletes the whole session directory, so that claim reads as dead
  immediately; a crashed session's directory lingers, so its claim ages out only once the log has
  been idle past the cap.
- **Dead claims are reclaimable, not an error state.** `readClaims` reaps them on read: a claim
  found dead is still returned once more (`live: false`, so a caller mid-read can show it dying),
  then its file is best-effort deleted, so the next read — and the next `claimTask` attempt — sees a
  clean slate with no user action.
- **`listTasks` overlays a claim at read time**, adding `claim: { sessionId, claimedAt, live } |
  null` to `MaestroTask`. The status enum and the `blockedBy` cascade are untouched — a claimed task
  is still `ready`, with a claim on it. `closeTask`/`done` releases the task's claim as part of
  closing.
- `maestro-task-status.cjs` gains `claim <filename>` (exclusive create, reports whether it won) and
  `release [filename]` (removes only the calling session's own claim, refusing a foreign one;
  falls back to `active_task` the same way `done` does).
- `claims/` is ephemeral, project-local, git-ignored the same way `064` ignores `maestro_sessions/`
  — see `installing-maestro`'s manifest sub-concept for the gitignore-manifest/`ensureXDir()` split
  this reuses, and its uninstall-and-purge sub-concept for why removing it isn't just another
  `SESSION_FILES` entry.

## Delete and `postmortems.log`

`deleteTask` (`apps/maestro/src/core/tasks.ts`) is the app-only counterpart to `closeTask`: the
`/maestro-tasks` route's "Delete task" button permanently removes a task file instead of marking it
done. It is **not** mirrored into `maestro-tasks.cjs` — nothing on the orchestrator side ever deletes
a task file, so there is no second implementation to keep in sync, unlike the cascade and claims
pairs above.

Before removing the file, `deleteTask` looks for a `## Post-Mortem` section (`extractPostMortemSection`)
— written by the orchestrator's Step 4 template when a task didn't go cleanly, and possibly annotated
further by `/maestro-post-mortem` with what fix was applied to each bullet — and appends it to
`<project>/.claude/postmortems.log`, one entry per deleted ticket. Unlike `maestro_sessions/` or
`claims/`, this file is **committed**, since deleting the ticket is exactly what would otherwise erase
its history.

`/maestro-post-mortem` never reads either source itself: `maestro-post-mortem-context.js`, registered
on the same two entrances as `maestro-step0.js` (`UserPromptExpansion` on the command name, `PreToolUse`
on the `Skill` tool, filtered to this one skill), resolves the session's `active_task`, reads its
`## Post-Mortem` section if any, reads a tail of `postmortems.log` if any, and injects both as context
before the skill's own prompt runs — so the skill's Step 1 is "read what's already in context," not
three manual lookups it has to remember to run every time. See `maestro-architecture`'s hook reference.

## Live updates on the `/maestro-tasks` route

The route no longer relies solely on its loader's one-shot `listTasks()` snapshot. `tailTasks`
(`apps/maestro/src/core/tasks.ts`) is a main-process poller — poll-based, not `fs.watch`, for the
same reason the Session Log tail is (see `log-view`'s "the tail polls, it does not `fs.watch`") —
that re-runs `listTasks` on an interval and pushes only when the serialized result changes, so both
a status change in `status.json` and a new task file appearing are caught by the same fingerprint
check. Since `066`, a claim being created, released, or reaped as dead changes `listTasks`'
serialized result the same way, so the claims directory reaches the route through this same poll
with no separate wiring. It is wired through a `tasks:subscribe`/`tasks:unsubscribe` push channel
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
`<cwd>/.claude/maestro_sessions/<session_id>/tasks.json` (`064`; it was the flat
`maestro_session_tasks.json` until then), removed with the rest of that session's directory at its
own `SessionEnd`. **The ledger is per session, so a concurrent session's coverage is no longer read
as this one's** — which used to make one session's `TaskCreate` suppress the other's warning. When
no session id resolves, the hook skips validation entirely and exits 0 rather than falling back to a
shared file; see `maestro-architecture`'s "Which session am I". Sequential writes are safe because
`TaskCreate` calls come from the main orchestrator session, with no parallel-subagent race.

A warning here is advisory. Work that legitimately falls outside the active workflow — running
`/create-concept-skills`, for instance — will trip it, and that is expected.

## Files

| File | Role |
| --- | --- |
| `<project>/.claude/maestro-tasks/NNN-*.md` | The prompts. |
| `<project>/.claude/maestro-tasks/status.json` | Status + `blockedBy` per file. |
| `apps/maestro/src/core/tasks.ts` | `tasksDirFor`, `parseBlockedBy`, `listTasks`, `closeTask`, `deleteTask`, `extractPostMortemSection`. |
| `<project>/.claude/postmortems.log` | Committed history of deleted tickets' `## Post-Mortem` sections. |
| `plugins/maestro/scripts/lib/maestro-tasks.cjs` | Hand-maintained twin. |
| `apps/maestro/src/core/claims.ts` | `claimTask`, `releaseTask`, `readClaims`, `isSessionLive` (`066`). |
| `<project>/.claude/maestro-tasks/claims/` | Per-task claim files (`066`); git-ignored, deleted on uninstall. |
| `plugins/maestro/scripts/maestro-validate-tasks.js` | The `PostToolUse` hook. |
| `plugins/maestro/scripts/maestro-task-status.cjs` | Status CLI (`sync`, `done`, `claim`, `release`). |
| `plugins/maestro/scripts/maestro-post-mortem-context.js` | `PreToolUse`/`Skill` hook injecting the active task's `## Post-Mortem` section and `postmortems.log` tail before `/maestro-post-mortem` runs. |
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
