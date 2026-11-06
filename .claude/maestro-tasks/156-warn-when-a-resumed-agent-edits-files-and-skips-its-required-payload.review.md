# Manager review: task 156, round 1

## Goal
A resumed run that edits files and skips its required payload must raise a missing-payload warning
that `handoff-issues` shows. A resumed run writing its next-numbered payload, and a re-verify-only
resumed run, still raise none. First-run behaviour unchanged.

## Deviations
- The cause was confirmed with a fixture built from the live shape (real installed hook and CLI
  scripts), not with a live run plus debug logging. The live repeat is still to be done at the test
  step, after `pnpm refresh:runtime`.
- Cause: suspect (a). The stop hook DOES raise and record `missing_payload` (the run-boundary suspect
  is ruled out for this shape). `handoff-issues` then drops it because `dropResolvedMissingPayloads`
  matches files only by session `run_id`, so run 1's earlier-numbered payload counts as proof the
  missing file exists.

## Decisions
- `dropResolvedMissingPayloads(issues, present, writtenAt?)` resolves an issue only with a file
  written at or after the issue's `ts` (1 s slack, same as the hook). Unreadable mtime or unparseable
  `ts` never resolves. Without `writtenAt`, behaviour is as before.
- No decision from tasks 151 or 153 changes: the hook, run boundary and numbering rules are untouched.
- Plugin version bumped 0.13.22 -> 0.13.23 (patch).

## Touches
- `apps/maestro/src/core/resume-delivery.ts`, `src/core/plugin-entries/maestro-session.ts`
  (new exported `channelFileMtime`)
- `plugins/maestro/scripts/maestro-task-status.cjs`, `maestro-resume-target.cjs` (pass `writtenAt`),
  generated `scripts/lib/maestro-session.cjs`, `plugin.json`
- `apps/maestro/test/core/runtime-version-and-payload.test.ts` (describe "156", three cases)

## Sibling impact
- Task 152 overlaps the generated libs and the version file; it rebases after this epic's PR merges.
- `maestro-resume-target.cjs` shares the same resolution, so it now also ignores older files.

## Questions
- Is a fixture-confirmed cause plus r020's live log acceptable as the "confirmed cause" evidence,
  with the live repeat as the final check?
