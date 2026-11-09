# Human review: task 160 (escalated from manager review m004)

Manager note: it escalated one question to you. Is an interim-stop signal that fails toward "no flag" acceptable? As built, a final stop that ends in plain text with no HANDOFF line and no hand-back call reads as interim and is never flagged, and neither is an agent that stops once and is never resumed. Ticket criterion 3 says a final stop with no HANDOFF line is still flagged. The ticket allowed deferring the judgement to the run's final stop as an alternative. The rest of the brief is in line with the epic.

## Changed
- Hook and core: `handoff-label.ts` (new `isInterimStop`), `handoff-payload.ts` (new `agentRunStartedAt`), `plugin-entries/maestro-session.ts`, `plugins/maestro/scripts/maestro-subagent-log.js`.
- Generated or mirrored: `plugins/maestro/scripts/lib/maestro-session.cjs`, `.claude/scripts/lib/maestro-session.cjs`, `.claude/scripts/maestro-subagent-log.cjs`, `.claude/maestro.json` (runtimeVersion).
- `plugins/maestro/.claude-plugin/plugin.json`: 0.13.32 to 0.13.33.
- Docs: `.claude/skills/maestro-architecture/sub-concepts/handoff-contract.md` (new section "Interim stops are not judged (160)").
- Tests: new `apps/maestro/test/core/interim-stop-160.test.ts`; three tests in `runtime-version-and-payload.test.ts` updated.

## Did
- @backend: wrote the tests first (6 of 12 failed on the old hook, both false modes), then the fix, rebuilt the libs, bumped the version, refreshed the mirrors and wrote the doc section.

## Deviations from the ticket
- No live Claude Code probe was run. The SubagentStop input carries no interim field, so "interim" means the current run made no `SubagentHandback` or `SendMessage` call after the existing 3 s transcript wait.
- That fails toward no flag (the question above). Also not flagged: a flush slower than 3 s, and an agent stopped once and never resumed. An interim stop is not remembered anywhere.
- Interim stops skip channel stamping, so a stale file's mtime is not refreshed before the final stop.
- Three existing tests that pinned "missing when the hand-back never lands" (124, 151, 153) now expect an interim stop.

## Verified
- Commit: work is uncommitted on top of `ea0a2b0` in `/home/superadmin/gits/maestro-task-160` (branch `task-160`).
- Full `pnpm --filter maestro test` on that tree, run by the orchestrator: 147 files passed, 2936 tests passed, 5 skipped.
- The backend agent also reported `check`, `typecheck`, `lint`, root `pnpm lint` and `parity.test.ts` passing. The orchestrator did not re-run those.
- Not done yet: the @test and @reviewer steps, and `pnpm verify` as a whole.
