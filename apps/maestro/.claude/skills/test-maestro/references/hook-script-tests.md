# The other harness: `test/core/` tests that drive the installed hooks

Most of `apps/maestro/test/core/` is ordinary vitest against `src/core`, but a few files
(`per-session-state.test.ts`, `install.test.ts`, `uninstall.test.ts`) `spawnSync` the **real scripts
the installer copies into a temp project** — `<root>/.claude/scripts/<hook>.cjs`, fed the JSON
payload Claude Code would send on stdin — so nothing about the runtime is mocked. No window, no CDP;
the fixture-root rules in `SKILL.md` don't apply, because these projects are made and destroyed
under `os.tmpdir()`.

Three conventions keep them honest, and all three are about **not touching the developer's real
machine**:

- **Pin `HOME` at the test's own tmp dir** in every spawned hook's env. A hook reads `~/.claude`
  sqlite stores; an unpinned `HOME` reads (and can write) the developer's real ones.
- **Pass `REPORTS_DB` / `PROJECT_TAGS_DB` / `HANDOFFS_DB` to every `installRuntime()` call**, for
  the same reason on the install side.
- **Pin or delete `CLAUDE_CODE_SESSION_ID` — never inherit it.** This is the sharp one, and it only
  exists since `064`.

Since `082` two things enforce this for you: `test/setup-isolation.ts` (a vitest `setupFiles`
entry) points `HOME`/`USERPROFILE` at a temp dir and deletes `CLAUDE_CODE_SESSION_ID` before any
module computes an `os.homedir()` default, and `test/helpers/env.ts`'s `pinnedEnv(home, extra)`
builds a spawned process's env the same way. Use `pinnedEnv` rather than spreading `process.env`.
Without the setup file, the first-install seed in `installRuntime` read the developer's real
`~/.claude` and 24 install/uninstall/discovery tests failed in the sandbox.

**`pnpm verify` inside the Claude Code sandbox runs 0 tests** (`113`): every suite dies at import
on `ENOENT mkdir /tmp/<rand>/ssr`. Turbo's strict env mode strips `TMPDIR`, so vite falls back to
`/tmp`, which the sandbox denies. Run `TURBO_ENV_MODE=loose pnpm verify`, or
`pnpm --filter maestro test` directly; both pass `TMPDIR` through.

## The `CLAUDE_CODE_SESSION_ID` rule, because nothing about a green run reveals a violation

That variable is set in the environment of a real Claude Code session, and a hook spawned with
`{ ...process.env }` inherits it. A test that neither sets nor deletes it picks up **the developer's
own session id**: inside a session the hooks write into `<tmp project>/.claude/maestro_sessions/<the
dev's session>/`, and outside one they write nothing at all, because no id resolves. Either way the
assertions look somewhere the test did not choose, and the same test passes for different reasons —
or passes vacuously — depending on where it was run from. So the env helper always either sets the
variable to a pinned id or deletes it outright:

```ts
function hookEnv(root: string, sessionId: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: tmp };
  if (sessionId === null) delete env.CLAUDE_CODE_SESSION_ID; // the "no id resolves" arm
  else env.CLAUDE_CODE_SESSION_ID = sessionId;
  return env;
}
```

`null` is not "leave it alone" — it is the explicit no-id arm, which is a case worth testing
(every caller must degrade and still exit 0). Deleting is how you get it. The general rule behind
all three: **an ambient environment variable that changes where a spawned process writes must be
set or deleted by the test, never inherited.**

## A hook that leaves a detached process behind (`141`)

`spawnSync` covers one-shot hooks. `maestro-session-heartbeat` instead spawns a **detached,
long-lived** watcher and exits; `test/core/session-heartbeat-cli.test.ts` is the worked example.

- **Track and `SIGKILL` every detached pid in `afterEach`.** They are not children of the test, so
  nothing reaps them; a leaked one keeps writing into a later test's tmp project.
- **Kill a stand-in parent, then `await` its `'exit'`.** An unreaped zombie still passes
  `process.kill(pid, 0)`, so the watcher would think its parent alive.
- **Treat `/proc/<pid>/stat` state `Z` (or `X`) as dead** for reparented children the test cannot reap.
- **Poll with a deadline** (`until(label, fn, timeoutMs)`), never a fixed sleep.
- **Each sandboxed Bash call has its own PID namespace**: a leftover process cannot be inspected
  with `ps` from a later call, so clean up inside the test, not afterwards by hand.

## Testing channel scopes (`144`)

`test/core/channel-scope-collision.test.ts` is the worked example.

- **Claim through `maestro-set-session-workflow.cjs <workflow> --task <file>`**, not just
  `maestro-task-status.cjs claim`: only the former records `active_task`, so a bare claim leaves the
  session on `session-<id8>` and the test silently exercises the wrong scope.
- **A worktree session's `session.json` (and `run_id`) lives in the worktree's
  `.claude/maestro_sessions/<id>/`** (`074` pointer), while its hooks run with `CLAUDE_PROJECT_DIR`
  set to the main checkout. Read the run_id from the worktree root.
- **Session ids sharing their first 8 chars share a `session-<id8>` scope.** Give each fixture
  session a distinct 8-char prefix, or two "isolated" sessions collide by construction.
