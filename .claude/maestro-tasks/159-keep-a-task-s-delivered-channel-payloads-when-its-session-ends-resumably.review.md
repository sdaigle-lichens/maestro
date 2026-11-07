# Review: 159 keep a task's delivered channel payloads when its session ends resumably

Round 1. This task is in no epic, so the `manager review` stop runs as a human review, with this direction brief as its review file.

## Goal

A session that ends resumably (`prompt_input_exit`, `other`, `resume`) keeps its own scope's delivered payloads in `.consumed/`, subject only to the normal age cap. A final end (`clear`, `logout`) still deletes them outright.

## Deviations

- **The reproducing test is not in the suite yet.** @backend proved the loss with a throwaway script (`/tmp/claude-1000/repro-159.sh`, both twins × 5 reasons: all 3 resumable reasons lost the file before, all 10 cases correct after) and left the suite tests to @test, the next step.
- **Concept notes not updated yet.** The sandbox can't write `.claude/skills/`; `maestro-architecture/SKILL.md` and `sub-concepts/handoff-contract.md`, `channels.md`, `session-end-reasons.md` still say the own scope's `.consumed` is retired outright. Left for @scribe (or you, if it can't write there either).

## Decisions

- **`sweep` takes an optional `reason`.** The own scope's `.consumed/` is deleted outright only when `!isResumableEnd(reason)`, reusing task 077's rule from `session-paths.ts` rather than copying it.
- **No reason means a final end**, so any other caller of `sweep` behaves as before.
- Age-out of other scopes, the legacy unscoped layout, and "never touch another session's scope" are unchanged.

## Touches

- `apps/maestro/src/core/handoff-channels.ts` (`sweep` option, header comment)
- `plugins/maestro/scripts/maestro-session-cleanup.cjs` and `.sh` (both pass the payload reason)
- `plugins/maestro/scripts/lib/maestro-session.cjs` (rebuilt)
- `plugins/maestro/.claude-plugin/plugin.json` 0.13.26 → 0.13.27
- `.claude/scripts/` mirrors (refreshed by your `pnpm refresh:runtime`)

## Sibling impact

- Task 160 touches the same generated lib and `plugin.json`; merge order 158 → 159 → 160, 160 rebases and re-bumps.
- Task 158 is already committed on this branch, so no conflict here.

## Questions

None.

## Verified

- Commit: none. The work is uncommitted on top of `bf336f9`, so this result is for the working tree.
- `pnpm verify` (root): lint, check, typecheck and tests all pass; maestro 141 files, 2775 of 2775 tests.
- `test/core/parity.test.ts`: 44 of 44 after `pnpm refresh:runtime`.
