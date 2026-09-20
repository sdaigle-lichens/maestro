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
