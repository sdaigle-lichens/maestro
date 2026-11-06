# Report r015: 151-read-a-resumed-agent-s-current-hand-back-not-its-previous-run-s.md

- Task: 151-read-a-resumed-agent-s-current-hand-back-not-its-previous-run-s.md
- Written: 2026-11-06T14:20:08.148Z
- From session: manager-review-151

Outcome: task 151 is committed as 0339855 on main (not pushed). A resumed agent's SubagentStop hand-back is now read from the current run only.

Verified: commit 0339855. Full suite green on it: pnpm --filter maestro test, 2636 passed, 0 failed (135 files), run after the commit. Before the commit, the same code also passed parity.test.ts (44 of 44, after the user's pnpm refresh:runtime), lint, typecheck and prettier --check. Caveat: the working tree held uncommitted unrelated files during that run (.claude/maestro.json, epics state.json, status.json, the review and inbox files). They are not in the commit, and the task's own files are all in it.

Committed (8 files): handoff-label.ts, runtime-version-and-payload.test.ts, the new handoff-run-boundary-151.test.ts, plugin.json (0.13.21), maestro-session.cjs in plugins and .claude/scripts, and the two maestro-architecture docs (handoff-contract.md, hooks.md). .claude/maestro.json was left out, as asked.

Findings, post-mortem and suggested ticket changes are unchanged from report r014: the cause was confirmed in code and by test but not against a live resume; known limits are an unflushed resume prompt and a text-bearing user entry after the hand-back; a resumed agent's next-numbered payload still raises a false missing-payload warning.
