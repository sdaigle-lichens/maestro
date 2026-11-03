# Review: task 148

## Changed

- `plugins/maestro/agents/test.md`, `scribe.md`: `model: claude-haiku-5-5` in frontmatter (no other shipped agent has a model line)
- `apps/maestro/src/core/report-defaults.ts`: stricter test, scribe and backend report seeds, project-neutral; the old bodies are appended to `PRIOR_SEEDS`
- `apps/maestro/src/core/handoff-seeds.ts`: test/reviewer handoff gains `commands_run`, `negative_control`, `real_path_exercised`; the old body is a prior seed
- Tests: `report-defaults.test.ts`, `handoffs.test.ts`, `agent-fork.test.ts`
- `plugins/maestro/.claude-plugin/plugin.json`: 0.13.14 → 0.13.15
- Generated libs and mirrors (`plugins/maestro/scripts/lib/*`, `.claude/scripts/lib/*`) and `.claude/maestro.json` `runtimeVersion` refreshed via `pnpm refresh:runtime`
- 15 files modified, none committed

## Did

- @backend: made all of the above and added tests. `agent-sync.ts` and `agent-fork.ts` needed no change, because `mergeForkBody` takes the template frontmatter and carries over only `name:` and `description:`, so `model:` survives.

## Deviations from the ticket

- None in scope. One existing assertion changed: the scribe 114 test no longer requires the new body to start with the old one.
- A fork customised to a different model takes the template's model when it syncs (a consequence of `mergeForkBody`, not changed).

## Verified

- The working tree on top of HEAD 2b8a05f, uncommitted.
- The full unit suite passed (134 files, 2605 tests), including `test/core/parity.test.ts` (44/44) after `pnpm refresh:runtime`.
- @backend reported typecheck, lint and prettier check passing before the refresh. @test will re-run them.
