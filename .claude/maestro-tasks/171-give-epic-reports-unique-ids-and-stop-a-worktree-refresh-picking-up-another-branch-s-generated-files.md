# Give epic reports unique ids and stop a worktree refresh picking up another branch's generated files

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Two script bugs seen in the worktree-handoff-fixes epic.

1. **Duplicate report ids.** Two tasks in the same epic each got report id r009. Acknowledging one by id then did not clear the other, so the manager could not tell them apart by id. Report ids must be unique within an epic's inbox even when two workers write reports at nearly the same time, and acknowledging must address one report unambiguously. Existing inboxes that already contain a duplicate id must still list and acknowledge correctly.
2. **Refresh leak into a worktree.** Running `pnpm refresh:runtime` in a task's worktree wrote generated files (the rendered handoff for test -> reviewer and the runtime version in `.claude/maestro.json`) that came from another task's branch, which was checked out in the main checkout at the time. The worker had to stash them by hand. A refresh in a worktree must generate only from that worktree's own sources. Assumed, unverified: that the leak comes from the refresh resolving the project root or global store to the main checkout rather than the worktree. Find the real cause before fixing it.

This needs code in the plugin scripts or their TypeScript sources, tests for both bugs, rebuilt generated libs and mirrors where touched, a patch version bump, and concept-note updates where they describe report ids or the refresh.

## Acceptance criteria

- [ ] Two reports written to the same epic in quick succession get different ids; a test covers concurrent or back-to-back writes
- [ ] Acknowledging a report addresses exactly one report, including in an inbox that already holds a duplicate id
- [ ] A refresh run in a worktree writes nothing derived from another branch's checkout; a test reproduces the leak and proves the fix
- [ ] The root cause of the refresh leak is stated in the report
- [ ] plugin.json gets a patch bump; `pnpm refresh:runtime` and the parity test pass; `pnpm verify` is green on the reported commit

## Touched surfaces

- maestro-epic.cjs report/ack id allocation (plugin script or its plugin-entry source)
- the refresh:runtime path (apps/maestro/scripts, install/refresh code in src/core)
- plugins/maestro/.claude-plugin/plugin.json (patch bump)
- generated plugins/maestro/scripts/lib/*.cjs and .claude/scripts mirrors if touched
- concept notes describing epic inboxes and the refresh
- parallel OK with the commit/merge guard task: merge order that task first, this one rebases and takes the next patch

## Blocked by

None — can start immediately
