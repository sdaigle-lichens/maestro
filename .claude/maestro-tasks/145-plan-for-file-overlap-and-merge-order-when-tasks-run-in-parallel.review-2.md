## Changed

- `plugins/maestro/scripts/maestro-write-tasks.cjs`: Prettier formatting only, no behaviour change.
- `apps/maestro/test/core/write-tasks-root.test.ts`: new tests (added by @test) for `touchedSurfaces` and for the orchestrator template's red-suite rule.

## Did

- @test: added the tests (13 of 13 pass in write-tasks-root, parity 44 of 44). `pnpm verify` failed at the Prettier check on `maestro-write-tasks.cjs`.
- @backend: ran Prettier on that file; `prettier --check plugins` now passes.

## Deviations from the ticket

- None new. `pnpm verify` has not yet been green on the combined result; @test re-runs it next.

## Corrections since the last round

- Round 1 approved the direction. The only correction is the formatting fix above.
- The `.claude/scripts/maestro-write-tasks.cjs` mirror is stale again after the Prettier run, so `! pnpm refresh:runtime` is needed before @test re-runs.
