# A session waiting on the user keeps its claim live

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

A task claim counts as live only while the claiming session's directory exists and its log.jsonl was written within the claim idle cap (15 minutes). The log is only written by agent activity, so a session that is waiting on the user (a human review, an escalated manager review, a start-skill question) or that dispatches no agent at all looks dead after 15 minutes, or immediately when it never wrote a log. Another session can then reap its claim and take the task, and the worktree decision treats it as absent and puts a parallel task in the main checkout next to it. Seen in the manager-review epic: a hold session that claimed a task and waited on a question had no log.jsonl, so it never counted as live; and a session whose tab was closed without a clean end kept its claim looking live for 15 minutes, blocking a re-run. Make liveness reflect a session that is still open and waiting: its liveness signal must stay fresh while it waits on the user or runs only inline steps, without relying on agent dispatches. A session that really ended (tab closed, process gone) must still lose its claim, ideally sooner than the full idle cap. Keep the TypeScript claims implementation and the hand-written CJS twin in agreement. Includes the liveness change, regenerated plugin libs and mirrors if a plugin-entries source changes, tests (waiting session stays live past the cap; ended session is reaped), the task-queue developer skill's claims section, and a plugin version bump (patch).

## Acceptance criteria

- [ ] A session that claimed a task and waits on the user for longer than the idle cap still holds its claim and still counts as live for the worktree decision
- [ ] A session that dispatches no agent still counts as live while it is open
- [ ] A session that has ended loses its claim, and another session can then claim the task without waiting the full idle cap where that can be detected
- [ ] The claims implementation and its CJS twin agree, with tests for both cases
- [ ] The task-queue developer skill describes the new liveness rule; the plugin version is bumped (patch) and pnpm verify passes

## Blocked by

None — can start immediately
