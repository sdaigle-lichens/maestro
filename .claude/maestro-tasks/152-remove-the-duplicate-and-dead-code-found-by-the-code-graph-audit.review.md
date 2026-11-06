# Review: task 152 (round 1, direction brief)

## Goal
Remove the duplicate and dead code found by the code-graph audit, keep behaviour the same, and fix the one duplicate `missing_payload` warning.

## Changed
- `apps/maestro/src/core/global-handoff.ts` (new), `plugin-entries/maestro-session.ts`, `tasks.ts`, `session-title.ts`, `session-sweep.ts`, `session-log.ts`, `index.ts`
- `apps/maestro/.claude/skills/log-view/SKILL.md`
- `apps/maestro/test/core/runtime-version-and-payload.test.ts` (new test), `test/core/install.test.ts` (one assertion)
- `plugins/maestro/scripts/maestro-inject-agent-context.js`, `maestro-subagent-log.js`, `maestro-resume-target.cjs`
- `plugins/maestro/scripts/lib/maestro-tasks.cjs` (hand-kept twin); `maestro-session.cjs` and `maestro-epic.cjs` (generated)
- `plugins/maestro/.claude-plugin/plugin.json` (0.13.23 to 0.13.24) and the `.claude/scripts` mirrors from the runtime refresh

## Did
- @backend: all six items. One `readGlobalHandoff` in the session lib, a shared `sectionOf` in tasks.ts and the twin, `SessionTitleRef` dropped for `SessionRef`, `readSessionLog` removed, `resolveOptions` and `removeSessionDirs` in session-sweep.ts, and `appendHandoffIssue` in the subagent-log hook.

## Deviations from the ticket
- `readGlobalHandoff` now lives in the generated session lib. The three hooks import it from there, and it lazy-requires the handoff-defaults lib through a variable, so a missing lib still gives null and `node:sqlite` is not bundled into the session lib.
- `install.test.ts` changed. Its scan for a literal `require` of the handoff-defaults lib can no longer see it, so it now asserts the manifest copies that lib.
- `parseBlockedBy` and `extractPostMortemSection` did match; the twin has no `extractPostMortemSection`, so only the section cut and `parseBlockedBy` changed there.

## Decisions
- Both idle caps are kept: sweeping uses `SESSION_SWEEP_IDLE_CAP_MS`, deleting and listing use `SESSION_DELETE_IDLE_CAP_MS`.
- `tailSessionLog` and its tests, `taskHeading` and `parseTitle` are untouched.

## Sibling impact
Installed projects pick up the new session lib and hook scripts through the version bump. No other task is affected.

## Questions
None.

## Verified
Verified on top of commit d5ed7a8 with the work uncommitted, after `pnpm refresh:runtime`: `pnpm --filter maestro test` gives 136 files and 2674 tests, all passing; `test/core/parity.test.ts` passes (44 tests). Lint, check and typecheck passed in @backend's run before the refresh. The test, reviewer and scribe steps are still to come.
