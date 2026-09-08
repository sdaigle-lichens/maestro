# Todo

There is no queued task right now. Every task file under `.claude/maestro-tasks/` (001 through 049,
the highest numbered) is `"done"` in `status.json`, and none are `"ready"` or newly unblocked.

To get a new task: run `/to-maestro-tasks` with a plan or idea to queue up fresh prompt files, or
check `.claude/maestro-tasks/status.json` directly if one might already be queued from another
session.
