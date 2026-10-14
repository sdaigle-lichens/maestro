# Report r017: 104-let-a-worktree-run-deliver-channel-payloads-without-a-stall.md

- Task: 104-let-a-worktree-run-deliver-channel-payloads-without-a-stall.md
- Written: 2026-10-13T21:58:38.930Z
- From session: maestro-33

Outcome: done, clean run (default workflow, main checkout, no worktree). Review approved; pnpm verify green (1942 tests), parity passes.

Findings: Maestro's own guard allows .claude/channels/ (MAIN_CHECKOUT_SHARED_DIRS); the denials are the auto-mode classifier judging each cross-checkout write, so intermittent and not fixable by a path or hook change (cause inferred from code and task 101/102 evidence, not observed directly). Fix: in a worktree run the orchestrator writes the channel file from the agent's returned payload. handoff-issues says so; worktree subagents are now told their shell starts in the main checkout (pnpm --dir, git -C, absolute paths, no cd) and to return the payload in their final message if the write is denied. Plugin 0.11.21, mirrors refreshed, 6 new tests.

Caveat: an orchestrator-written file is unstamped, so the receiver's SubagentStart only mentions the path; the guidance says to name it in the receiver prompt. Inlining would need a stamping change.

Note: BACKLOG.md showed an unexplained 4-line deletion (Maestro task and manager flow section) not made by this task's agents.

Suggested ticket changes: none.
