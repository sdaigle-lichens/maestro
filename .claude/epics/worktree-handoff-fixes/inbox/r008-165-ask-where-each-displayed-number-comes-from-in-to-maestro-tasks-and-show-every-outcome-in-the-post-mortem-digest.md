# Report r008: 165-ask-where-each-displayed-number-comes-from-in-to-maestro-tasks-and-show-every-outcome-in-the-post-mortem-digest.md

- Task: 165-ask-where-each-displayed-number-comes-from-in-to-maestro-tasks-and-show-every-outcome-in-the-post-mortem-digest.md
- Written: 2026-11-09T14:24:33.694Z
- From session: worktree-handoff-fixes-165

Outcome: task 165 rebased onto main (e04fc79, 160 merged) and finished. Branch task-165, worktree /home/superadmin/gits/maestro-task-165.

Commit verified: e1d0c0c (on 62cef17, the rebased first commit). Full suite green on e1d0c0c with a clean tree: root pnpm verify exit 0, 159 files, 3101 passed, 5 skipped, 0 failed. Parity 44/44 earlier on the same code. plugin.json 0.13.35 (main is 0.13.34); no mirrored script changed, so no refresh:runtime needed.

Changes:
- to-maestro-tasks SKILL.md: asks where any number or derived value shown in a UI comes from; stack-agnostic; written into the task.
- maestro-post-mortem.js: every outcome kind listed with a Problems section; 160's interim: true used (no guess); an interim stop that is an agent's last handoff is a missing HANDOFF inferred from the log (option A, per your direction); one digest row per agent_id because a resume writes a second dispatch entry, which had counted a resumed run twice.
- Tests: post-mortem-outcomes (4) and post-mortem-dedupe-165 (10), including real-hook replays of resumed and never-resumed interim stops.
- Docs: maestro-architecture post-mortem row and test-maestro hook-script reference.

Findings:
- The first design read a settle record from session.json handoff_issues; the tester's real-path replay showed handoff-issues deletes it, so nothing durable remains. Fixed by option A. A durable settle marker in the log stays a separate follow-up.
- Caveat of option A: a digest run mid-session reports a still-working agent with an interim last stop as missing.
- Pre-existing, not changed: two id-less dispatches share one id-less handoff in the digest.
- maestro-architecture SKILL.md is NOT stamped: three mapped files drifted (handoff-label.ts, handoff-payload.ts, plugin-entries/maestro-session.ts) and need a comparison, then skills stamp --reviewed.
- Before merge: check main plugin.json just before merging; if 166 took 0.13.35, rebase, take 0.13.36 and re-run the root verify.

Post-mortem notes: the tester ended HANDOFF: FAIL once solely for a missing 0.13.36 bump, which I judged wrong (one patch bump over main is enough); no code defect behind it.

Suggested ticket changes: none.
