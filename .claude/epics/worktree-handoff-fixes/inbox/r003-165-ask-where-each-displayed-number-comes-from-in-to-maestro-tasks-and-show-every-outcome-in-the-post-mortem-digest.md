# Report r003: 165-ask-where-each-displayed-number-comes-from-in-to-maestro-tasks-and-show-every-outcome-in-the-post-mortem-digest.md

- Task: 165-ask-where-each-displayed-number-comes-from-in-to-maestro-tasks-and-show-every-outcome-in-the-post-mortem-digest.md
- Written: 2026-11-08T03:14:19.223Z
- From session: worktree-handoff-fixes-165

Outcome: task 165 implemented and passed all steps (backend, frontend no-op, manager review on-track, test, reviewer, scribe), first pass, no redirects.

Verified: worktree /home/superadmin/gits/maestro-task-165, branch task-165, uncommitted changes on top of ea0a2b0. Full suite green on that tree: pnpm verify and pnpm lint pass, 147 files, 2926 passed, 5 skipped, 0 failed; parity test 44/44.

Changes:
- plugins/maestro/skills/to-maestro-tasks/SKILL.md: ask where any number or derived value shown in a UI comes from (existing source, built in this task, or a later task); written into whatToBuild, a later-task source goes into blockedBy. Stack-agnostic, no new template field.
- plugins/maestro/scripts/maestro-post-mortem.js: digest lists every outcome kind (success, fail, blocked, other labels, missing HANDOFF, no-return, interim), a Problems section before the timeline, problems array and interim flag in the JSON.
- plugins/maestro/.claude-plugin/plugin.json: 0.13.32 to 0.13.33.
- apps/maestro/test/core/post-mortem-outcomes.test.ts: new, 2 tests.
No mirror changed, so no pnpm refresh:runtime needed.

Findings, for the merge:
- The interim-stop field (interim: true or status interim) is a placeholder: task 160 is not merged. Before merge, rebase onto 160, read its real field, adjust isInterim() and the test.
- The version 0.13.33 will be taken by an earlier merge: take the next patch version at rebase.
- The tester's own interim stops were flagged as NO HANDOFF by the SubagentStop hook, the false positive task 160 targets.
- Task 160 will need to document the interim field in session-state.md and log-view hook-writers.md.
- Task 157 edits the same SKILL.md afterwards.

Post-mortem notes: none for the task itself. Process friction only: subagents twice ended without a channel payload (worktree writes), and the scribe embedded its HANDOFF inside JSON so the hook read a malformed label.

Suggested ticket changes: none.
