## Changed

- New dev script `scripts/refresh-runtime.mjs`, wired as `pnpm refresh:runtime` in `package.json`
- `apps/maestro/test/helpers/mirror-parity.ts`, `apps/maestro/test/core/parity.test.ts`: failure messages name the one command; new parity block for the rendered orchestrator's STEPS/PRINCIPLES region
- New `apps/maestro/test/core/refresh-runtime-script.test.ts`
- Docs: `.claude/rules/plugin-publishing.md`, `.claude/skills/updating-maestro/SKILL.md`, `apps/maestro/.claude/skills/plugin-libs-parity/SKILL.md`, root `CLAUDE.md`
- `.claude/skills/installing-maestro/sub-concepts/manifest.md`: added the `PreToolUse` `AskUserQuestion|SendMessage` human-review gate row
- Nothing under `plugins/` changed, so no version bump

## Did

- @backend: wrote the script (build libs, then `maestro-install.js`, then `maestro-render-orchestrator.cjs`; fail-fast), the parity message and STEPS-parity changes, the script test (mocked runner) and the doc edits. `check`, `lint`, `typecheck` and the full maestro test run passed (2317 tests).

## Deviations from the ticket

- The `.claude/agents` files had no "what to hand the user" text, so the guidance went into the root `CLAUDE.md` and the plugin-publishing rule instead.
- Not changed: the `task-queue` skill's description of the `merge` hint, and the hint text printed by `maestro-task-status.cjs`. Both still tell the user to hand-copy libs. Fixing the hint means a plugin change and a patch version bump.
- `pnpm refresh:runtime` was never run end to end (idempotency unverified against the real repo). `pnpm verify` was not run as a whole.
