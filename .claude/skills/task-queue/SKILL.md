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
instructions to a specific agent. Classification is the orchestrator's job at run time. `status.json`
in the same directory holds `{ status, blockedBy }` per file; `blockedBy` is parsed out of the task
file and cascades, so closing one task can make several ready at once — see
[Task files and the cascade](sub-concepts/task-files.md).

## Two implementations that must agree

`apps/maestro/src/core/tasks.ts` (the app) and `plugins/maestro/scripts/lib/maestro-tasks.cjs` (the
orchestrator) both implement the cascade. **`maestro-tasks.cjs` is the one lib file that is NOT
generated** — it has no `plugin-entries/` source, and is hand-maintained in sync with `tasks.ts`
precisely so a close from the UI and one from the orchestrator cannot disagree about which tasks are
ready. Changing the cascade in one place and not the other is the failure mode this arrangement
exists to prevent.

**A second pair, added by `066`, does the same for claims** — `claims.ts` against hand-written logic
inside `maestro-task-status.cjs`; see [Claims](sub-concepts/task-claims.md).

## The validation hook

`maestro-validate-tasks.js` is a `PostToolUse` hook on `TaskCreate` that checks each created task
against the selected workflow's success path and warns — **always non-blocking, always advisory** —
on a mismatch or a skipped step. See [TaskCreate validation](sub-concepts/task-validation.md).

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
  retargeted on project switch. The two are separate implementations by design, not a shared module
  — see [Live updates](sub-concepts/live-task-updates.md).

## Sub-concepts

- [Task files and the cascade](sub-concepts/task-files.md) — the format, `blockedBy`, `status.json`,
  and the batch write via `maestro-write-tasks.cjs`.
- [TaskCreate validation](sub-concepts/task-validation.md) — the hook, its warnings, its limits.
- [Claims](sub-concepts/task-claims.md) — `066`'s `claims/` overlay, liveness, reaping, and the
  second parity pair.
- [Delete and `postmortems.log`](sub-concepts/delete-and-postmortems.md) — `deleteTask`, the
  committed post-mortem history, and the context hook that feeds `/maestro-post-mortem`.
- [Live updates on the `/maestro-tasks` route](sub-concepts/live-task-updates.md) — `tailTasks` and
  the `tasks:subscribe` push channel.
