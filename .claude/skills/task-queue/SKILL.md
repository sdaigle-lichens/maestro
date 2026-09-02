---
name: task-queue
description: "Explains the Maestro task queue: the numbered prompt files under .claude/maestro-tasks/, the blockedBy cascade and status.json that decide which are ready, the PostToolUse hook that checks TaskCreate calls against the selected workflow's success path, and the two implementations (tasks.ts and maestro-tasks.cjs) that must agree. Use when working on /to-maestro-tasks, the /maestro-tasks route or the validation hook, when a task won't unblock, or when a close from the UI and one from the orchestrator disagree."
metadata:
  type: concept-skill
  version: "1.0"
  last-update: ff24b375eadb31a3b2628a3070bc8631a08063fa
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

## Two implementations that must agree

`apps/maestro/src/core/tasks.ts` (the app) and `plugins/maestro/scripts/lib/maestro-tasks.cjs` (the
orchestrator) both implement the cascade. **`maestro-tasks.cjs` is the one lib file that is NOT
generated** — it has no `plugin-entries/` source, and is hand-maintained in sync with `tasks.ts`
precisely so a close from the UI and one from the orchestrator cannot disagree about which tasks are
ready. Changing the cascade in one place and not the other is the failure mode this arrangement
exists to prevent.

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
| `plugins/maestro/scripts/maestro-task-status.cjs` | Status CLI. |
| `plugins/maestro/skills/to-maestro-tasks/` | The authoring skill. |
| `apps/maestro/src/renderer/src/routes/maestro-tasks.tsx` | The app's view. |

## Relationships

- `maestro-architecture` — the orchestrator that consumes the queue, and the `success-path` the hook
  validates against.
- [`concept-skills-system`](../concept-skills-system/SKILL.md) — the other plugin subsystem split
  across a TS source and a CJS twin.
- `plugin-libs-parity` (in `apps/maestro/.claude/skills`) — the generation rule this file is the
  documented exception to.

## Sub-concepts

- [Task files and the cascade](sub-concepts/task-files.md) — the format, `blockedBy`, `status.json`.
- [TaskCreate validation](sub-concepts/task-validation.md) — the hook, its warnings, its limits.
