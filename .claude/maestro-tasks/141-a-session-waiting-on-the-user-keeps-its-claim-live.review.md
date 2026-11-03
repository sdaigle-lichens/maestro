Manager review run as a human review: task 141 is not in an epic.

## Changed

- `apps/maestro/src/core/session-heartbeat.ts` (new): `heartbeatTick` (pure), interval with env override, per-tick target resolution, pid-file writer, `/proc` process probes with pid-reuse detection by start time, pure `parsePsLine`.
- `apps/maestro/src/core/claims.ts` and its hand-written twin `plugins/maestro/scripts/maestro-task-status.cjs`: `isSessionLive` checks the session dir, then the `heartbeat` file if present (within 3 min = live, stale = dead even with a fresh log). It falls back to the 15-min `log.jsonl` rule when there is no heartbeat.
- `handoff-channels.ts`: `HEARTBEAT_INTERVAL_MS` (60 s), `HEARTBEAT_STALE_MS` (3 min) and the env override name. `session-paths.ts`: the `heartbeat` and `heartbeat.pid` file names.
- `plugins/maestro/scripts/maestro-session-heartbeat.js` (new): a SessionStart hook. It spawns a detached watcher of the claude process and returns in about 100 ms.
- Registration: `plugins/maestro/hooks/hooks.json`, `apps/maestro/src/core/install.ts`, `plugins/maestro/scripts/maestro-install.js` (uninstall reads the same lists).
- Rebuilt `lib/maestro-session.cjs` and `lib/maestro-epic.cjs`; `session-sweep.ts` comment only; `plugin.json` 0.13.7 → 0.13.8.

## Did

- @backend: built the above. Proved live that the detached child survives the hook, also when wrapped in a non-exec bash. It touches `heartbeat` every interval; after `kill -9` of the parent it zeroes `heartbeat` and exits. Through the CLI, a zeroed holder lets another session claim at once; a fresh heartbeat with no log refuses.

## Deviations from the ticket

- Heartbeat paths are built from constants rather than added to `sessionPathsFor` (that would break an existing `toEqual` in `session-paths.test.ts`).
- The `ps` fallback lives in the hook script; core reads `/proc` only. Spawning from core broke `isolation.test.ts` and `claude.test.ts`'s "spawns nothing" check.
- The hook skips a wrapping shell when choosing the process to watch (a project-local command string may run through a shell).
- A stop while claude still runs is re-checked once after 2 s (a worktree move caught mid-copy briefly looks like a missing dir).
- A missing `heartbeat.pid` counts as "still mine", not as a takeover.

## Open before @test

- The user runs `! pnpm refresh:runtime`. Until then the `parity.test.ts` mirror checks and `worktree-merge.test.ts`'s copy check fail.
- One flaky failure: `claude.test.ts` "cancels a running invocation" failed in the full run; the file passes 27/27 alone.
- No tests written yet (@test is next).
