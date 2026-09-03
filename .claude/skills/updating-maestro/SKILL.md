---
name: updating-maestro
description: "How a change to Maestro's runtime actually reaches a project — there are now two delivery paths with different failure modes. Hooks registered project-locally (by the desktop app's /maestro route or /maestro-install) run from copies in <project>/.claude/scripts/ and are stale until someone re-installs. Hooks registered by the maestro plugin run from a per-VERSION marketplace cache that autoUpdate only re-pulls when plugin.json `version` changes, so any edit to hooks/ or scripts/ shipped without a version bump is invisible. Use when a hook or script change isn't taking effect in another project, a SubagentStart/PreToolUse hook 'isn't firing', both copies seem to be firing at once, or before shipping any plugin change. Also carries which component of the version to bump (major/minor/patch, and why nothing reads its magnitude), and why both copies firing at once is now arbitrated rather than warned about, and which path wins."
metadata:
  type: concept-skill
  version: "1.1"
  last-update: 0b88ea57965d2eab2bf633c053cfdb606382af3e
---

# Getting a Maestro runtime change to actually land

There are **two** ways a project ends up with Maestro's hooks, they have different staleness
rules, and the first thing to establish is which one you are looking at.

```
project-local (wins per hook)                 plugin-global (fallback / no-install)
  <project>/.claude/settings.json                ~/.claude/plugins/cache/maestro/
    hooks → $CLAUDE_PROJECT_DIR/                    maestro/<version>/hooks/hooks.json
            .claude/scripts/*.cjs                 scripts run from that cache dir
  written by: the desktop app's /install,        written by: installing the plugin
              or /maestro-install
  refreshed by: re-running either                refreshed by: a plugin.json VERSION bump
```

**Both being live is no longer a bug — it is a precedence rule.** The plugin's copy of a hook
stands down when the project registers that same hook itself, arbitrated at runtime by
`projectOwnsHook` in `apps/maestro/src/core/hook-arbitration.ts` and called by each of the four
plugin hook scripts. So the left column wins per hook, the right column covers any hook the project
did not register, and neither the app nor this repo touches the user's global configuration to make
that happen. `InstallStatus.pluginHooksActive` and its warnings are gone.

**The guard reaches a machine only through path 2's version bump**, because it lives in the plugin's
copy of the scripts. It shipped in `plugin.json` `0.3.3`; a project still on an older cached version
keeps double-firing until it re-pulls. The fix for the version trap is itself subject to the version
trap.

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

### Which component to bump

The rule above says a change must bump the version. This says by how much — because nothing else
did, and the question came up the first time somebody had to answer it.

**Nothing reads the magnitude.** autoUpdate compares the cached version string against
`plugin.json`'s for *inequality* only, so `0.3.2 → 0.3.3` re-pulls exactly as `0.3.2 → 0.4.0` does.
There is never a delivery reason to inflate a bump. The component is free to be honest, and the
thing it should be honest about is **the plugin's published surface** — what a consumer of the
plugin can name and call:

| Bump | When | Because |
| --- | --- | --- |
| **major** | The published surface **breaks**: a skill, agent or command removed or renamed; a hook event dropped; a config file's shape changed incompatibly. | Someone's `/command` or `@agent` stops resolving, or their config stops loading. Not used yet — the plugin is still `0.x`. |
| **minor** | The published surface **grows**: a new skill, agent, command, or a hook registered on a new event. | There is something new to invoke that was not there before. |
| **patch** | Everything else: the behaviour of existing scripts, bug fixes, prose edits inside a skill, and bumps that exist only to force a re-pull. | The same surface, doing what it already claimed to do — only correctly, or better. |

**A `feat:` commit is not automatically a minor.** The repo's own history is the guide: `0.2.0` was
new skills, `0.3.0` was new script behaviour plus a new state file — but `0.3.1` (concept-skills
system), `0.3.2` (agent page) and `0.2.1` (a bare re-pull trigger) are all patches, and two of the
three landed under a `feat:` subject. The commit message describes the work; the version component
describes what a *consumer* of the plugin sees change.

`0.3.3` — hook arbitration — is the worked example. It changed the behaviour of four existing hook
scripts and nothing about the surface: same skills, same agents, same six hook registrations. Patch.
It was first shipped as `0.4.0`, which is the mistake this section exists to stop repeating.

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
| Everything logged twice?                  | the cached plugin version predates `0.3.3` — it has no arbitration guard. Bump/re-pull (above)        |

If skills work but `hooks/`/`scripts/` are absent from the cache → **stale cache, version was never
bumped.**

## Related

- `[[installing-maestro]]` — what an install actually writes into a project, and why the
  project-local copies exist at all. Its **hook arbitration** sub-concept is the full rule for which
  copy of a hook runs, and the three decisions behind it.
- `[[maestro-architecture]]` — what those hooks and scripts do at runtime once they are present.
- `/maestro-update` refreshes the project copies from the **currently installed plugin** — so if the
  plugin cache itself is stale, it faithfully propagates the stale copy. Fix the cache first.
