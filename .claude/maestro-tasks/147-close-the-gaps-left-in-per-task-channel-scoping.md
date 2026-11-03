# Close the gaps left in per-task channel scoping

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Task 144 scoped handoff channels per task or session (.claude/channels/<scope>/<receiver>/<sender>.N.md), and its run surfaced four gaps that still let scopes leak or linger. (1) In a git worktree, agents other than reviewer and refactor can still write into another task's channel scope: the channel and worktree write guards must confine every agent to its own session's scope. (2) Claiming a task does not by itself set the session's channel scope: a claim must set it, so no session runs a claimed task under a scope that isn't that task's. (3) When a session switches task mid-run, the previous scope's lanes are left to the 14-day age-out: retire or sweep them when the switch happens, without touching another live session's scope. (4) The desktop app's ChannelsCard repeats the same data-testid across scopes: make it unique per scope. See task 144's ## Post-Mortem for context. The fix spans plugin hook scripts, the TypeScript core and plugin-entries sources, and an app UI component, with tests for each. Update the architecture concept skill where it describes channel scoping. This is a plugin change: rebuild the generated libs, bump the maestro plugin's patch version, refresh the tracked runtime mirrors.

Two lessons from 144's run apply here. When searching for references to the channel layout, search the whole repository, including .claude/agents/, .claude/reports/ and .claude/skills/, not only apps/maestro/src and plugins/maestro. 144 lost two test-to-backend loop-backs to copies it missed. This session's own hooks are the ones being changed, and they keep running the old code until the tracked mirrors are refreshed. So refresh them (a sandboxed run hands the user ! pnpm refresh:runtime) right after the hook and lib changes, before the next handoff, and never hand-copy channel files between layouts.

## Acceptance criteria

- [ ] A test shows that any agent in a worktree session is refused a write into another task's channel scope, while writes into its own scope still pass
- [ ] Claiming a task sets the session's channel scope, and a test covers a session that claims after starting
- [ ] Switching task mid-session retires the previous scope's lanes, never another live session's, and a test covers it
- [ ] ChannelsCard data-testids are unique across scopes, with a component test
- [ ] A whole-repo search, including .claude/agents, .claude/reports and .claude/skills, finds no stale description of the channel layout
- [ ] Every handoff after the refresh lands in the scoped layout, and no channel file was copied by hand
- [ ] The maestro plugin.json version gets a patch bump, the generated libs are rebuilt, pnpm refresh:runtime and the parity test pass (a sandboxed run hands the user ! pnpm refresh:runtime), and pnpm verify passes

## Blocked by

- `144-scope-handoff-channels-per-task-so-parallel-sessions-never-cross-payloads.md`
