Round 3

Previous redirect note (round 1), each point followed by how it was addressed. Round 2 returned on-track with a note for @reviewer, which goes into its dispatch.
- "Correct the Findings' 'Second run' paragraph." — Done.
- "Implement criteria 2-5 and 7 with the portable `Write(/.claude/channels/**)` form." — Done; installers, guidance, template, handoff-issues fix, plugin 0.13.6 → 0.13.7. Unchanged since round 2.
- "State in the channels developer skill that the denial was intermittent." — Done.

# Review brief — task 139 (round 3)

## Goal
Make worktree agents' channel writes pass without a classifier denial by installing an allow rule, keeping the orchestrator-writes-it fallback.

## Done
Since round 2 (on-track): `pnpm refresh:runtime` was run by the user in both checkouts, and parity passes (44/44). @test wrote the tests: `channel-allow-rule.test.ts` (merge and uninstall removal, TS core and plugin scripts), `handoff-issues-resolved.test.ts` (10 tests), and corrected one `install.test.ts` expectation. @test reported `pnpm verify` failing at prettier on `maestro-install.js` (one long line); @backend formatted it, no behaviour change. `pnpm verify` now passes: 126 files, 2373 tests passed, 5 skipped.

## Deviations
None new since round 2 (the uninstall change was accepted as in scope). Test gaps @test flagged: no test exercises Claude Code's real permission engine or the classifier, and no negative control (revert the product code and see the tests fail) was run.

## Decisions
Formatting-only fix; no other product code changed in this round.

## Touches
`plugins/maestro/scripts/maestro-install.js` (format only), plus the new and edited tests under `apps/maestro/test/core/`.

## Sibling impact
None beyond round 2.

## Questions
None.
