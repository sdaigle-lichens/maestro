# Task files and the cascade

Each task is `NNN-<kebab-title>.md` under `<project>/.claude/maestro-tasks/`. The body is a prompt
for whoever ends up running it: a title, a "What to build" section describing one vertical slice, and
acceptance criteria. It names no agent — `/to-maestro-tasks` writes them workflow-agnostic on purpose,
so the orchestrator classifies at dispatch time.

`parseBlockedBy` reads dependencies out of the file. `status.json` stores `{ status, blockedBy }`
per filename, and `listTasks` combines the two to report what is ready:

```json
{ "001-….md": { "status": "done", "blockedBy": [] } }
```

The cascade means a task is ready only when everything it names is done. `closeTask` marks one done
and recomputes the cascade, so a single close can unblock several tasks at once.

`/to-maestro-tasks` does not hand-assemble the files for a fresh batch: it hands
`maestro-write-tasks.cjs` a JSON array of slices (title, body, `blockedBy` as indices into that same
array), and the script assigns numbers/slugs, renders each file, and calls `sync()` in one pass —
folding what used to be two separate steps (write the files, then run `maestro-task-status.cjs sync`)
into one script call.

Because the queue lives in the project's `.claude/`, it is shared state between the desktop app's
`/maestro-tasks` route and the orchestrator — see the parent skill on keeping the two
implementations in agreement.

Files: `apps/maestro/src/core/tasks.ts`, `plugins/maestro/scripts/lib/maestro-tasks.cjs`,
`plugins/maestro/scripts/maestro-task-status.cjs`.
