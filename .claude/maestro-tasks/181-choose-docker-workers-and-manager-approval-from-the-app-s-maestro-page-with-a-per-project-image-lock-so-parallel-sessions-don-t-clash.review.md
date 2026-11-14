## Goal

Let the user pick the worker runtime (Host or Docker) and manager approval from the app's /maestro page, serialize image build and prune per project with a lock, and record each worker's settings at launch so the approval gate ignores later changes.

## Deviations

- The launcher spawn moved into a new core module `worker-launcher.ts` (added to the isolation allow-list), so the main process can run build and prune.
- Settings are a new `worker-runtime` slice (`worker_runtime`, `manager_approval`), merged like `worker_model`.
- No renderer component tests: the repo has no component or DOM harness.
- No test runs a real Docker daemon, the `main/ipc.ts` handlers or the spawn in `worker-launcher.ts`.

## Decisions

- Lock: mkdir-based, per project, under `~/.config/maestro/locks`, outside the repo and every container mount. A dead holder's lock is recovered. `prune --dry-run` does not take it.
- Readiness: the daemon probe is injected. The token file is checked with stat only and never read.
- Recorded settings: `runtime` and `manager_approval` go into the epic's `state.json` per worker at launch, first write wins. The gate and the epic CLI read the recorded value and fall back to live config only when none exists.
- IPC channels: `data:worker-runtime`, `project:worker-runtime:set`, `data:worker-readiness`, `project:worker-image:rebuild`, `project:worker-image:prune-dry-run`.

## Touches

- Core: `config.ts`, `contracts.ts`, `epics.ts`, `human-review-gate.ts`, `index.ts`, `types.ts`, new `worker-launcher.ts`, `worker-lock.ts`, `worker-readiness.ts`.
- Plugin entries: `maestro-epic.ts`, `maestro-worker-runtime.ts`, with regenerated libs (`maestro-epic`, `maestro-rule-move`, `maestro-worker-runtime`) and the plugin scripts.
- Shell: `main/ipc.ts`, `preload/index.ts`, `shared/ipc.ts`.
- Renderer: new `WorkerRuntimeCard` in `routes/maestro.tsx`.
- Docs and version: `maestro-manager/SKILL.md` (when settings take effect), `plugin.json` patch bump to 0.15.14.
- Tests: new `worker-settings.test.ts`, `isolation.test.ts`.

## Sibling impact

- Task 178 may also bump `plugin.json`; whichever lands second rebases.
- `.claude/scripts` mirrors are stale until the user runs `pnpm refresh:runtime`. Only the two `parity.test.ts` mirror tests are red until then.

## Questions

None.
