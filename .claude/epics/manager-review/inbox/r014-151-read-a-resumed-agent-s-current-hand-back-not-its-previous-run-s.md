# Report r014: 151-read-a-resumed-agent-s-current-hand-back-not-its-previous-run-s.md

- Task: 151-read-a-resumed-agent-s-current-hand-back-not-its-previous-run-s.md
- Written: 2026-11-06T14:18:08.293Z
- From session: manager-review-151

Outcome: task 151 implemented, tested and reviewed. A resumed agent's SubagentStop hand-back is now read from the current run only.

Verified: HEAD b1f2846 plus uncommitted working-tree changes (nothing committed). Full suite green on it: pnpm --filter maestro test, 2636 passed, 0 failed (135 files); parity.test.ts 44 of 44 after the user ran pnpm refresh:runtime; lint, typecheck and prettier --check clean.

Findings:
- Cause confirmed in code and by test, not against a live Claude Code resume: scanHandbacks scanned the whole transcript and awaitHandback stopped at the first hand-back call, so a resumed transcript returned the earlier run's text at once.
- Fix: scanHandbacks counts only hand-back calls after the last user entry that is not purely tool_result. maestro-subagent-log.js needed no change. Plugin bumped to 0.13.21, maestro-session.cjs regenerated, two maestro-architecture docs updated.
- Known limits, documented in the docs and the test header: an unflushed resume prompt still returns the earlier hand-back in one read; a text-bearing user entry after the hand-back discards it; the resume-prompt transcript shape is assumed, not checked against a real log.
- Resumed-agent hook tests use the test agent, not a reviewer (the fixture config has no reviewer node).
- Reviewer loop-back: one Prettier failure on the new test file, fixed by @test.
- Hook false positive seen: a resumed @test writing its next-numbered payload (test.2.md) raised a missing-payload warning for test.1.md. Same family as the out-of-scope resumed-run payload warning.

Post-mortem: none (clean run apart from the formatting loop-back).

Suggested ticket changes: task 152 can proceed. Consider a follow-up for the resumed-run payload numbering warning and for the unflushed-resume-prompt race.
