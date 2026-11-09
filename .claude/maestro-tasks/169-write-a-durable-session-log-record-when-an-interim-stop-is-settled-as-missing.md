# Write a durable session-log record when an interim stop is settled as missing

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Task 160 logs an agent's interim stop with an interim marker and no hand-off issue. When the run moves on without a hand-back, the hand-off issues command later settles that stop as a missing hand-off in session state, then deletes the record after printing it, so nothing durable says the stop was settled. Task 165's post-mortem digest therefore has to infer a missing hand-off from the log: an interim stop with no later final stop of the same agent run. That inference misreports an agent that is still working when the digest runs mid-session. Add a durable settle record to the session log when an interim stop is settled as missing, and make the post-mortem digest prefer that record over the inference, keeping the inference for older logs that have no such record. This is a code change in the hand-off issues command's TypeScript source and the generated plugin lib, the plugin's post-mortem script, tests, the hand-off concept notes, a rebuild of the generated libs, a patch plugin version bump and the repo's runtime refresh. That the settle happens in the hand-off issues command and deletes its record is taken from task 165's report: assumed, unverified, confirm before designing around it.

## Acceptance criteria

- [ ] Settling an interim stop as missing writes a durable record to the session log naming the agent run, and a test covers it
- [ ] The post-mortem digest counts that run as a missing hand-off from the record, and no longer reports a still-working agent as missing when no record exists yet but a later final stop may follow; a test covers a mid-session digest
- [ ] A log with no settle records (written before this change) is still read with the existing inference, and a test covers it
- [ ] The record and its readers are documented in the hand-off concept notes (handoff-contract, session-state, the log-view hook writers)
- [ ] The maestro plugin.json version gets a patch bump, the generated libs are rebuilt, pnpm refresh:runtime and the parity test pass (a sandboxed run hands the user ! pnpm refresh:runtime), and pnpm verify passes

## Touched surfaces

- plugins/maestro/scripts/maestro-task-status.cjs and its TypeScript source (handoff-issues), generated plugins/maestro/scripts/lib/*.cjs
- plugins/maestro/scripts/maestro-post-mortem.js
- .claude/scripts mirrors (generated)
- plugins/maestro/.claude-plugin/plugin.json (version, shared)
- .claude/skills/maestro-architecture/sub-concepts/handoff-contract.md, session-state.md; the log-view hook-writers note
- parallel OK with the worktree-handoff-fixes epic (166, the maestro-architecture stamp task, 167): whichever merges later rebases onto main, takes the next patch version and rebuilds generated files instead of hand-merging; the stamp task re-stamps if this lands first

## Blocked by

- `165-ask-where-each-displayed-number-comes-from-in-to-maestro-tasks-and-show-every-outcome-in-the-post-mortem-digest.md`
