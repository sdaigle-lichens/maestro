# Direction brief — task 164

## Goal
The test→reviewer handoff must require the project's own format, lint and type checks and the reported tests to be run after the tester's last edit, and the report must name the tree it verified. Project-agnostic wording, no tool names.

## Deviations
- The ticket names `plugin-entries/maestro-handoff-defaults.ts` as the template's home. That file only re-exports; the template lives in `apps/maestro/src/core/handoff-seeds.ts`, so the edit is there.

## Decisions
- `commands_run` entries must include the project's own format, lint and type checks and the reported tests, each run AFTER the last edit. A later edit means re-running, never reporting an earlier run.
- New `verified_tree` field: the commit or the working tree state, plus confirmation that no file was edited after the runs.
- The previous body became `TEST_TO_REVIEWER_V4` and is the first entry in `PRIOR_SEEDS["test/reviewer"]`, so an unedited copy upgrades. Older prior seeds shifted one index; two existing tests updated for that.
- `plugin.json` 0.13.32 → 0.13.33 (patch).

## Touches
- `apps/maestro/src/core/handoff-seeds.ts`
- `apps/maestro/test/core/test-hints-155.test.ts` (new 164 test), `test-known-gaps.test.ts`
- `plugins/maestro/.claude-plugin/plugin.json`, generated `plugins/maestro/scripts/lib/*.cjs`, `.claude/scripts` mirrors (refreshed)

## Sibling impact
None found. Task 160 (background-work stops) stays out of scope and is untouched.

## Questions
None.
