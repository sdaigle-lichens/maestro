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
array, or as strings naming a task already in the queue by filename or `NNN` — refused unless it
matches exactly one existing file), and the script assigns numbers/slugs, renders each file, and calls `sync()` in one pass —
folding what used to be two separate steps (write the files, then run `maestro-task-status.cjs sync`)
into one script call.

**Where the writer puts the queue (`071`).** `maestro-write-tasks.cjs` resolves its root with
`findProjectRoot`, starting from `CLAUDE_PROJECT_DIR` (else cwd): the **nearest ancestor containing
`.claude/maestro.json`**, else the nearest ancestor containing `.git`, else the start dir. So a run
from a sub-folder never creates a sub `.claude/maestro-tasks/`. Trap: a nested folder that has its own
`.claude/maestro.json` wins over the repo root, by design (monorepo apps). The 071 task itself was
once queued at `apps/maestro/.claude/skills/.claude/maestro-tasks/` — the failure this prevents.
Test: `apps/maestro/test/core/write-tasks-root.test.ts`. Only the writer resolves this way; the
orchestrator's `maestro-task-status.cjs` and the app use their own project dir.

Because the queue lives in the project's `.claude/`, it is shared state between the desktop app's
`/maestro-tasks` route and the orchestrator — see the parent skill on keeping the two
implementations in agreement.

Files: `apps/maestro/src/core/tasks.ts`, `plugins/maestro/scripts/lib/maestro-tasks.cjs`,
`plugins/maestro/scripts/maestro-task-status.cjs`.
