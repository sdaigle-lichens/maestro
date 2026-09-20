# Delete and `postmortems.log`

`deleteTask` (`apps/maestro/src/core/tasks.ts`) is the app-only counterpart to `closeTask`: the
`/maestro-tasks` route's "Delete task" button permanently removes a task file instead of marking it
done. It is **not** mirrored into `maestro-tasks.cjs` — nothing on the orchestrator side ever deletes
a task file, so there is no second implementation to keep in sync, unlike the cascade and claims
pairs.

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
