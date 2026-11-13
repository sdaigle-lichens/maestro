## Goal
Worker image carries what the project's verify command and hooks need (pinned package manager, python3, the test browser), read from the project, with the git identity passed at launch. A containerized worker's `pnpm refresh:runtime` request says to run it on the host.

## Deviations
- Mirrors (`.claude/scripts`, rendered `.claude/skills/maestro/SKILL.md`) are not refreshed: the sandbox cannot write them. `pnpm refresh:runtime` is pending, so 5 parity tests are red until it runs.
- The real-Docker check is a script (`apps/maestro/scripts/check-worker-verify.sh`) and has not been run.
- Git identity needed no code: the CLI already passed `GIT_AUTHOR_*` / `GIT_COMMITTER_*` at launch; only tests were added.
- claude CLI: already in the image; the worker flow calls it only to start the session. Nothing added.

## Decisions
- Toolchain detected per project (`detectToolchain`): `packageManager` from package.json (sha suffix dropped), the browser named in a vitest config using playwright, `make` if `verify_command` names it.
- pnpm/yarn pinned through corepack, npm/bun through `npm install -g`; browser via `playwright install --with-deps` into `/ms-playwright`.
- Toolchain is part of the tag inputs; layout marker 4 -> 5.
- Refresh wording comes from `refreshRuntimeWords()`, used by `maestro-task-status.cjs` through the epic bundle.
- `maestro-session-cleanup.sh` prints a message on stderr when python3 is missing, still exits 0.

## Touches
- `worker-runtime.ts`, `plugin-entries/maestro-worker-runtime.ts`, `plugin-entries/maestro-epic.ts`, their generated libs
- `maestro-worker-runtime.cjs`, `maestro-task-status.cjs`, `maestro-session-cleanup.sh`
- template `SKILL.md` (one principle bullet), `land-the-task/SKILL.md` (step 5 note)
- `plugin.json` 0.15.10 -> 0.15.11
- tests: worker-runtime, epics-cli, manager-review-protocol, scaffold, `helpers/env.ts`

## Sibling impact
- Task 178 also bumps `plugin.json`; whichever lands second rebases.
- `pinnedEnv` in test helpers now drops `MAESTRO_WORKER_RUNTIME` unless set, affecting every test using it.

## Questions
- None.
