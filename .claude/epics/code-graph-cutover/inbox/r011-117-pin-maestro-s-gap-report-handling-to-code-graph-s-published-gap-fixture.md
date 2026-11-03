# Report r011: 117-pin-maestro-s-gap-report-handling-to-code-graph-s-published-gap-fixture.md

- Task: 117-pin-maestro-s-gap-report-handling-to-code-graph-s-published-gap-fixture.md
- Written: 2026-10-21T17:21:13.065Z
- From session: maestro-fbcb0f28

Outcome: done (clean session, Tests workflow: @test -> @reviewer -> @scribe, all HANDOFF: success).

Findings:
- Vendored code-graph 0.3.20 skill-gaps example + schema under apps/maestro/test/fixtures/ with a README naming source paths, version, and the re-copy rule.
- New block in test/core/scribe-gap-retention.test.ts runs the fixture through the real installed hooks: classified as gap report, renamed to <sender>.<n>.md at stamp, inlined to scribe, survives delivery, retired by SKILL_GAPS_HANDLED. Negative control (empty skill_gaps) retires on first delivery.
- New test/core/skill-gaps-contract.test.ts + test/helpers/skill-gaps-contract.ts: hand-written validator (no new dependency) confirms the backend/frontend/infra/mobile/test report defaults and the reviewer/refactor seeds match the schema. The scribe default has no gap example.
- Maestro's emitted examples already agree with the fixture: nothing under plugins/ changed, no version bump.
- Gates: pnpm --filter maestro test 2124 passed (111 files), lint and typecheck clean. Nothing committed.

Caveats: the fixtures pin only the vendored copy, so a code-graph contract change is caught only after re-copying. The validator covers required keys and string types only (not additionalProperties/minItems). The example regex in skill-gaps-contract.test.ts is coupled to the report-default wording and fails loudly if those notes are reformatted.

Post-mortem: none.
Suggested ticket changes: none.
