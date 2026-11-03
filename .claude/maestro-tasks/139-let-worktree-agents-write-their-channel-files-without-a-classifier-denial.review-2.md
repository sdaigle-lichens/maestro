Round 2

# Review brief — task 139 (round 2)

Previous redirect note, each point followed by how it was addressed:
- "Correct the Findings' 'Second run' paragraph to say the rule was present." — Done: the paragraph now says the rule was in `settings.local.json`, the first-try write is consistent with the rule working, and one clean run is not proof (denial is intermittent).
- "Implement criteria 2-5 and 7: install/update merge `Write(/.claude/channels/**)` idempotently into the project's `.claude/settings.json`." — Done in both `apps/maestro/src/core/install.ts` and `plugins/maestro/scripts/maestro-install.js` (`maestro-update` re-runs the latter).
- "Guidance says Write not mkdir." — Done in `handoff-payload.ts` (`payloadRequirement`), the worktree block of `maestro-inject-agent-context.js`, and Step 3 of the orchestrator template.
- "The stale NO PAYLOAD fix for resumed agents." — Done in `maestro-task-status.cjs` via `dropResolvedMissingPayloads` (a `missing_payload` issue whose files are all stamped with this run's `run_id` is dropped).
- "Keep the orchestrator-writes-it fallback." — Kept in the template.
- "Tests, patch bump." — Version bumped 0.13.6 → 0.13.7. NO tests written yet: @test is the next step.
- "State in the channels developer skill that the denial was intermittent." — Done in `.claude/skills/maestro-architecture/sub-concepts/channels.md`.

## Goal
Make worktree agents' channel writes pass without a classifier denial by installing an allow rule, while keeping the orchestrator-writes-it fallback.

## Done
See the point-by-point list above. Libs regenerated with `build:plugin-libs`. typecheck, check and lint pass.

## Deviations
- Uninstall (not in the ticket): `uninstall.ts` / `maestro-uninstall.js` remove exactly the rule, and drop `permissions`/`allow` only if they emptied them. Otherwise a purge leaves a `settings.json` holding only our rule.
- `pnpm refresh:runtime` has not been run (agent cannot write those paths), so mirrors/STEPS are stale and 6 tests fail until the user runs it. One `install.test.ts` expectation needs updating (for @test).

## Decisions
- Portable form `Write(/.claude/channels/**)` (anchored to the project root of the settings file). It has not been exercised in a run.
- A malformed `permissions` or `allow` value is left untouched.

## Touches
`apps/maestro/src/core/{install,uninstall,handoff-payload,contracts}.ts`; `plugins/maestro/scripts/{maestro-install,maestro-uninstall,maestro-inject-agent-context}.js`, `maestro-task-status.cjs`, generated `lib/maestro-session.cjs`; `plugins/maestro/templates/maestro/SKILL.md`; the `maestro-install`/`maestro-update` skill docs; `plugin.json`; developer skills `channels.md`, `installing-maestro`, `manifest.md`.

## Sibling impact
Every project that installs or updates gets a `permissions.allow` entry in its `.claude/settings.json` (the one exception to "install writes no permissions"). Ticket 140 unaffected.

## Questions
- Is the uninstall change acceptable scope?
