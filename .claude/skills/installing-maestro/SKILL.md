---
name: installing-maestro
description: "Explains how Maestro's runtime gets into and out of a project: the two implementations that must agree (the app's installRuntime() and the plugin's maestro-install.js), the asset + hook manifest they both write, why the install is project-local rather than global, how staleness is decided, which copy of a hook runs when the plugin and a project-local install are both live, and the two-level uninstall that separates 'stop the hooks' from 'delete my workflow graph'. Use when changing what an install writes, adding a runtime script or a hook, wondering why the plugin's copy of a hook did or didn't fire, wondering why a re-install changed nothing or reported the project stale, why a project's settings.json is hooks-only and never carries a permissions entry, or what --purge actually deletes."
metadata:
  type: concept-skill
  version: "1.18"
  last-update: d83231be731d77a77ad7bf6bfbc0b47c24647a08
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

The manifests are mirrored by hand in both files — **if the two lists diverge, that is a bug in one
of them**. A third rendering, `maestro-install/SKILL.md`'s step 1, restates `detect.ts`'s
classification rules in prose and has **no test at all** (`053`). See the two-implementations
sub-concept for what each test pins and what nothing pins.

## Why the install is project-local

The plugin's `hooks.json` registers the session hooks from `${CLAUDE_PLUGIN_ROOT}`, which resolves
into the **marketplace cache — a copy keyed by `plugin.json`'s version**. Any edit to `hooks/` or
`scripts/` shipped without a version bump is invisible to every installed project. Registering the
same hooks in the _project's_ own `.claude/settings.json`, pointing at
`$CLAUDE_PROJECT_DIR/.claude/scripts/`, makes "update this project's runtime" a file copy the app
can do and the user can see. That is the whole reason the copies exist. `updating-maestro` covers
the consequences when a change doesn't land.

**The flip side used to be double registration**, and it is now arbitrated at runtime rather than
warned about — the plugin's copy of a hook stands down when the project registers that same hook
itself. `InstallStatus.pluginHooksActive` and the warnings it drove are gone; the app still never
writes `~/.claude`, it just no longer needs to ask the user to. See the hook-arbitration sub-concept.

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
| `apps/maestro/src/core/install.ts`                           | 703   | The manifest, `HOOK_REGISTRATIONS`, `installStatus`, `installRuntime`, `refreshStaleRuntime`. |
| `apps/maestro/src/core/uninstall.ts`                         | 410   | The mirror — `uninstallPlan`, `purgeTargets`, `uninstallRuntime`.                             |
| `apps/maestro/src/core/hook-arbitration.ts`                  | 144   | Which copy of a hook runs when both delivery paths are live. Owns `Settings`/`HookEntry`/`HookCommand` and `samePath`. |
| `apps/maestro/src/core/skill-resolve.ts`                     | —     | `walkProjectSkillIds`/`resolveProjectSkillPath`/`isRootSkillPath` (`061`) — see the skill-discovery sub-concept. |
| `plugins/maestro/scripts/maestro-install.js`                 | 743   | The terminal implementation of the same manifest, including `syncProjectHandoffs()` and `syncProjectReports()` (`059`). Its `HOOK_REGISTRATIONS`/`STATIC_ASSETS`/`runtimeAssets` are `module.exports`ed with **no side effect** (`060`) — everything that touches a project sits behind `require.main === module` — so the uninstaller can `require` them instead of keeping a second manifest. |
| `plugins/maestro/scripts/maestro-uninstall.js`               | 298   | The terminal implementation of the same removal — `require`s its hook-script and asset lists from `maestro-install.js` (`060`). |
| `plugins/maestro/scripts/maestro-step0.js`                   | 152   | The orchestrator's Step 0 as a hook (`UserPromptExpansion` on `maestro`, `PreToolUse` on `Skill`). Runs the readiness check and the agent-fork check (the two rows below) and answers in the shape each event accepts; `install` exits 2 and blocks the invocation. |
| `plugins/maestro/scripts/maestro-enable-task-routing.js`     | —     | `047`'s addition, dual-registered the same way (`UserPromptExpansion` on `to-maestro-tasks`, `PreToolUse` on `Skill`, sharing that matcher's block with `maestro-step0.js`). Injects nothing — its only effect is flipping `maestro.json`'s `use_maestro_tasks` to `true` on the first `/to-maestro-tasks`. |
| `plugins/maestro/scripts/maestro-check-runtime.cjs`          | 206   | The readiness check itself — `checkRuntime(projectDir)`, which the hook `require`s. Its `require.main` CLI prints the same JSON, for a **person** debugging by hand; nothing in the orchestrator runs it. |
| `plugins/maestro/scripts/maestro-step1-gates.cjs`            | 69    | `032`'s addition, and the first asset invoked by the *harness* rather than by a hook or the model: Step 1 injects it with `!`-prefixed command injection. Prints one line naming the gates to run; **exits 0 and writes no stderr under every input**, because a non-zero exit aborts the invocation. |
| `plugins/maestro/scripts/maestro-step4-gate.cjs`              | —     | `046`'s addition — same harness-invoked, exit-0-unconditional contract, for Step 4: resolves `use_maestro_tasks` and prints a line naming `/to-maestro-tasks` when on, a neutral line when off. |
| `plugins/maestro/scripts/maestro-agent-forks.cjs`            | 127   | Step 0's *second* check (`031`) — `list`/`diff`/`update`/`keep`/`detach` over forked agents. `list` and `diff` write nothing. The hook calls `computeAgentSync` directly; this CLI is the user-facing half. |
| `plugins/maestro/scripts/maestro-resolve-skill-path.cjs`     | —     | `061`'s addition — a `STATIC_ASSET`, not a hook. See the skill-discovery sub-concept. |
| `plugins/maestro/skills/maestro-{install,update,uninstall}/` | 305   | The published skills that drive the terminal path.                                            |

Supporting: `skill-regions.ts` (managed-region sync), `render.ts` (the HANDOFFS table), `seed.ts`
(`defaultV3Config`), `detect.ts`, `report-sync.ts`, and — since `033` — `handoff-sync.ts`
(`syncProjectHandoffs`, run right after `syncProjectReports`, and the **third** caller of
`decideSync`). Test: `test/core/install.test.ts`, `test/core/uninstall.test.ts`,
`test/core/hook-arbitration.test.ts`, `test/core/handoffs.test.ts`, `test/core/parity.test.ts`.

## Things that bite

- **The hook scripts are renamed `.js` → `.cjs` on copy**, and it is load-bearing: inside a project
  under `"type": "module"` node parses their `require()` as ESM and **fails the hook on every tool
  call**. Adding a script to `HOOK_SCRIPTS` gets the rename; adding one to `STATIC_ASSETS` does not.
  See the manifest sub-concept.
- **A registration decides which copy of the hook runs**, not just whether the project is installed.
  The plugin's copy stands down for exactly the hooks the project registers, so removing a
  registration hands that hook back to the plugin rather than turning it off. Read the
  hook-arbitration sub-concept before changing `HOOK_REGISTRATIONS` or how `hasHook()` matches.
- **The install writes HOOKS into `settings.json` and nothing else — no `permissions` block, ever.**
  `032` needed a permission grant and still didn't break this, putting it in the orchestrator
  template's frontmatter as `allowed-tools`. A permissions entry is a claim on the user's
  project-wide configuration that a hook registration is not. See the manifest sub-concept.
- **`bash-validation.sh`'s command string is unquoted, byte-for-byte as the legacy installer wrote
  it.** `maestro-uninstall.js` removes it by _exact string match_, and old projects carry that exact
  value. Re-quoting it here duplicates the entry on those projects and orphans it on uninstall.
- **Handoff templates are no longer copied assets at all (`033`).** `handoffAssets()` is gone;
  `.claude/templates/handoffs/` is dead. What an install produces is
  `.claude/handoffs/<sender>/<receiver>.md` via `syncProjectHandoffs()` — a sync, not a blind copy,
  so a hand-edit is detected and preserved. Uninstall still sweeps the old directory purely to clear
  pre-`0.4.2` orphans. See the manifest sub-concept.
- **Rendering is a separate step from scaffolding**, always. The renderer _consumes_ `maestro.json`
  and writes into `maestro/SKILL.md`, so both must already exist — hence
  `maestro-render-orchestrator.cjs` runs afterwards, and `/maestro-update` is just those two steps
  standalone.
- **The seed is guarded on absence.** An existing `maestro.json` is the user's authored graph and is
  never overwritten — by install, re-install, or refresh.
- **A lib a copied script `require`s must be in `STATIC_ASSETS`, and forgetting one fails silently
  (`035`).** Every sqlite `require` sits inside a try/catch, so a missing lib is swallowed and the
  tier it backed stops existing — for projects on their own copy only, while the plugin's copy keeps
  answering from the marketplace cache. `install.test.ts` now scans for this. See the manifest
  sub-concept.
- **Changing the asset list makes every installed project stale exactly once.** `031` added two,
  `032` one, `033` **removed ~23**, `035` two, `046` one — `shippedRuntimeId` moved each time and
  every project reported stale on its next check and re-copied. Expected, and the only way a runtime
  file ever arrives or leaves, but worth saying out loud because "everything went stale after my
  change" reads like a bug. The digest is over the **manifest**, so this fires whether or not any
  *existing* file changed.
- **`refreshStaleRuntime` never installs fresh**, because it fires on project _selection_ —
  auto-installing would put Maestro into every repo the user happens to open. See the staleness
  sub-concept for that and the other two answers to "is this project current".
- **A `--purge` used to freeze `.claude/reports/` and `.claude/handoffs/` forever, silently
  (`059`).** Purge deletes `maestro.json` and with it every tracking entry, but never those two
  directories, so their files looked `untracked` to `decideSync` and stayed `unchanged` on every
  reinstall after that. Fixed with a sixth verdict, `adopt`. See the uninstall-and-purge sub-concept.
- **A skill id an install discovers is not necessarily one the Skill tool can invoke (`061`)**, and
  before `056` a monorepo could be seeded with no skills at all and never know it. See the
  skill-discovery sub-concept.

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
  each do that the other doesn't, and what the differential and parity tests pin.
- [Staleness and refresh](sub-concepts/staleness.md) — three different answers to "is this project
  current", and which one runs where.
- [Uninstall and purge](sub-concepts/uninstall-and-purge.md) — the two levels, and why the
  asymmetry with install is deliberate.
- [Hook arbitration](sub-concepts/hook-arbitration.md) — which copy of a hook runs when both
  delivery paths are live, and the three decisions behind the rule.
- [Skill discovery and resolution](sub-concepts/skill-discovery.md) — which skill ids a fresh seed
  finds, and why a discovered id can still get "Unknown skill" from the Skill tool.
