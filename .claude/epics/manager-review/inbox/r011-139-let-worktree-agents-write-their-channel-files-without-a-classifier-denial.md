# Report r011: 139-let-worktree-agents-write-their-channel-files-without-a-classifier-denial.md

- Task: 139-let-worktree-agents-write-their-channel-files-without-a-classifier-denial.md
- Written: 2026-10-29T01:03:14.476Z
- From session: maestro-139

## Outcome
Task 139 done in worktree /home/superadmin/gits/maestro-task-139 (branch task-139), not yet merged. Plugin 0.13.7. `pnpm verify` passes (2373 tests, 5 skipped); parity 44/44; @reviewer found no defects.

Built: install and update add `Write(/.claude/channels/**)` to the project's `.claude/settings.json` (idempotent, malformed shapes untouched); uninstall removes exactly that rule; subagent guidance and the orchestrator template say Write, not mkdir; the orchestrator-writes-it fallback is kept; `handoff-issues` no longer reports NO PAYLOAD when a resumed agent's files are all stamped with this run's `run_id`. Tests: `channel-allow-rule.test.ts`, `handoff-issues-resolved.test.ts`, one corrected `install.test.ts` expectation.

## Findings
- Whether the allow rule stops the classifier denial is still NOT ESTABLISHED. One clean first-try write from the worktree happened with the user's absolute-path rule in `settings.local.json`. The denial is intermittent, so that is consistent with the fix, not proof. The portable `/.claude/...` form was never exercised in a live run. The fallback stays.
- The channels developer skill records this.

## Post-mortem
- @backend's first pass stopped as evidence-only because it missed the rule in `settings.local.json` (manager redirect, round 1).
- A prettier failure on `maestro-install.js` forced an @test loop-back and a third manager-review round for a format-only change.
- Claiming 139 stalled on a claim still held by an ended session; `release` correctly refused another session's claim. The worktree only appeared once the 140 holder claimed 140.
- @scribe could not run extract/apply for `installing-maestro` (code-graph CLI has no `--root`, shell starts in the main checkout).

## Suggested ticket changes
- Ticket the one remaining step: a live worktree run with only the portable rule, to see whether a channel write is still denied. If it is, ticket "channels inside the worktree".
- Ticket a stale-claim recovery path (a claim held by an ended session) and having @backend format plugin scripts with prettier before handoff.
- Run `extract installing-maestro` then `apply installing-maestro` from the worktree.
