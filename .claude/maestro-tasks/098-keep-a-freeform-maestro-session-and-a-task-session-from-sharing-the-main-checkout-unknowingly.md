# Keep a freeform /maestro session and a task session from sharing the main checkout unknowingly

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

A /maestro run started from a freeform prompt (no .claude/maestro-tasks file) never claims anything, so it skips the worktree decision entirely, and a task session started alongside it sees no other live claim and is told 'no worktree needed, work in the main checkout'. Both then edit the main checkout at once without either knowing. This happened in this epic: task 097 and a freeform team-meeting documentation run both wrote to the main checkout, ending in shared files (the maestro plugin.json bumped twice, one script holding both sessions' hunks) that could not be committed separately.

Make a freeform session visible to the same live-session check a task session uses, and make it go through the same worktree decision. A freeform session registers its presence when it records its workflow and drops it when it ends (with the same staleness handling as a task claim, so a crashed session doesn't block forever). When another live session is already working, whichever session starts second gets a worktree, or, when no worktree can be named (a freeform session has no task number), is told which session is active and works in the main checkout only if the user agrees. A freeform session must never show up as a claimable or claimed task in the queue, the epic view or the Maestro app.

## Acceptance criteria

- [ ] A task session started while a freeform /maestro session is live is not told 'no worktree needed'; it gets a worktree as it would against another task claim
- [ ] A freeform /maestro session started while a task session holds a claim is told which session is active, and either gets an isolated worktree or proceeds in the main checkout only after the user agrees
- [ ] A freeform session's presence clears when it ends, and a stale one (dead session) is ignored by the same rule that ignores a stale task claim
- [ ] A freeform session never appears as a task in status.json, maestro-epic show or the Maestro app's task views
- [ ] Tests cover both orders (freeform first, task first) and the stale-presence case; the generated plugin libs are rebuilt, mirrors refreshed, parity test passes and the maestro plugin version is bumped

## Blocked by

None — can start immediately
