# Report r006: 160-stop-flagging-hand-off-issues-on-an-agent-s-interim-stops.md

- Task: 160-stop-flagging-hand-off-issues-on-an-agent-s-interim-stops.md
- Written: 2026-11-09T03:05:15.074Z
- From session: worktree-handoff-fixes-160

Task 160 done, in worktree maestro-task-160 (branch task-160), NOT committed or merged (waiting for the user's approval).

- Design: option 2 as the user chose. An interim stop is logged `interim: true`, with no handoff_issue and no stamping, and kept in session.json `pending_interim`. `handoff-issues` settles it: a landed hand-back is judged normally; otherwise it becomes `missing` once the orchestrator has moved on or has looked once. Payload is measured from the agent's first dispatch.
- Plugin 0.13.33; libs, mirrors and orchestrator refreshed; parity passes.
- Verified on the uncommitted tree: full `pnpm --filter maestro test` 155 files, 3021 passed, 5 skipped, 0 failed; check, typecheck, lint, root lint pass.
- Review: @reviewer passed with no blockers. Nine test rounds, mostly prose-vs-label grammar edges (now line-anchored uppercase `HANDOFF:` for a SendMessage hand-back).
- Docs: handoff-contract.md, session-state.md, hooks.md, hook-writers.md, plugin-libs-parity (interim-stop.ts), test-maestro reference.
- Merge notes for 165 and the rebase: rebase task-160 onto main, take the next patch version, run `pnpm refresh:runtime` plus parity (do not hand-merge maestro-session.cjs), and re-run the full suite. Task 165 must respect `interim: true` log entries. 160 merges before 165.
- Documented limits are in handoff-contract.md; the post-mortem is in the task file.
