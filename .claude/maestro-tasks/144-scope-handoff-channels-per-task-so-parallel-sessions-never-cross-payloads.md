# Scope handoff channels per task so parallel sessions never cross payloads

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Handoff channel payloads leak between concurrent /maestro sessions. Every session (the main checkout and each git worktree, which deliberately shares the main checkout's .claude/channels/) writes and reads lanes keyed only by receiver and sender (.claude/channels/<receiver>/<sender>.N.md). So one ticket's payload is injected into another ticket's subagent. Reported by the code-graph manager (epic absorb-concept-skills): workers 045, 048, 049 and 050 ran at once in worktrees ../code-graph-task-0NN. 048's @test was injected test/backend.1.md, which was 045's payload. 049's @test also got a 045 payload. scribe/backend.2.md held 045's gaps, but 048 picked them up. Evidence: /Users/samueldaigle/Documents/gits/code-graph/.claude/epics/absorb-concept-skills/inbox/r044-048-tell-an-unreadable-ts-morph-deps-dir-apart-from-a-missing-one-in-the-macos-sandbox.md (Post-mortem section). Change the runtime so every channel file belongs to exactly one task or run, for example a per-task or per-session level in the channel path, and only that run writes it, injects it, delivers it on resume, sweeps it, lists it as pending, or acknowledges its gaps. Choosing the scoping key (task, session or run_id) and what happens to a session that has no claimed task is a design decision: run the architecture design pass first. Keep the run_id stamp, resume delivery, the sweep, pending lanes, gap acknowledgement, the channel write guard and the worktree write guard consistent with the new layout. Update the install/uninstall and session-cleanup scripts, the orchestrator template text and the concept skills that describe the channel path, including messages in source code that name the old path. This is a plugin change: edit the TypeScript plugin-entries sources, rebuild the generated libs, bump the maestro plugin's patch version, refresh the tracked runtime mirrors, and add tests.

## Acceptance criteria

- [ ] Two sessions on different tasks running at once, including one in a git worktree that shares the main checkout's channels, never see each other's channel files: a payload written for one is never injected into, resumed for, swept by, listed as pending for, or gap-acknowledged by the other
- [ ] A test reproduces the 045/048 collision (two concurrent runs, the same sender and receiver pair) and passes
- [ ] A single session with no parallel peers behaves as before: handoffs, resume delivery, the run_id freshness check and the 14-day sweep still work
- [ ] Channel files left in the old unscoped layout are swept or ignored safely, never delivered to an unrelated run
- [ ] The channel write guard and worktree write guard accept the new paths and still block writes outside them
- [ ] Every reference to the old channel path in plugin scripts, the orchestrator template, the architecture/installing concept skills and messages in source code is updated
- [ ] The maestro plugin.json version gets a patch bump, the generated libs are rebuilt, and pnpm refresh:runtime plus the parity test pass (a sandboxed run hands the user ! pnpm refresh:runtime)
- [ ] pnpm verify passes

## Blocked by

None — can start immediately

## Post-Mortem

- **Problem:** Two loop-backs from @test to @backend for stale repo-local copies that name the channel path: `.claude/agents/scribe.md`, then `.claude/reports/{test,backend,frontend,scribe}.md`. The orchestrator's dispatch brief told @backend to grep only `apps/maestro/src` and `plugins/maestro`, so the project's own agent and report overrides were never in scope.
  **Fix:** none
- **Problem:** @backend's first payloads were written in the OLD unscoped layout, because this session's hooks were the pre-refresh `.claude/scripts` mirrors. The refresh could only run after the human review, so the orchestrator had to copy `test/backend.1.md` and `scribe/backend.2.md` into `task-144/` by hand before @test could receive them.
  **Fix:** none
- **Problem:** @backend handed off with 121 tests red. The agent may not write tests, and the sandbox blocked `pnpm refresh:runtime`, so the round-1 human review approved a red suite on the promise that @test would fix it.
  **Fix:** none
- **Problem:** The orchestrator put `mark-task-done` into the `plan` step list, so `done` refused once until that step was marked done.
  **Fix:** none
