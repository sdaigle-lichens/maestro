# Review — task 132, round 1

## Changed

- `apps/maestro/src/core/epics.ts`, `plugin-entries/maestro-epic.ts`, `plugin-entries/maestro-session.ts`: review-request / review-verdict logic, open requests in show/reports
- `apps/maestro/src/core/human-review-gate.ts`, `plugins/maestro/scripts/maestro-human-review-gate.js`: gate also covers `manager review` (AskUserQuestion and SendMessage to the epic's manager)
- `apps/maestro/src/core/install.ts`, `plugins/maestro/scripts/maestro-install.js`, `plugins/maestro/hooks/hooks.json`: gate matcher `AskUserQuestion|SendMessage`, plus migration of existing registrations
- `plugins/maestro/scripts/maestro-epic.cjs`, `plugins/maestro/scripts/lib/maestro-{epic,session}.cjs` (regenerated)
- `plugins/maestro/templates/maestro/SKILL.md`, `plugins/maestro/skills/maestro-manager/SKILL.md`: protocol text, approval-scope sentence
- `plugins/maestro/.claude-plugin/plugin.json`: 0.13.5
- New `apps/maestro/test/core/manager-review-protocol.test.ts`

## Did

- @backend: implemented review-request, review-verdict with the 2-redirect cap, the gate extension, both skill texts, regenerated the libs, bumped the version, added tests
- @frontend: confirmed no UI change is needed (canvas node and edge from task 131 already match); changed nothing

## Deviations from the ticket

- Added a second command, `review-verdict`, so that redirects are counted per ticket (the ticket only named `review-request`).
- The installers gained `updateHookMatchers` to move existing gate registrations onto the new matcher.
- Human-review round numbering now counts a passed `manager review` stop, so a human review after a manager review uses `.review-2.md`.
- Not done (sandbox): the `.claude/scripts/` mirrors, the re-rendered `.claude/skills/maestro/SKILL.md`, and the `.claude/settings.json` matcher. 4 tests (parity and orchestrator render) fail until the user runs the cp/render commands.
- The `maestro-architecture` developer skill is left for @scribe.
