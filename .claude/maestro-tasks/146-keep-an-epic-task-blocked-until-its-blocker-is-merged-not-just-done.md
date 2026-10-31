# Keep an epic task blocked until its blocker is merged, not just done

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Inside an epic, a task currently becomes ready as soon as its blocker is marked done, even when the blocker's work is not merged. So a follow-up that needs the blocker's code starts its worker or worktree from a base without it (seen in code-graph's absorb-concept-skills epic). Change the task queue's readiness so that, for tasks in an epic, a blocker counts as satisfied only once its work is merged into the branch the dependent will start from. The epic's ready/spawn listing, the status sync and the desktop app's task queue must all agree. Deciding what counts as 'merged' (into the epic's base branch, into main, a recorded merge commit, or a status the merger sets) and how existing done-but-unmerged entries migrate is a design decision: run the architecture design pass first. Tasks outside any epic keep today's behaviour. Update the task-queue and maestro-manager documentation, including messages in source code that explain why a task is blocked. This is a plugin change: edit the TypeScript sources, rebuild the generated libs, bump the maestro plugin's patch version, refresh the tracked runtime mirrors, and add tests.

## Acceptance criteria

- [ ] In an epic, a task whose blocker is done but not merged is not listed as ready or spawnable, and the reason shown says the blocker is unmerged
- [ ] Once the blocker counts as merged under the chosen definition, the dependent becomes ready
- [ ] Tasks outside an epic unblock exactly as before
- [ ] The plugin's task scripts and the desktop app's task queue agree, proven by tests on both
- [ ] Existing status.json entries keep working without a hand edit
- [ ] The task-queue concept skill and maestro-manager skill describe the new rule
- [ ] The maestro plugin.json version gets a patch bump, the generated libs are rebuilt, pnpm refresh:runtime and the parity test pass (a sandboxed run hands the user ! pnpm refresh:runtime), and pnpm verify passes

## Blocked by

- `145-plan-for-file-overlap-and-merge-order-when-tasks-run-in-parallel.md`
