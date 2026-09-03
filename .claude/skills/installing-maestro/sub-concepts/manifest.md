# The manifest

What an install writes, in two lists that both implementations mirror by hand:
`STATIC_ASSETS` + `handoffAssets()` (the files) and `HOOK_REGISTRATIONS` (the settings entries).

## Files — `runtimeAssets()`

Everything lands under `<project>/.claude/`. Four groups:

| Group                                               | Destination                        | Note                                                                                                          |
| --------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Scripts the orchestrator, a hook, or the app invokes | `.claude/scripts/*.cjs`           | `maestro-set-session-workflow`, `maestro-render-orchestrator`, `maestro-task-status`, `maestro-check-runtime` (`require`d by the `maestro-step0` hook), `maestro-agent-forks` (`031`) |
| Shared libs the copied scripts `require("./lib/…")` | `.claude/scripts/lib/*.cjs`        | `maestro-session`, `maestro-tasks`, `maestro-skill-regions`, `maestro-agent-sync` (`031`)                     |
| Hook scripts                                        | `.claude/scripts/*.cjs`            | **renamed from `.js`** — see below                                                                            |
| Handoff protocol templates                          | `.claude/templates/handoffs/**.md` | walked off disk, not enumerated                                                                               |

Plus `bash-validation.sh`, the one asset copied **executable** (`0o755`) because its hook runs it as
a bare command rather than through `node`.

**The `.js` → `.cjs` rename is load-bearing.** The five `HOOK_SCRIPTS`
(`maestro-inject-agent-context`, `maestro-subagent-log`, `maestro-session-log`,
`maestro-validate-tasks`, `maestro-step0`) keep `.js` in the plugin, whose directory has no `package.json` declaring
a module type. Inside a project the same file may sit under `"type": "module"`, which makes node
parse their `require()` as ESM and fail the hook **on every tool call**. Scripts already named
`.cjs` in the plugin are copied under their existing names. Add a hook script to the wrong list and
it breaks only in projects that happen to be ESM.

**`.claude/templates/handoffs/` is not `.claude/handoffs/`.** `maestro-inject-agent-context` looks
for `<project>/.claude/handoffs/<sender>/<receiver>.md` **first**, and falls back to
`<script dir>/../templates/handoffs/…` — which from the copied script is exactly the install
destination. So installing there needs no change to the script _and_ leaves the override location
free. Copying into the override would overwrite a customised protocol on every update.

**Both of `031`'s additions are `STATIC_ASSETS`, not `HOOK_SCRIPTS`** — they are already `.cjs` in
the plugin and are not hooks, so they are copied under their existing names with no rename. They are
what the fork check is made of: the `maestro-step0` hook `require`s `lib/maestro-agent-sync.cjs`
directly, and `maestro-agent-forks.cjs` is the user-facing CLI `/maestro-update` drives. Adding them
moved `shippedRuntimeId`, so every
already-installed project reports stale once and re-copies; see the staleness sub-concept.

**`maestro-session-cleanup.cjs`, not the plugin's `.sh` of the same name.** The two now do the same
thing — the `.sh`'s container teardown was removed with M5. The project copy is node because the
`.sh` shells out to `python3` to parse the hook payload, which a project cannot assume is installed.
It is also the one hook script with **no arbitration guard**: both copies just `rm -f` the same three
ephemeral files, so a double fire is unobservable (see the hook-arbitration sub-concept).

> `install.ts`'s asset-manifest comment (around line 155) still claims the `.sh` "also tears down
> the per-project web-app container". That is stale — flagged, not edited here.

## Hooks — `HOOK_REGISTRATIONS`

Nine entries, written into the project's `.claude/settings.json`, mirroring the plugin's
`hooks.json` one-for-one:

| Event                 | Matcher      | Script                             |
| --------------------- | ------------ | ---------------------------------- |
| `UserPromptExpansion` | `maestro`    | `maestro-step0.cjs`                |
| `PreToolUse`          | `Skill`      | `maestro-step0.cjs`                |
| `SubagentStart` | `.*`         | `maestro-inject-agent-context.cjs` |
| `SubagentStart` | `.*`         | `maestro-subagent-log.cjs`         |
| `SubagentStop`  | `.*`         | `maestro-subagent-log.cjs`         |
| `PreToolUse`    | `.*`         | `maestro-session-log.cjs`          |
| `PreToolUse`    | `Bash`       | `bash-validation.sh`               |
| `PostToolUse`   | `TaskCreate` | `maestro-validate-tasks.cjs`       |
| `SessionEnd`    | _(none)_     | `maestro-session-cleanup.cjs`      |

`id` is `<Event>:<script>`, unique because two scripts are registered on two events each
(`maestro-subagent-log` on SubagentStart/Stop, `maestro-step0` on the two entrances to the
orchestrator — a typed `/maestro`, and a `Skill` tool call). **`SubagentStop`
is included even though the plan lists four events** — without it the session log has dispatch
entries with no matching handoff and `/session-log` renders half a conversation.

Two properties of how they are written:

- **Idempotency keys on the basename**, not the exact command: users re-quote paths, and a second
  entry differing only by quoting fires the hook twice.
- **An existing entry for the same matcher is reused** rather than a second one added, so a user's
  own `Bash` hook and Maestro's live side by side under one matcher.

`bash-validation.sh`'s command is written **unquoted and un-prefixed**, byte-for-byte as the legacy
installer wrote it, because `maestro-uninstall.js` removes it by exact string match.

## The other two writes

**`.gitignore` at the repo root** (found via `git rev-parse --show-toplevel`) gets a `# Maestro`
section with three `**/.claude/maestro_session*` entries. The leading recursive wildcard matches
`.claude/` at **any** depth including the root, so a monorepo needs no per-package `.gitignore`.
Entries are appended only when missing, under a header added only when missing.

**`maestro.json` is seeded only when absent**, from `defaultV3Config(implAgents, skillMap)` — the
_same_ function the app seeds a fresh canvas with, so both paths produce a byte-identical starting
config. The app's version additionally intersects detected impl agents with the live Project Tags
catalog and derives the skill map from the global tag store; the terminal path takes those as
`--impl-agents`, `--skill-map` and `--project-tags` flags, which its skill fills in from a repo
analysis. **All three flags only affect a fresh seed.**

`runtimeVersion` is stamped **last**, after the files it describes are current on disk.

Files: `apps/maestro/src/core/install.ts` (`STATIC_ASSETS`, `HOOK_SCRIPTS`, `handoffAssets`,
`HOOK_REGISTRATIONS`), `plugins/maestro/scripts/maestro-install.js` (the mirror).
