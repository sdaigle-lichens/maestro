## Changed

- Hook logic: `apps/maestro/src/core/human-review-gate.ts` (new), exported via `plugin-entries/maestro-session.ts` into the `maestro-session` bundle
- Hook script: `plugins/maestro/scripts/maestro-human-review-gate.js` (new; copied into projects as `.cjs`)
- Registration: `plugins/maestro/hooks/hooks.json`, `apps/maestro/src/core/install.ts`, `plugins/maestro/scripts/maestro-install.js`, `.claude/settings.json`
- Task listing skips review files: `apps/maestro/src/core/tasks.ts`, `plugins/maestro/scripts/lib/maestro-tasks.cjs`
- Loop-back counter: `plugins/maestro/scripts/maestro-task-status.cjs` (`plan-step <label> pending` increments `plan.loopbacks`)
- Orchestrator template: `plugins/maestro/templates/maestro/SKILL.md`, re-synced into `.claude/skills/maestro/SKILL.md`
- Generated libs and tracked mirrors: `maestro-session`, `maestro-epic`, `maestro-tasks` under `plugins/maestro/scripts/lib/` and `.claude/scripts/lib/`, plus `.claude/scripts/maestro-task-status.cjs` and `maestro-human-review-gate.cjs`
- Tests: `apps/maestro/test/core/human-review-gate.test.ts` (11 tests)
- Plugin version 0.12.11 -> 0.13.0; `.claude/maestro.json` runtime version stamp updated by the install

## Did

- @backend: wrote the gate module, hook script, registrations, template text, loop-back counter, listing filter, version bump and gate tests; rebuilt the libs
- You (outside the sandbox): refreshed the `.claude/scripts` mirrors and re-synced the rendered orchestrator via `maestro-install.js`

## Deviations from the ticket

- Added a `plan.loopbacks` counter to `plan-step ... pending` so each loop-back round needs its own review file (`.review-2.md`, ...)
- Template Step 3 now says to always record the path with `plan`, `TaskCreate` or not, because the hook reads the plan to know the current step
- Task listings (`tasks.ts`, `maestro-tasks.cjs`) skip `*.review.md` / `*.review-N.md`, otherwise review files would show up as tasks
- The hook script stands down when the project registers the same hook (avoids double firing)
