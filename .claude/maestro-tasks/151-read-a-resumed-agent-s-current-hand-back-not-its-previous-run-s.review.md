# Review: task 151 (direction brief)

## Goal
The SubagentStop hook judges only a hand-back made during the current run of a resumed agent, and keeps waiting while the transcript is behind. No older run's message is ever used.

## Deviations
- Cause confirmed by test, not a live resume: a resumed transcript (old hand-back, resume prompt, no new hand-back) returned the old text at once. That matches the ticket's guess.
- The hook script needed no change; it already treats a null result as "no hand-back".
- Resumed-agent hook tests use the `test` agent, not a reviewer, because the test fixture config has no reviewer node. The FAIL route and payload rule are the same.

## Decisions
- Run boundary = the last user entry that is not purely `tool_result` blocks (the user chose this over a SubagentStart baseline).
- No signature changes: `awaitHandback`, `handbackHandoff` and `hasHandbackCall` all go through `scanHandbacks`.
- Plugin bumped to 0.13.21 (patch).

## Touches
- apps/maestro/src/core/handoff-label.ts (`scanHandbacks`)
- apps/maestro/test/core/runtime-version-and-payload.test.ts
- plugins/maestro/scripts/lib/maestro-session.cjs (generated)
- plugins/maestro/.claude-plugin/plugin.json
- .claude/skills/maestro-architecture/sub-concepts/handoff-contract.md and hooks.md

## Sibling impact
None known. `.claude/scripts` mirrors are stale until `pnpm refresh:runtime`, so `parity.test.ts` fails until the user runs it.

## Questions
None.
