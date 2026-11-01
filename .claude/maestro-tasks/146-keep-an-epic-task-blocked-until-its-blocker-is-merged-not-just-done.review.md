## Changed

- `apps/maestro/src/core/tasks.ts`, `contracts.ts`: epic dependents treat a blocker as satisfied only if done and not `unmerged`; `MaestroTask.unmergedBlockers`; stale tracker `ready` demoted to `blocked`.
- `plugins/maestro/scripts/lib/maestro-tasks.cjs` (hand-maintained twin): same rule, `markDone(..., {unmerged})`, `markMerged`.
- `apps/maestro/src/core/epics.ts`: `readyTasks` puts such tasks in `waitingOnMerge`, `formatReady` names the blocker; generated `lib/maestro-epic.cjs` rebuilt.
- `plugins/maestro/scripts/maestro-task-status.cjs`: `done` sets `unmerged: true` for a worktree run; `merge` clears it; new `mark-merged <task|NNN>`.
- `apps/maestro/src/renderer/src/routes/maestro-tasks.tsx`: "Waiting for merge of <name>" badge.
- `plugins/maestro/.claude-plugin/plugin.json`: 0.13.13 to 0.13.14.
- New `apps/maestro/test/core/unmerged-blockers.test.ts` (18 tests, same fixtures on both implementations).
- Not yet done: docs (task-queue, maestro-manager), @test and @reviewer passes.

## Did

- @backend: core rule, twin, CLI, epics, plugin version, tests.
- @frontend: unmerged-blocker badge in the task queue route.

## Deviations from the ticket

- Design decision (user delegated it to the design pass): "merged" = no `unmerged: true` flag. `done` sets it for a worktree run; `merge` or `mark-merged` clears it. Absent means merged, so existing status.json entries need no edit.
- A task closed from the UI never sets the flag, so it counts as merged.
- No renderer test: the repo's renderer tests cover only pure utilities.

## Verified

Working tree, not yet committed (no commit exists for this work). `pnpm refresh:runtime` was run by the user. `parity.test.ts`: 44 passed. Full `pnpm --filter maestro test`: 134 files, 2587 tests, all green on this tree. `typecheck`, `lint` and `check` passed in @backend's run. The root `pnpm verify` has not been run yet.
