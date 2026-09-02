# Task files and the cascade

Each task is `NNN-<kebab-title>.md` under `<project>/.claude/maestro-tasks/`. The body is a prompt
for whoever ends up running it: a title, a "What to build" section describing one vertical slice, and
acceptance criteria. It names no agent — `/to-maestro-tasks` writes them workflow-agnostic on purpose,
so the orchestrator classifies at dispatch time.

`parseBlockedBy` reads dependencies out of the file. `status.json` stores `{ status, blockedBy }`
per filename, and `listTasks` combines the two to report what is ready. `closeTask` marks one done
and recomputes the cascade, so a single close can unblock several tasks.

Because the queue lives in the project's `.claude/`, it is shared state between the desktop app's
`/maestro-tasks` route and the orchestrator — see the parent skill on keeping the two
implementations in agreement.

Files: `apps/maestro/src/core/tasks.ts`, `plugins/maestro/scripts/lib/maestro-tasks.cjs`,
`plugins/maestro/scripts/maestro-task-status.cjs`.
