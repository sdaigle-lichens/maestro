# Live updates on the `/maestro-tasks` route

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
