# Todo

`045` was the last task in the queue — it is now `done`, nothing is `blockedBy` it, and there is no
`046` file yet. There is no next task queued. Whoever picks this up next should look at
`.claude/maestro-tasks/` (and `status.json` alongside it) to decide what to queue next, e.g. with
`/to-maestro-tasks`.

**Any change under `plugins/<name>/` must bump that plugin's `plugin.json` `version`** — see
`.claude/skills/updating-maestro/` for which component.
