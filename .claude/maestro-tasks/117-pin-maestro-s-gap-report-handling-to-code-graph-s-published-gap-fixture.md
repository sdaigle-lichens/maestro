# Pin maestro's gap-report handling to code-graph's published gap fixture

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Merge review R7 (.claude/epics/code-graph-cutover/merge-review.md): only maestro tests the skill-gap format, so maestro and code-graph could drift apart without either noticing. code-graph 0.3.20 now publishes the contract at plugin/contracts/skill-gaps.example.json, with a JSON Schema beside it at plugin/contracts/skill-gaps.schema.json. The example body is {"skill_gaps":[{"skill":"<skill-id>","missing":"<text>"}]}. The schema requires a skill_gaps array whose items each have string skill and missing fields. code-graph's own gap-contract.test.ts pins its scribe and retrieval skill examples to that fixture.

Add maestro's half. Repos stay autonomous: maestro's tests must not read a code-graph checkout or the plugin cache. Vendor both files under apps/maestro/test/fixtures/ (for example code-graph-skill-gaps.example.json and .schema.json), with a short README or header note naming the source path and code-graph version (0.3.20) and saying to re-copy them when code-graph changes the contract.

The new test (or a block in an existing gap test such as handoff-channels.test.ts or scribe-gap-retention.test.ts) proves that maestro treats the fixture as a gap report end to end:
- a scribe-lane channel file holding the fixture in one fenced json block is classified as a gap report;
- it is renamed to <sender>.<n>.md at stamp;
- it is inlined to the scribe;
- it is not retired on delivery;
- a SKILL_GAPS_HANDLED line naming it retires it.
Also check that the gap example maestro itself emits (the skill_gaps note in report-defaults.ts, and any example in the scribe report default) validates against the vendored schema's rules (skill_gaps array, string skill and missing). A small hand-written check is enough; don't add a schema-validator dependency.

Test-only plus fixtures: no change under plugins/ and no version bump, unless the check finds maestro's own example disagrees with the fixture. In that case fix maestro's text, rebuild the libs and mirrors per the publishing rules, and bump the patch version.

## Acceptance criteria

- [ ] Both code-graph contract files are vendored under apps/maestro/test/fixtures/ with a note naming the source path and version 0.3.20.
- [ ] A test feeds the vendored example through maestro's channel handling and asserts gap-report classification, the <sender>.<n>.md rename, inlining to the scribe, survival past delivery, and retirement by SKILL_GAPS_HANDLED.
- [ ] A test asserts maestro's own emitted gap example satisfies the vendored schema's required fields and types, without a new dependency.
- [ ] No test reads outside the maestro repo (no code-graph checkout, no ~/.claude plugin cache).
- [ ] `pnpm --filter maestro test` passes. If plugins/ changed, the plugin version is bumped and the parity test passes.

## Blocked by

None — can start immediately
