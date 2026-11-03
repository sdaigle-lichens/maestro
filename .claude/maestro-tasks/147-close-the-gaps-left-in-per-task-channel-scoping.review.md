# Review: task 147, round 1 (manager review run as a human review: task is in no epic)

## Goal
Close four gaps left in per-task channel scoping (task 144): guard every worktree agent to its own scope, make a claim set the scope, retire the old scope's lanes on a task switch, make ChannelsCard testids unique per scope.

## Done
Gaps 1 to 4 are implemented. Tests are NOT written yet (@test is next). Plugin 0.13.11 to 0.13.12, libs rebuilt, mirrors refreshed (parity test passes).

## Changed
- Guard (gap 1): `apps/maestro/src/core/worktree-write-guard.ts`, `plugins/maestro/scripts/maestro-channel-write-guard.js`
- Claim sets scope (gap 2): `apps/maestro/src/core/handoff-channels.ts` (`recordActiveTask`), `plugins/maestro/scripts/maestro-task-status.cjs`
- Task switch retires old scope (gap 3): `handoff-channels.ts` (`retireScope`), `plugins/maestro/scripts/maestro-set-session-workflow.cjs`
- Exports: `apps/maestro/src/core/index.ts`, `plugin-entries/maestro-session.ts`; rebuilt `plugins/maestro/scripts/lib/maestro-session.cjs`
- UI (gap 4): new `apps/maestro/src/renderer/src/components/channel-lanes.tsx`, `routes/maestro.tsx`; testid is now `channel-lane-<scope|legacy>/<receiver>`
- Comment fix: `apps/maestro/src/shared/ipc.ts`
- New test: `apps/maestro/test/renderer/channel-lanes.test.ts`
- Version bump and refreshed `.claude/scripts` mirrors
- Not from this task: untracked task 148 file and `scribe-output/*` changes

## Did
- @backend: gaps 1 to 3, libs rebuilt, version bump, repo-wide stale-layout search (one stale comment found, fixed). Wrote no tests.
- @frontend: gap 4, extracted the lane list into a component, added the component test.

## Deviations from the ticket
- No backend tests yet; @test writes them (the agent definition forbids backend writing tests).
- ChannelsCard lane list was moved out of `routes/maestro.tsx` into its own component so it can be rendered in a node-only test.
- Known red tests for @test to fix: `worktree-write-guard.test.ts` line 122 (writes the legacy path, now refused on purpose) and `worktree-channel-delivery.test.ts` (expects `session-sess-104`, a claim now sets `task-002`).
- `.claude/skills/maestro-architecture/sub-concepts/channels.md` still says a claim does not record `active_task`; @scribe fixes it.

## Decisions
- `retireScope` moves lanes to `<scope>/.consumed/` rather than deleting, and does nothing if another session dir resolves to the same scope. Skill-gap reports are kept.
- A claim that fails to record `active_task` still stands.

## Touches
Write guard, handoff-channels, task-status CLI, set-session-workflow CLI, maestro-session bundle, interactions/channels UI.

## Sibling impact
Every agent in a worktree session now loses write access to the legacy unscoped channel root.

## Questions
None.
