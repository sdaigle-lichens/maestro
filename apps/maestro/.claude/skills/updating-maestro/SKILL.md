---
name: updating-maestro
description: "How a change to Maestro's runtime actually reaches a project — there are now two delivery paths with different failure modes. Hooks registered project-locally (by the desktop app's /maestro route or /maestro-install) run from copies in <project>/.claude/scripts/ and are stale until someone re-installs. Hooks registered by the maestro plugin run from a per-VERSION marketplace cache that autoUpdate only re-pulls when plugin.json `version` changes, so any edit to hooks/ or scripts/ shipped without a version bump is invisible. Use when a hook or script change isn't taking effect in another project, a SubagentStart/PreToolUse hook 'isn't firing', both copies seem to be firing at once, or before shipping any plugin change."
---

# Getting a Maestro runtime change to actually land

There are **two** ways a project ends up with Maestro's hooks, they have different staleness
rules, and the first thing to establish is which one you are looking at.

```
project-local (preferred)                     plugin-global (legacy / no-install)
  <project>/.claude/settings.json                ~/.claude/plugins/cache/maestro/
    hooks → $CLAUDE_PROJECT_DIR/                    maestro/<version>/hooks/hooks.json
            .claude/scripts/*.cjs                 scripts run from that cache dir
  written by: the desktop app's /install,        written by: installing the plugin
              or /maestro-install
  refreshed by: re-running either                refreshed by: a plugin.json VERSION bump
```

`InstallStatus.pluginHooksActive` (the app's `/maestro` route) tells you when **both** are live.
That is a real bug, not a redundancy: every tool call gets logged twice and every subagent gets its
context injected twice. The app reports it rather than fixing it, because the fix is in the user's
global configuration and the app does not write there.

## Path 1 — project-local copies

`installRuntime()` (desktop app) and `maestro-install.js` (terminal) both **copy** scripts into
`<project>/.claude/scripts/` and register them in the project's own `settings.json`. That is why
this path exists at all: `${CLAUDE_PLUGIN_ROOT}` resolves into the version-keyed cache below, so
runtime fixes shipped without a version bump never reached an installed project.

The trade is that a copy is a snapshot. A project picks up a newer runtime only when someone
re-runs the install:

- desktop app → `/maestro` route → **Update** (the badge is driven by
  `installedRuntimeId` vs `shippedRuntimeId`, both sha-256 over the runtime manifest — **content,
  never mtime**, because a `git clone` rewrites every mtime and an mtime comparison would report a
  fresh checkout as stale),
- terminal → `/maestro-update`, which re-copies the scripts and then re-renders the orchestrator.

**Copied scripts are `.cjs`, never `.js`.** The plugin can run them as `.js` because its directory
has no `package.json` declaring a module type; a project's does, and `"type": "module"` makes node
parse their `require()` as ESM — the hook then fails on _every tool call_ with "require is not
defined in ES module scope".

## Path 2 — the plugin's own hooks, and the version trap

The `maestro` marketplace installs the plugin into a **per-version cache** at
`~/.claude/plugins/cache/maestro/maestro/<version>/`. `autoUpdate` compares the cached
version against `plugin.json` `version` — **if the version string is unchanged, nothing is
re-pulled, even for a `directory`-source marketplace pointed straight at this repo.**

So every edit to `hooks/`, `scripts/`, `agents/`, `skills/` or `templates/` that ships **without a
version bump is invisible to every project running the plugin's hooks.**

### Why it's easy to miss

Skills and commands are copied into the same cache, so a stale cache **still resolves skills
normally** — `/maestro-install`, `/create-skill` all work. But a snapshot taken before `hooks/` and
`scripts/` existed has no `hooks/hooks.json` and no hook scripts at all, so `SubagentStart` (skill
injection + handoff routing), `PreToolUse`/`SubagentStop` logging, and the `TaskCreate` validator
**silently never fire** — no error, the files just aren't there. Meanwhile `bash-validation.sh`
keeps working, because the installer copies _that one into the project_. That asymmetry is what
makes the failure look random: one Maestro hook works, the rest don't.

This exact gap froze `lichens-ordonnancement-ui` at a May-2026 snapshot — the plugin had been edited
dozens of times, but `version` stayed `0.1.0`, so autoUpdate never re-pulled.

### The rule

**Any change under `plugins/<plugin>/` must bump that plugin's `plugin.json` `version`.** That is
the only signal autoUpdate watches.

1. Bump `plugins/<plugin>/.claude-plugin/plugin.json` `version`. The repo `marketplace.json` reads
   each plugin's version from its own `plugin.json` — nothing to update there.
2. Commit **and push** — the gate only helps teammates once the new version is in the repo they pull.
3. Refresh locally: `/plugin` → update, or clear the stale cache dir and restart Claude Code:
   ```bash
   rm -rf ~/.claude/plugins/cache/maestro/<plugin>/<old-version>
   ```

### Verify the refresh landed

```bash
P=~/.claude/plugins/cache/maestro/maestro/<new-version>
ls "$P/hooks/hooks.json"                          # exists
ls "$P/scripts/maestro-inject-agent-context.js"   # exists
```

Then `/hooks` should list **SubagentStart → maestro-inject-agent-context.js**.

## Generated files that need a build, not just an edit

`scripts/lib/maestro-session.cjs`, `scripts/lib/maestro-skill-regions.cjs` and
`scripts/lib/maestro-seed.cjs` are **generated** from `apps/maestro/src/core/plugin-entries/` by
`pnpm --filter maestro build:plugin-libs`. Editing the `.cjs` directly is overwritten on
the next build; edit the TypeScript source and rebuild. They are committed because a project
installs them by file copy, so they must exist in the repo.

## Diagnosing "my hook/script change isn't taking effect"

| Check                                     | Command                                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Which path is this project on?            | `cat <project>/.claude/settings.json` — Maestro hooks present ⇒ project-local; absent ⇒ plugin-global |
| Project-local and stale?                  | the `/maestro` route's badge, or just re-run `/maestro-update`                                        |
| What plugin version is installed?         | `cat ~/.claude/plugins/installed_plugins.json` (`installPath` + `version` + `installedAt`)            |
| Does the cached copy even have the files? | `ls ~/.claude/plugins/cache/maestro/<plugin>/<version>/{hooks,scripts}`                  |
| Is the cache older than the change?       | compare `installedAt` / dir mtime against the commit that added the file                              |
| Everything logged twice?                  | both paths are registered — see `pluginHooksActive` above                                             |

If skills work but `hooks/`/`scripts/` are absent from the cache → **stale cache, version was never
bumped.**

## Related

- `[[maestro-architecture]]` — what those hooks and scripts do at runtime once they are present.
- `/maestro-update` refreshes the project copies from the **currently installed plugin** — so if the
  plugin cache itself is stale, it faithfully propagates the stale copy. Fix the cache first.
