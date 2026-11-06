# Report r022: 156-warn-when-a-resumed-agent-edits-files-and-skips-its-required-payload.md

- Task: 156-warn-when-a-resumed-agent-edits-files-and-skips-its-required-payload.md
- Written: 2026-11-06T17:30:43.280Z
- From session: manager-review-156

## Outcome

Task 156 is implemented but NOT committed (uncommitted working tree on `feat/manager-review-direction-check`, base `effb894`). The resumed-run silent miss from task 155 is fixed and repeated live: a resumed run that edits a file and skips its payload is now warned and shown by `handoff-issues`.

## Verified

- State verified: `effb894` plus the uncommitted working tree (no commit exists to name). Plugin 0.13.23, mirrors refreshed with `pnpm refresh:runtime`.
- Full suite green on that state, before the docs step: `pnpm verify` passed (lint, check, typecheck, test); `pnpm --filter maestro test` 136 files / 2673 tests; `parity.test.ts` 44 passed. The reviewer re-ran parity, 156, runtime-version-and-payload and 151 tests: 149 passed, lint and typecheck clean.
- Not re-run after the final docs-only edit (`.claude/skills/maestro-architecture/` SKILL.md, handoff-contract.md, and the AST json the scribe's extract+apply rewrote). Re-run `pnpm verify` before committing.

## Confirmed cause (a change from the ticket's order, accepted by manager m010)

Confirmed first by fixture (real installed hook and CLI scripts), then by the live repeat. The stop hook DID raise and record `missing_payload`. `handoff-issues` then dropped it: `dropResolvedMissingPayloads` matched lane files by session `run_id` only, so run 1's earlier-numbered `test.1.md` counted as proof the file was present. The run-boundary-misread suspect is ruled out for this shape. No decision from tasks 151 or 153 changed.

Fix: a lane file resolves a recorded `missing_payload` only if written at or after the issue's `ts` (1 s slack, same as the hook). Unreadable mtime or unparseable `ts` never resolves. `handoff-issues` and `maestro-resume-target.cjs` both pass `writtenAt`.

## Live repeat (resumed @test agent a787bb5d7646cd420, `test.1.md` already in the lane)

- Edited a file, wrote no payload: `NO PAYLOAD written for HANDOFF: success (agent_id a787bb5d7646cd420)`.
- Wrote next-numbered `test.2.md`: `Maestro handoffs: no problems recorded.`
- Re-verify only: `Maestro handoffs: no problems recorded.`

The quoted lines are `handoff-issues` output; the raw `log.jsonl` entries were not captured, so the criterion asking for log lines is met by the printed output only.

## Findings

- The first live warning was listed twice: `maestro-subagent-log.js` (~lines 394-405) pushes into `handoff_issues` with no dedup when the stop hook fires twice for one resumed run. Pre-existing, harmless to the verdict, not fixed here. Suggest a follow-up ticket (it uses `appendHandoffIssue`, which dedups, nowhere there).
- New regression coverage: describe "156" (3 cases) in `runtime-version-and-payload.test.ts`, which fails 1 of 3 with the fix reverted, plus the new untracked `apps/maestro/test/core/resume-delivery-156.test.ts` (10 tests, must be added to the commit).

## Suggested ticket changes

- Task 152 overlaps the hook script, generated libs and version file; it rebases after this PR merges and runs `pnpm refresh:runtime` (manager has added `maestro-resume-target.cjs` to the merge plan).
- Untracked `scribe-output/.refresh-skills.lock` is not part of this change; do not commit it. `.claude/maestro.json` is modified from before this task.
