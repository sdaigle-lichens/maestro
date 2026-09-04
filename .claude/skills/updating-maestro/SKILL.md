---
name: updating-maestro
description: "How a change to Maestro's runtime actually reaches a project — there are now two delivery paths with different failure modes. Hooks registered project-locally (by the desktop app's /maestro route or /maestro-install) run from copies in <project>/.claude/scripts/ and are stale until someone re-installs. Hooks registered by the maestro plugin run from a per-VERSION marketplace cache that autoUpdate only re-pulls when plugin.json `version` changes, so any edit to hooks/ or scripts/ shipped without a version bump is invisible. Use when a hook or script change isn't taking effect in another project, a SubagentStart/PreToolUse hook 'isn't firing', both copies seem to be firing at once, or before shipping any plugin change. Also carries which component of the version to bump (major/minor/patch, and why nothing reads its magnitude), why both copies firing at once is now arbitrated rather than warned about and which path wins, and why a change to the orchestrator template's FRONTMATTER reaches an existing project only through a purge-and-reinstall."
metadata:
  type: concept-skill
  version: "1.5"
  last-update: 6204e4d4d20f1e2926bfc5e6276698a46030a947
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
`projectOwnsHook` in `apps/maestro/src/core/hook-arbitration.ts` and called by each of the five
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
injection + handoff routing), `PreToolUse`/`SubagentStop` logging, the `TaskCreate` validator, and
(since `0.4.0`) the `maestro-step0` readiness check **silently never fire** — no error, the files
just aren't there. **Step 0 is the worst of these**, because `0.4.0` deleted its prose from
`templates/maestro/SKILL.md` outright: there is no fallback left in the orchestrator, so a stale
project gets no readiness check, no fork check, and nothing telling it either was skipped. Meanwhile `bash-validation.sh`
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
It was first shipped as a `0.4.0`-style minor bump, which is the mistake this section exists to stop
repeating. (Unrelated to the real `0.4.0` below, which earns its minor.)

`0.3.5` — forked-agent sync (`031`) — is the second one, and it is the more tempting case. It
**added a script** (`scripts/maestro-agent-forks.cjs`) and its generated lib, rewrote a step in
`templates/maestro/SKILL.md` and added a step to `maestro-update`'s. Still a patch: no new skill,
agent, command, or hook event, so there is nothing a consumer can *invoke* that they could not
before — the existing `/maestro` and `/maestro-update` skills simply do more. A new file under
`scripts/` is not a published surface; a new directory under `skills/` or `agents/` is.

`0.4.0` — Step 0 as a hook — is the third, and the **first legitimate minor**, which is what makes
it worth keeping beside two patches. Almost everything in it would have been a patch alone: a new
script under `scripts/` (`maestro-step0.js` — explicitly not a surface, per `0.3.5`), a
`hook-arbitration.ts` bug fix, deleted template prose, and a second registration on `PreToolUse`,
an event the plugin already registered. **One thing carried the bump**: `hooks/hooks.json` gained a
top-level `UserPromptExpansion` key it had never had, and `install.ts`'s `HookEvent` union gained
the matching member. A hook event the plugin did not previously register is a new published
surface — the harness now calls the plugin at a moment it never used to. That is the minor row's
"a hook registered on a new event", and nothing else in the change comes near it.

`0.4.1` — optional Step 1 gates (`032`) — is the fourth, and it is the case where the table was
applied **against** the ticket that specified the bump. That page said `0.5.0`, minor, on the
reasoning "the published surface grows by a script". Measured against this table and against
`0.3.5`, that does not hold: a new file under `scripts/` is explicitly *not* a published surface,
`hooks/hooks.json` is untouched, and no skill, agent or command was added or renamed. Everything
else in it is a patch by the same precedent — a rewritten step inside
`templates/maestro/SKILL.md`'s managed region, a new check in `maestro-check-runtime.cjs`, an
additive optional `maestro.json` field. A consumer gains nothing they can *invoke*; `/maestro`
simply does less by default. So it shipped as `0.4.1`.

`0.4.2` — customizable handoff templates (`033`) — is the fifth, and the first one where the
published surface **shrank**: all 23 files under `plugins/maestro/templates/handoffs/` were deleted,
and `handoffAssets()` with them. Still a patch, and the table says why on its own terms — a
*published surface* is a skill, agent, command or hook event, and `templates/` is none of those, so
removing files from it is no more a major than adding a script was a minor in `0.3.5`. The seed
bodies did not go away; they moved into `SEED_HANDOFFS` and ship inside `lib/maestro-session.cjs`.
The delivery consequence, though, is the largest of any patch so far: **the asset manifest lost ~23
entries, so `shippedRuntimeId` moved and every installed project reports stale exactly once** — and
the files an old project already has under `.claude/templates/handoffs/` are removed only by an
uninstall, whose sweep of that directory now exists solely for them.

The tempting argument for a minor, and why it fails: the frontmatter grew an `allowed-tools` grant,
so the harness now runs a command it never used to at `/maestro` expansion. That is inside an
existing skill's own body, which `0.3.5` already settled as a patch; `0.4.0`'s minor turned on
`hooks.json` gaining a top-level event key, and nothing in `032` touches it. **The delivery
consequence of the patch is nil** — autoUpdate compares for inequality only — but the frontmatter
trap below is a real one, and it is orthogonal to the component chosen.

### Verify the refresh landed

```bash
P=~/.claude/plugins/cache/maestro/maestro/<new-version>
ls "$P/hooks/hooks.json"                          # exists
ls "$P/scripts/maestro-inject-agent-context.js"   # exists
```

Then `/hooks` should list **SubagentStart → maestro-inject-agent-context.js**.

### What `031`, `0.4.0`, `032` and `033` changed in the copied set

Four more files now ride path 1 into every project — and `033` took ~23 away:

| Copied to | From | Why it is copied rather than run from the plugin |
| --- | --- | --- |
| `.claude/scripts/maestro-agent-forks.cjs` | `plugins/maestro/scripts/` | `/maestro-update` invokes it as `$CLAUDE_PROJECT_DIR/.claude/scripts/…`, like every other project-copied script. |
| `.claude/scripts/lib/maestro-agent-sync.cjs` | `plugins/maestro/scripts/lib/` | The generated bundle that CLI requires — and, since `0.4.0`, the `maestro-step0` hook, which calls `computeAgentSync` from it directly. |
| `.claude/scripts/maestro-step0.cjs` (`0.4.0`) | `plugins/maestro/scripts/maestro-step0.js` | A **`HOOK_SCRIPTS`** entry, not a `STATIC_ASSET` — so it gets the `.js` → `.cjs` rename, and it needs its two `settings.json` registrations merged in as well as the file copied. |
| `.claude/scripts/maestro-step1-gates.cjs` (`032`) | `plugins/maestro/scripts/` | A `STATIC_ASSET`. The orchestrator's Step 1 injects it as `` !`node "$CLAUDE_PROJECT_DIR/.claude/scripts/maestro-step1-gates.cjs"` ``, so it must be a project copy like every other `$CLAUDE_PROJECT_DIR` script. **This is the one whose absence is fatal rather than degrading** — see below. |

**`033` removed a whole group.** The ~23 `templates/handoffs/**.md` no longer ride path 1 at all:
`handoffAssets()` is deleted and `runtimeAssets()` is `STATIC_ASSETS` alone (17 files). What an
install writes in their place is not a copy but a sync — `.claude/handoffs/<sender>/<receiver>.md`,
for exactly the routes the workflows wire, tracked by `syncedFrom` so a hand-edit survives the next
install. The shipped floor rides inside `lib/maestro-session.cjs` instead, which is path 1's usual
trap in a new place: edit `handoff-seeds.ts` without re-running `build:plugin-libs` and every hook
keeps serving the old protocol, silently.

Three are in `STATIC_ASSETS` and `maestro-step0` in `HOOK_SCRIPTS`, in **both** implementations
(`install.ts` and `maestro-install.js`) — the manifests are mirrored by hand, so a file added to one
and not the other is a bug. Since `032`, `test/core/parity.test.ts` asserts the two `STATIC_ASSETS`
`src` sets are **equal**, so that particular bug now fails a named test. Because the
manifest grew, `installedRuntimeId` and `shippedRuntimeId` differ for every already-installed
project: **each one reports stale exactly once and re-copies.** That is this delivery path working,
not a regression.

**Step 0 reaches an installed project only after a re-pull — and since `0.4.0` the trap moved.**
In `0.3.5` it was prose inside the `Maestro:STEPS` **managed region** of
`templates/maestro/SKILL.md`, re-synced by `/maestro-install` and `/maestro-update`. In `0.4.0`
Step 0 was **deleted from that region entirely** and became the `maestro-step0` hook, so what a
project now needs is the new *script* plus its two new *registrations* in `.claude/settings.json` —
still delivered by the same re-pull-then-update, but no longer anything a template sync could carry
on its own. The failure mode is quieter than `0.3.3`'s: a project that never updates simply gets no
readiness check and **no warning that none happened**, because the template no longer has the
fallback commands in it.

### The frontmatter trap — an update cannot deliver it, only a purge-and-reinstall can

**`/maestro-update` re-syncs the orchestrator's MANAGED REGIONS. It never rewrites its
frontmatter.** `syncManagedRegions` touches only what is between the `Maestro:*` markers, and
`installOrchestratorSkill` copies the template whole **only when the destination is absent** — and a
plain (non-purging) uninstall keeps `.claude/skills/maestro/SKILL.md`. So anything the template adds
*outside* a region reaches new installs and nothing else.

`032` is the first change where that matters, because the thing outside the region is a **grant**:

```yaml
allowed-tools: Bash(node "$CLAUDE_PROJECT_DIR/.claude/scripts/maestro-step1-gates.cjs")
```

An injected command whose permission check answers anything but `allow` **aborts the invocation**.
So on a project installed before `0.4.1`, an ordinary update copies the new script and re-syncs the
new Step 1 into the STEPS region, and `/maestro` then **fails to start** — it does not degrade,
because the frontmatter that permits the command it now contains never arrived.

The fix is one of:

- `/maestro-uninstall --purge`, then reinstall — the thorough option, and it also removes
  `maestro.json`, so only do this where the workflow graph is disposable or committed;
- **delete `.claude/skills/maestro/SKILL.md` and re-install** — the file then counts as absent and
  the template is copied whole, frontmatter included. This is the one to reach for: it costs only
  the customisations kept outside the managed regions in that file.

Generalise it: **a template change outside a managed region is not deliverable by an update.** If
the change must reach existing projects, either put it inside a region, or say plainly in the ship
notes that it needs the file deleted first. `plugins/maestro/skills/maestro-update/SKILL.md` carries
this as a Notes bullet so a user driving the terminal path is told the same thing.

## Generated files that need a build, not just an edit

`scripts/lib/maestro-session.cjs`, `scripts/lib/maestro-skill-regions.cjs`,
`scripts/lib/maestro-seed.cjs` and `scripts/lib/maestro-agent-sync.cjs` are **generated** from `apps/maestro/src/core/plugin-entries/` by
`pnpm --filter maestro build:plugin-libs`. Editing the `.cjs` directly is overwritten on
the next build; edit the TypeScript source and rebuild. They are committed because a project
installs them by file copy, so they must exist in the repo.

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
| `/maestro` aborts instead of running, right after an update | the orchestrator's frontmatter is missing the `allowed-tools` grant Step 1's injected command needs — an update never rewrites frontmatter. Delete `.claude/skills/maestro/SKILL.md` and re-install, or purge and reinstall (see the frontmatter trap) |

If skills work but `hooks/`/`scripts/` are absent from the cache → **stale cache, version was never
bumped.**

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
