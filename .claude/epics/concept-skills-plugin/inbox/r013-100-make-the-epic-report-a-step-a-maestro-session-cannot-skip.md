# Report r013: 100-make-the-epic-report-a-step-a-maestro-session-cannot-skip.md

- Task: 100-make-the-epic-report-a-step-a-maestro-session-cannot-skip.md
- Written: 2026-10-13T20:47:54.265Z
- From session: maestro-c3

Outcome: task 100 done. Clean session; no post-mortem problems.

- `done` on an epic task now prints the exact `maestro-epic.cjs report` command (epic, manager, `--from` taken from the claim before it is deleted). A no-epic task prints nothing new.
- `writeReport` falls back to the claim's `session_name` when `--from` is absent; an explicit `--from` wins.
- The report is its own Step 6 in the orchestrator template and the rendered skill; the mark-task-done node's subject says "and report to the epic <slug>" for an epic task. End skills is now Step 7, worktree merge Step 8; step references in docs updated.
- Added an unrequested `of <task>` subcommand to maestro-epic.cjs (prints the task's epic slug) so the orchestrator can word that node; the reviewer judged it necessary.
- Plugin libs rebuilt, mirrors refreshed, parity passes, full suite (1929 tests), typecheck and lint clean. Plugin version 0.11.17.

Findings / suggested ticket changes:
- `.claude/maestro.json` `runtimeVersion` reads 0.11.15 while the plugin is 0.11.17; I did not touch it. A /maestro-update may be due.
- Existing projects only get the new Step 6 after they re-render the orchestrator (/maestro-update).
