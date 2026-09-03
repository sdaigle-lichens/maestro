---
name: installing-maestro
description: "Explains how Maestro's runtime gets into and out of a project: the two implementations that must agree (the app's installRuntime() and the plugin's maestro-install.js), the asset + hook manifest they both write, why the install is project-local rather than global, how staleness is decided, which copy of a hook runs when the plugin and a project-local install are both live, and the two-level uninstall that separates 'stop the hooks' from 'delete my workflow graph'. Use when changing what an install writes, adding a runtime script or a hook, wondering why the plugin's copy of a hook did or didn't fire, wondering why a re-install changed nothing or reported the project stale, why a project's settings.json was or wasn't touched, or what --purge actually deletes."
metadata:
  type: concept-skill
  version: "1.3"
  last-update: dc07795aca62476b23408ba23e0455dc855aef35
---

# Installing Maestro

Getting Maestro's runtime half into a project is a **deterministic node operation with no Claude
session involved** — which is what separates it from `maestro-architecture`, the runtime that only
exists _inside_ a session. The two meet at the files this pipeline writes.

**Two implementations produce the same result, and a differential test holds them to it.** Neither
is the fallback for the other:

|             | The app                                                  | The terminal                                 |
| ----------- | -------------------------------------------------------- | -------------------------------------------- |
| Entry point | `installRuntime()` in `apps/maestro/src/core/install.ts` | `plugins/maestro/scripts/maestro-install.js` |
| Reached by  | the `/maestro` route                                     | the `/maestro-install` skill                 |
| For         | a machine with the desktop app                           | a machine without it                         |

`install.ts`'s header says `PORTED FROM` the script and `test/core/install.test.ts` opens with
`describe("differential against the legacy installer")`, asserting the same files byte for byte.
The manifests are mirrored by hand in both files — **if the two lists diverge, that is a bug in one
of them**, and the plugin script's header says so too. Same shape as `task-queue`'s two
implementations, and unlike `plugin-libs-parity`, **nothing here is generated**: both copies are
hand-maintained.

## Why the install is project-local

The plugin's `hooks.json` registers the session hooks from `${CLAUDE_PLUGIN_ROOT}`, which resolves
into the **marketplace cache — a copy keyed by `plugin.json`'s version**. Any edit to `hooks/` or
`scripts/` shipped without a version bump is invisible to every installed project. Registering the
same hooks in the _project's_ own `.claude/settings.json`, pointing at
`$CLAUDE_PROJECT_DIR/.claude/scripts/`, makes "update this project's runtime" a file copy the app
can do and the user can see. That is the whole reason the copies exist. `updating-maestro` covers
the consequences when a change doesn't land.

**The flip side used to be double registration.** A machine with both the plugin _and_ a
project-local install fired every hook twice. It is now arbitrated at runtime instead of warned
about: **the plugin's copy of a hook stands down when the project registers that same hook itself**
(`hook-arbitration.ts`, and the sub-concept below). Precedence is per hook, so a partial install
still gets the plugin covering the rest. `InstallStatus.pluginHooksActive` and the warnings it drove
are gone — the app still never writes `~/.claude`, it just no longer needs to ask the user to.

## Three rules the code exists to enforce

1. **Project-local, never global.** Every path written is under `projectRoot`. An installer that
   registered hooks globally would silently change every other repo on the machine.
2. **Merge, never clobber.** `settings.json` is a file users hand-edit. Unknown keys, unrelated
   hooks and other matchers survive. An unparseable file **aborts the install** rather than being
   replaced with `{}` — which is what the legacy script did, losing the user's content.
3. **Idempotent.** A second run adds no hook entry and rewrites no identical file. The presence
   test keys on the script's **basename inside the command string**, not an exact match, so a user
   who re-quoted a path by hand doesn't get a duplicate that fires twice. `hasHook()` delegates to
   `settingsRegisterScript` in `hook-arbitration.ts` so this test and the runtime guard can never
   disagree about what "registered" means.

Ordering enforces a fourth: **everything that can refuse is checked before the first byte is
written**, so a rejected install leaves the project exactly as it was. Past that point every step
is a copy or an append that re-running completes.

## Files

| File                                                         | Lines | What it owns                                                                                  |
| ------------------------------------------------------------ | ----- | --------------------------------------------------------------------------------------------- |
| `apps/maestro/src/core/install.ts`                           | 704   | The manifest, `HOOK_REGISTRATIONS`, `installStatus`, `installRuntime`, `refreshStaleRuntime`. |
| `apps/maestro/src/core/uninstall.ts`                         | 401   | The mirror — `uninstallPlan`, `purgeTargets`, `uninstallRuntime`.                             |
| `apps/maestro/src/core/hook-arbitration.ts`                  | 144   | Which copy of a hook runs when both delivery paths are live. Owns `Settings`/`HookEntry`/`HookCommand`, and `samePath` (see the hook-arbitration sub-concept). |
| `plugins/maestro/scripts/maestro-install.js`                 | 569   | The terminal implementation of the same manifest.                                             |
| `plugins/maestro/scripts/maestro-uninstall.js`               | 201   | The terminal implementation of the same removal.                                              |
| `plugins/maestro/scripts/maestro-step0.js`                   | 152   | The orchestrator's Step 0 as a hook (`UserPromptExpansion` on `maestro`, `PreToolUse` on `Skill`). Runs the two checks below and answers in the shape each event accepts; `install` exits 2 and blocks the invocation. |
| `plugins/maestro/scripts/maestro-check-runtime.cjs`          | 206   | The readiness check itself — `checkRuntime(projectDir)`, which the hook `require`s. Its `require.main` CLI prints the same JSON, for a **person** debugging a project by hand; nothing in the orchestrator runs it. |
| `plugins/maestro/scripts/maestro-agent-forks.cjs`            | 127   | Step 0's *second* check (`031`) — `list`/`diff`/`update`/`keep`/`detach` over forked agents. `list` and `diff` write nothing. The hook calls `computeAgentSync` directly; this CLI is the user-facing half. |
| `plugins/maestro/skills/maestro-{install,update,uninstall}/` | 305   | The published skills that drive the terminal path.                                            |

Supporting: `skill-regions.ts` (managed-region sync), `render.ts` (the HANDOFFS table), `seed.ts`
(`defaultV3Config`), `detect.ts`, `report-sync.ts`. Test: `test/core/install.test.ts`,
`test/core/uninstall.test.ts`, `test/core/hook-arbitration.test.ts`.

## Things that bite

- **The hook scripts are renamed `.js` → `.cjs` on copy.** They keep `.js` in the plugin because
  that directory has no `package.json` declaring a module type; inside a project the same file may
  sit under `"type": "module"`, which makes node parse their `require()` as ESM and **fail the hook
  on every tool call**. Adding a hook script to `HOOK_SCRIPTS` gets the rename; adding one to
  `STATIC_ASSETS` does not.
- **A registration means more than "this project is installed" — it decides which copy of the hook
  runs.** The plugin's copy stands down for exactly the hooks the project registers, so removing a
  registration hands that hook back to the plugin rather than turning it off. See the hook
  arbitration sub-concept before changing `HOOK_REGISTRATIONS` or how `hasHook()` matches.
- **`bash-validation.sh`'s command string is unquoted, byte-for-byte as the legacy installer wrote
  it.** `maestro-uninstall.js` removes it by _exact string match_, and old projects carry that exact
  value. Re-quoting it here duplicates the entry on those projects and orphans it on uninstall.
- **Handoff templates install to `.claude/templates/handoffs/`, never `.claude/handoffs/`.** The
  second is the user's override location, which the injector checks first. Copying into it would
  overwrite a customised protocol on every update.
- **Rendering is a separate step from scaffolding**, always. The renderer _consumes_ `maestro.json`
  and writes into `maestro/SKILL.md`, so both must already exist — hence
  `maestro-render-orchestrator.cjs` runs afterwards, and `/maestro-update` is just those two steps
  standalone.
- **The seed is guarded on absence.** An existing `maestro.json` is the user's authored graph and is
  never overwritten — by install, re-install, or refresh.
- **Adding an asset makes every installed project stale exactly once.** `031` added two
  (`maestro-agent-forks.cjs` and its `lib/maestro-agent-sync.cjs`), so `shippedRuntimeId` moved and
  every project reports stale on its next check and re-copies. Expected, and the only way a new
  runtime file ever arrives — but worth saying out loud, because "everything went stale after my
  change" reads like a bug.
- **`refreshStaleRuntime` never installs fresh.** It fires on project _selection_, so auto-installing
  would put Maestro into every repo the user happens to open. It also uses a raw parse rather than
  `readConfig()`'s blank-on-corrupt fallback, so a corrupt config is never silently rewritten.

## Relationships

- `[[agent-fork-sync]]` (in `apps/maestro/.claude/skills`) — what the two runtime assets
  `031` added to the manifest actually do, and why they are copied into the project rather
  than run from `${CLAUDE_PLUGIN_ROOT}`.
- `maestro-architecture` — what the installed files then _do_ inside a session. It links here for
  the pipeline rather than describing it.
- `updating-maestro` — the debugging companion: why a change to a script or hook isn't reaching a
  project. This skill is what an install writes; that one is why a copy is stale.
- `task-queue` — `.claude/maestro-tasks/` is user-authored content that a purge reports on and
  **never deletes** without its own second opt-in.
- [`maestro-config-model`](../../../apps/maestro/.claude/skills/maestro-config-model/SKILL.md) —
  `defaultV3Config` is what a first install seeds, and `runtimeVersion` is the field it stamps.

## Sub-concepts

- [The manifest](sub-concepts/manifest.md) — every file and hook an install writes, and why each is
  where it is.
- [Two implementations](sub-concepts/two-implementations.md) — what the app and the terminal path
  each do that the other doesn't, and what the differential test pins.
- [Staleness and refresh](sub-concepts/staleness.md) — three different answers to "is this project
  current", and which one runs where.
- [Uninstall and purge](sub-concepts/uninstall-and-purge.md) — the two levels, and why the
  asymmetry with install is deliberate.
- [Hook arbitration](sub-concepts/hook-arbitration.md) — which copy of a hook runs when both
  delivery paths are live, and the three decisions behind the rule.
