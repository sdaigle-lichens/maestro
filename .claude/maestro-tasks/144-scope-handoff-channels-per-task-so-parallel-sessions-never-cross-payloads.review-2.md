# Task 144 — review round 2 (manager review, run as human review: task is in no epic)

## Changed

- `.claude/agents/scribe.md` — "Ending your run" section now names `.claude/channels/<scope>/scribe/`, matching `plugins/maestro/agents/scribe.md`.
- Since round 1 (from @test): existing tests in 14 files under `apps/maestro/test/core/` moved to the scoped layout (none weakened), plus a new `channel-scope-collision.test.ts` (13 real-hook tests).

## Did

- @test: fixed the 120 failing tests and added the collision, legacy, guard and single-session tests (main checkout + git worktree). Negative control: 12/13 new tests fail against the pre-144 plugin. Found one stale file and looped back.
- @backend: updated the repo's own scribe agent copy. The full suite passes: 2526/2526 across 131 files. Parity passes.

## Deviations from the ticket

- None new. Not a defect, and outside the acceptance criteria: in a worktree, agents other than reviewer and refactor may still write into any channel scope. Only reviewer and refactor are confined.

## Corrections since the last round

- Round 1's deviations are resolved. The test suite is green, `pnpm refresh:runtime` has run, the parity test passes (44/44), and @backend's payloads were copied into `task-144/`.
- The stale `.claude/agents/scribe.md` that @test found is fixed.
