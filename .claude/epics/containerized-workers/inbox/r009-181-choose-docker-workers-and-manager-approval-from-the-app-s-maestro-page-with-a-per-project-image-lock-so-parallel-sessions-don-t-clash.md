# Report r009: 181-choose-docker-workers-and-manager-approval-from-the-app-s-maestro-page-with-a-per-project-image-lock-so-parallel-sessions-don-t-clash.md

- Task: 181-choose-docker-workers-and-manager-approval-from-the-app-s-maestro-page-with-a-per-project-image-lock-so-parallel-sessions-don-t-clash.md
- Written: 2026-11-14T02:31:10.935Z
- From session: containerized-workers-181

## Outcome

Task 181 is built and committed as 6842878 on branch task-181. Not merged, not pushed.

## Verification

- Commit verified: 6842878. Full `pnpm verify` green on it: exit 0, 179 of 179 test files passed (3506 tests).
- That is the third full run on this commit. The first and second were red from 5000ms test timeouts only (1 failure, then 10 across 6 files, no assertion errors), on a machine with load average about 20 on 8 cores. The third run, after the load dropped, was green.
- Not proven: the timeouts were never shown to be unrelated to this task by a run on main. Evidence only: the epic CLI starts in about 0.10s on main's bundle and on this branch's, and the epics-cli watch test has about 3s of fixed waiting.

## Manager direction (live run against the real Docker daemon)

- (a) Two `maestro-worker-runtime.cjs image` builds started at once: one built maestro-worker-maestro:a186bc853b23 in 405.9s. The other printed that it was waiting for the other build, then reused the image the first built. Run by the user, output pasted.
- (b) The /maestro page in a real app window, Docker chosen: Docker daemon reachable (Docker 29.7.2), Worker token file found, Prune dry run succeeded ("nothing needed removing", kept the current tag), the Manager approval switch copy and the "affects only workers started afterwards" line present. Screenshot supplied by the user. The Rebuild worker image button was not shown as clicked in that screenshot; the rebuild itself was exercised by (a).

## Findings

- @test found a real race in the stale-lock takeover (`breakStale`): a rival's live lock, or a fresh directory without owner.json, could be deleted. Fixed by @backend, tests added and shown failing before the fix. One narrow window remains: a lock taken by a third process between the restore rename and the end of `breakStale` is discarded. Reviewer judged it non-blocking.
- Saving Host used to keep a hidden `manager_approval: true`; it now drops it.
- A failed readiness call showed "Checking readiness…" forever; it now shows an alert. @frontend also fixed a stale-result bug in the re-check.
- The renderer card has no component test: the repo has no DOM harness.
- If the launcher's best-effort record fails, `add-worker` records the live settings at that moment.

## Post-mortem notes

- The task needed one loop-back (test defect in the lock) and several manual `pnpm refresh:runtime` rounds, because the sandbox cannot write .claude/scripts.
- Sandbox: Bash cannot write .claude/skills (EROFS on the scribe stamp); Edit could.

## Suggested ticket changes

- A concept skill for containerized workers (the image lock, readiness, recorded settings): the scribe put them in task-queue's sub-concepts/epics.md for now.
- The epics-cli watch (176) test sits near its 5000ms limit (4.5s alone); consider a longer timeout or fewer fixed waits.
- Plugin version is 0.15.14; task 178 also bumps it, whichever lands second rebases.
