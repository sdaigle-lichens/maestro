# Live-refresh the Maestro Tasks screen on status change

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The Maestro Tasks screen currently fetches its task list once via a route loader on mount and only updates local state in response to its own in-app Close action, so an external change to the task queue (a task closed elsewhere, another window, a hook, a direct file edit, or a new task file added to the queue) never reaches the mounted screen — the user has to navigate away and back to see it. Fix this by giving the Tasks screen the same live-update pipeline the Session Log view already has: a main-process poller over the on-disk task queue directory and its status file (poll-based, not fs.watch — this codebase has already decided against fs.watch for this kind of file due to unreliable create/append/delete lifecycle events), a subscribe/unsubscribe IPC push channel the renderer can listen on, and renderer wiring that applies pushed updates to the Tasks screen instead of relying solely on the one-shot loader value. The poller must detect both a status change to an existing task and a new task file appearing in the queue directory (not just entries in the status file changing value), and re-derive the full task list the same way the existing `listTasks` read path does. Preserve the existing in-app Close-task behavior. Ensure the watcher is correctly retargeted (not left stale) when the open project changes, matching how the Session Log's tail is retargeted on project switch.

## Acceptance criteria

- [ ] Marking a task done outside the app (editing the task queue's status file directly, or via the CLI/hook) while the Maestro Tasks screen is open updates the screen's displayed status without the user navigating away and back
- [ ] A new task file written to the task queue directory (e.g. by `/to-maestro-tasks` or `maestro-write-tasks.cjs`) while the Maestro Tasks screen is open appears on the screen without the user navigating away and back
- [ ] Closing a task via the in-app Close button still works and is reflected immediately, with no regression
- [ ] Switching projects correctly retargets or stops the watcher — no stale watcher left running against the previous project
- [ ] No polling loop keeps running when the Maestro Tasks screen is unmounted, unless the update mechanism is deliberately placed in a root-level provider that keeps it live across tabs — in which case that choice is explicit and intentional, not accidental

## Blocked by

None — can start immediately
