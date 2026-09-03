# Hook arbitration — which copy of a hook runs

Two delivery paths register the same hooks (`updating-maestro` draws them). A project installed by
`installRuntime()` or `maestro-install.js` registers them in its own `.claude/settings.json`
pointing at `$CLAUDE_PROJECT_DIR/.claude/scripts/`; the plugin registers them globally from
`hooks.json` pointing into the version-keyed marketplace cache. With both installed **every hook
used to fire twice** — every tool call logged twice, every subagent's context injected twice, and,
because the two copies are independently versioned snapshots, sometimes from two *different*
runtime versions.

It is now arbitrated at runtime, in `apps/maestro/src/core/hook-arbitration.ts`, whose header
carries the full reasoning. The rule:

> **The plugin's copy of a hook stands down when the project registers that same hook itself.**

Project-local wins because it is the copy the user can see, refresh and commit. The arbitration
lives in scripts this repo owns rather than in the user's global configuration, which the app still
never writes.

## The surface

| Export | What it answers |
| --- | --- |
| `settingsRegisterScript(settings, event, script)` | Is this script registered on this event here? Keyed on the **basename appearing anywhere in a command string**, so re-quoted paths still match. |
| `projectTwinName(scriptPath)` | The project-local twin of a plugin script: same stem, always `.cjs` (so `maestro-session-cleanup.sh` → `.cjs`). |
| `projectOwnsHook(scriptPath, cwd, event?)` | The guard the plugin's hook scripts call. |

`install.ts`'s `hasHook()` delegates to `settingsRegisterScript`, deliberately: the installer's
idempotency test and the runtime guard must never disagree about what "registered" means. Two
answers to that question would put the two mechanisms at odds. `install.ts` also re-exports
`Settings` / `HookEntry` / `HookCommand`, which now live here.

`projectOwnsHook` returns **false immediately when it is running as the project's own copy**
(`path.dirname(scriptPath)` resolves to `<cwd>/.claude/scripts`). That check is what lets one source
file serve as both the plugin's script and the copy installed into a project. Otherwise it reads
`<cwd>/.claude/settings.json` **and** `settings.local.json` — the user's untracked tier, which the
installer never writes but into which a user may have moved our hooks — and returns true iff the
twin is registered on that event. An absent or unparseable settings file means nothing project-local
is running, so the plugin's copy should.

## Three decisions, each with a failure mode behind it

- **Keyed on the registration, never on the twin file existing.** Plain `/maestro-uninstall` removes
  the registrations and deliberately **leaves `.claude/scripts/` on disk** (only `--purge` deletes
  them). A file-existence test would then suppress the plugin's hooks in favour of hooks nobody
  runs — Maestro off entirely instead of falling back. There is an explicit test for this.
- **Precedence is per hook, not per project.** A partial install still gets the plugin covering the
  registrations the project is missing, so an incomplete install degrades to "everything runs"
  rather than "one hook silently never fires".
- **Nothing is suppressed for a project with no local install.** That is the case the plugin's
  global hooks exist to serve, and it is untouched.

## Where the guard is called

The five plugin hook scripts — `maestro-session-log.js`, `maestro-subagent-log.js`,
`maestro-validate-tasks.js`, `maestro-inject-agent-context.js`, `maestro-step0.js` — each call
`projectOwnsHook(__filename, cwd, p.hook_event_name)` right after resolving `cwd`, and `exit 0` when
it is true. `projectOwnsHook` reaches them through the `maestro-session.cjs` bundle
(`plugin-entries/maestro-session.ts`), so a change to it needs `pnpm --filter maestro
build:plugin-libs` — see `plugin-libs-parity`.

**`maestro-session-cleanup.sh` has no guard, on purpose.** Its project twin is `.cjs` and both just
`rm -f` the same three ephemeral files, so a double fire is unobservable. A third implementation of
the arbitration written in bash, to suppress a no-op, is worse than the no-op.

## Symlinks, and why the comparison is `realpath`

"Am I the project's own copy?" is `samePath(dirname(__filename), <cwd>/.claude/scripts)`, and
`path.resolve` alone is not enough. A hook payload's `cwd` is the path the session was opened at
(`/tmp/p`, `/var/folders/…` on macOS) while `__filename` inside the running script is already the
real one (`/private/tmp/p`). On any project reached through a symlinked ancestor the project's own
copy fails to recognise itself, decides the project owns the hook and stands down — and the
plugin's copy stands down for the same registration, so **the hook then runs nowhere at all**: no
error, no output, nothing in the log. Both sides are `realpathSync`'d, each falling back to
`resolve` for a path that does not exist.

## The bootstrap trap

The guard lives in the plugin's copy of the scripts, which sits in the **version-keyed cache**. It
reaches a machine only on a `plugin.json` version bump and re-pull — so the fix for the version trap
is itself subject to the version trap, and an existing stale install keeps double-firing until it
re-pulls. This is why the change shipped with `plugins/maestro/.claude-plugin/plugin.json` at
`0.3.3`. See `updating-maestro`.

## Tests

`apps/maestro/test/core/hook-arbitration.test.ts` covers the predicates in isolation. The four
end-to-end cases in `test/core/install.test.ts` run the **real** `plugins/maestro/scripts/*.js`
against a real install: the plugin stands down for an installed project (and the project's own copy
then logs exactly once), still runs for a Maestro project with no local install, runs again after a
non-purging uninstall, and its `SubagentStart` injection emits nothing while the project's copy still
emits its HANDOFF block.
