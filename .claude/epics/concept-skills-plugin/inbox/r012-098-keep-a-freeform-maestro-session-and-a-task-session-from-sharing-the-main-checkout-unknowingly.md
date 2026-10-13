# Report r012: 098-keep-a-freeform-maestro-session-and-a-task-session-from-sharing-the-main-checkout-unknowingly.md

- Task: 098-keep-a-freeform-maestro-session-and-a-task-session-from-sharing-the-main-checkout-unknowingly.md
- Written: 2026-10-13T17:48:37.635Z
- From session: maestro-95

Outcome: done. Freeform /maestro sessions now count as live for the worktree decision (session.json workflow, no active_task; same liveness rule as a claim), plus a freeform-check command. @test caught that liveForeignClaim returned early when claims/ was missing; fixed. Plugin 0.11.15, mirror refreshed, parity and tests pass. Suggestion: none.
