---
name: updating-maestro
description: "How a change to Maestro's runtime actually reaches a project — there are now two delivery paths with different failure modes. Hooks registered project-locally (by the desktop app's /maestro route or /maestro-install) run from copies in <project>/.claude/scripts/ and are stale until someone re-installs. Hooks registered by the maestro plugin run from a per-VERSION marketplace cache that autoUpdate only re-pulls when plugin.json `version` changes, so any edit to hooks/ or scripts/ shipped without a version bump is invisible. Use when a hook or script change isn't taking effect in another project, a SubagentStart/PreToolUse hook 'isn't firing', both copies seem to be firing at once, or before shipping any plugin change. Also carries which component of the version to bump (major/minor/patch, and why nothing reads its magnitude), why both copies firing at once is now arbitrated rather than warned about and which path wins, and why a change to the orchestrator template's FRONTMATTER reaches an existing project only through a purge-and-reinstall."
metadata:
  type: concept-skill
  version: "2.3"
  last-update: 863ff60fdbcc76a204b05bc079a3e20da3b937f4
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
`projectOwnsHook` in `apps/maestro/src/core/hook-arbitration.ts` and called by eight
of the nine plugin hook scripts that have a project twin (`HOOK_SCRIPTS`). The ninth,
`maestro-channel-write-guard.js`, is **exempt** (`122`): a confinement hook must fail closed, and
standing down would fail open when the project copy can't run, so both copies always run. So the left column wins per hook, the right column covers any hook the project
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

**Neither path refreshes a project down (`087`).** A project stamped newer than the plugin or the
app is reported as the *plugin/app* being behind (`pluginBehind` notice at Step 0, `appBehind` in
the app), and `maestro-install.js` refuses with `refused:"downgrade"` unless re-run with
`--allow-downgrade` on the user's explicit request. In this repo the project is often ahead of the
installed plugin cache, so "update the plugin" is the usual fix. See `installing-maestro`'s
staleness sub-concept.

**Copied scripts are `.cjs`, never `.js`.** The plugin can run them as `.js` because its directory
has no `package.json` declaring a module type; a project's does, and `"type": "module"` makes node
parse their `require()` as ESM — the hook then fails on _every tool call_ with "require is not
defined in ES module scope".

Which files ride this path, and what the recent changes did to that set (including the ~23 handoff
templates `033` removed, the two mirrored manifests, and how Step 0 now reaches a project):
[what recent changes did to the copied set](sub-concepts/copied-asset-manifest.md).

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
injection + handoff routing), `PreToolUse`/`SubagentStop` logging, the `TaskCreate` validator, and
(since `0.4.0`) the `maestro-step0` readiness check **silently never fire** — no error, the files
just aren't there. **Step 0 is the worst of these**, because `0.4.0` deleted its prose from
`templates/maestro/SKILL.md` outright: there is no fallback left in the orchestrator, so a stale
project gets no readiness check, no fork check, and nothing telling it either was skipped.

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

Verify the refresh landed:

```bash
P=~/.claude/plugins/cache/maestro/maestro/<new-version>
ls "$P/hooks/hooks.json"                          # exists
ls "$P/scripts/maestro-inject-agent-context.js"   # exists
```

Then `/hooks` should list **SubagentStart → maestro-inject-agent-context.js**.

### Which component to bump

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

A new file under `scripts/` is **not** a published surface; a new directory under `skills/` or
`agents/` is. A `feat:` commit is **not** automatically a minor.

Every bump this repo has argued about, with the reasoning that settled it —
`0.3.3`, `0.3.5`, `0.4.0` (the first legitimate minor), `0.4.1`, `0.4.2`, `0.4.3`, `0.4.4`, `0.5.0`
(the textbook minor), `0.5.2`, `0.5.3`, `0.5.4` — is in
[version bump precedent](sub-concepts/version-bump-examples.md). Read it when a change feels like it
might be a minor.

`130` (`0.12.11 → 0.13.0`) is a recent worked example: a new hook script plus a `hooks.json` entry
(`PreToolUse`, matcher `AskUserQuestion`), shipped as a minor because the ticket named the new hook
registration as published surface. The event itself already existed, so a patch would also have been
defensible; nothing reads the magnitude. A project-local install only gets the gate after a
re-install (`maestro-install.js` / `/maestro-update`), since the project copy lives in
`.claude/scripts/`.

### The frontmatter trap

**`/maestro-update` re-syncs the orchestrator's managed regions. It never rewrites its
frontmatter** — so a template change *outside* a `Maestro:*` region reaches new installs and nothing
else, and since `032` the thing outside the region is an `allowed-tools` grant whose absence makes
`/maestro` abort rather than degrade. The two fixes and the general rule:
[the frontmatter trap](sub-concepts/frontmatter-trap.md).

## Generated files that need a build, not just an edit

Every `scripts/lib/*.cjs` except `maestro-tasks.cjs` (`maestro-session`, `maestro-seed`,
`maestro-skill-regions`, `maestro-agent-sync`, `maestro-epic`, and so on — one per file under
`apps/maestro/src/core/plugin-entries/`, seventeen) is **generated** from that directory by
`pnpm --filter maestro build:plugin-libs`. Editing the
`.cjs` directly is overwritten on the next build; edit the TypeScript source and rebuild. They are
committed because a project installs them by file copy, so they must exist in the repo. A rebuilt
lib that is in `STATIC_ASSETS` must also be copied over this repo's own `.claude/scripts/lib/`
mirror — a second place a change can go stale. `pnpm refresh:runtime` does the whole refresh in
order (rebuild libs, `maestro-install.js .` for the mirrors, the rendered orchestrator's STEPS and the
settings hooks, then the HANDOFFS render) and is idempotent; `parity.test.ts` names it when anything
is stale, and a sandboxed agent hands the user `! pnpm refresh:runtime`. `maestro-render-orchestrator.cjs`
alone does NOT refresh STEPS (see `.claude/rules/plugin-publishing.md`).

**`032` is the worked example of forgetting.** It changed `seed.ts` to emit a `gates` block, but
`seed.ts` is a `plugin-entries` source, so until `build:plugin-libs` was re-run the terminal
installer went on seeding a config with **no `gates` field** from the stale
`lib/maestro-seed.cjs` — which resolves to "both gates off" and therefore looked correct. No test
caught it; installing into a real fixture project did. Anything under `src/core/plugin-entries`'
import graph needs the rebuild **and** a `git diff plugins/maestro/scripts/lib/` afterwards.

## Diagnosing "my hook/script change isn't taking effect"

| Check                                     | Command                                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Which path is this project on?            | `cat <project>/.claude/settings.json` — Maestro hooks present ⇒ project-local; absent ⇒ plugin-global |
| Project-local and stale?                  | the `/maestro` route's badge, or just re-run `/maestro-update`                                        |
| What plugin version is installed?         | `cat ~/.claude/plugins/installed_plugins.json` (`installPath` + `version` + `installedAt`)            |
| Does the cached copy even have the files? | `ls ~/.claude/plugins/cache/maestro/<plugin>/<version>/{hooks,scripts}`                  |
| Is the cache older than the change?       | compare `installedAt` / dir mtime against the commit that added the file                              |
| Everything logged twice?                  | the cached plugin version predates `0.3.3` — it has no arbitration guard. Bump/re-pull (above)        |
| Hook fires from **neither** copy?         | a runtime older than `0.4.0` on a project reached through a **symlinked** ancestor. `projectOwnsHook` compared `path.resolve`d paths, so the project's own copy failed to recognise itself (`/tmp/p` vs `/private/tmp/p`), stood down, and the plugin's copy stood down too — no error, no output, nothing in the log. Fixed by `samePath` (realpath both sides). Subject to the same double version trap as `0.3.3`'s guard: re-install (path 1) **and** re-pull (path 2). |
| An agent gets **no** output format, or the shipped handoff protocol instead of the customized one | the project is on a runtime older than `0.4.4`, so its `.claude/scripts/lib/` has no `maestro-report-defaults.cjs` / `maestro-handoff-defaults.cjs` and the global sqlite tier silently does not exist for its copy of the hook. Confirm with `ls <project>/.claude/scripts/lib/`; fix by re-installing (path 1). Note this only shows up where the project's copy **wins** the arbitration — the plugin's copy resolves the tier fine |
| `/maestro` aborts instead of running, right after an update | the orchestrator's frontmatter is missing the `allowed-tools` grant Step 1's injected command needs — an update never rewrites frontmatter. Delete `.claude/skills/maestro/SKILL.md` and re-install, or purge and reinstall (see [the frontmatter trap](sub-concepts/frontmatter-trap.md)) |

If skills work but `hooks/`/`scripts/` are absent from the cache → **stale cache, version was never
bumped.**

## Sub-concepts

- [Version bump precedent](sub-concepts/version-bump-examples.md) — every bump this repo has
  argued about and the reasoning that settled it, for when a change feels like a minor.
- [What recent changes did to the copied set](sub-concepts/copied-asset-manifest.md) — the path-1
  asset manifest: what each new copied file is for, the ~23 `033` removed, the two mirrored
  manifests and the tests that pin them.
- [The frontmatter trap](sub-concepts/frontmatter-trap.md) — why a template change outside a
  managed region is not deliverable by an update, and the two ways to force it through.

## Related

- `[[agent-fork-sync]]` (in `apps/maestro/.claude/skills`) — the other consumer of the
  version-string rule: a forked agent's staleness is a plugin `version` inequality, so a plugin
  edit shipped without a bump correctly reports *no update available*.
- `[[installing-maestro]]` — what an install actually writes into a project, and why the
  project-local copies exist at all. Its **hook arbitration** sub-concept is the full rule for which
  copy of a hook runs, and the three decisions behind it.
- `[[maestro-architecture]]` — what those hooks and scripts do at runtime once they are present.
- `/maestro-update` refreshes the project copies from the **currently installed plugin** — so if the
  plugin cache itself is stale, it faithfully propagates the stale copy. Fix the cache first.
- Config repair rides along with a re-install (`092`): a missing `start_skills`/`end_skills` is
  seeded once and `gates` removed. The stale-refs report suggests `/maestro-install` when authored
  config lacks `start_skills`; `/maestro-update` relays that suggestion and tells the user to adjust
  the seeded lists on the app's `/maestro` page.
