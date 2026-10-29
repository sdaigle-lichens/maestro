---
name: installing-maestro
description: "Explains how Maestro's runtime gets into and out of a project: the two implementations that must agree (the app's installRuntime() and the plugin's maestro-install.js), the asset + hook manifest they both write, why the install is project-local rather than global, how staleness is decided, which copy of a hook runs when the plugin and a project-local install are both live, and the two-level uninstall that separates 'stop the hooks' from 'delete my workflow graph'. Use when changing what an install writes, adding a runtime script or a hook, wondering why the plugin's copy of a hook did or didn't fire, wondering why a re-install changed nothing or reported the project stale, why a project's settings.json carries hooks and exactly one permissions rule (the channel Write allow), or what --purge actually deletes."
metadata:
  type: concept-skill
  version: "2.5"
  last-update: 36af091203282a4987c88ea31ec5a69655f1450f
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
of them**. A third rendering, `maestro-install/SKILL.md`'s step 2 (step 1 is now the committed-or-ignored question), restates `detect.ts`'s
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

**Re-install repairs an old config once (`092`).** `seedMissingSkillLists` (`seed.ts`) parses
`maestro.json` raw (not `readConfig`), fills a missing `start_skills`/`end_skills` with the
fresh-install defaults, removes a leftover `gates` key, and rewrites the file only if something
changed. A list already present, even empty, is left alone. `InstallReport.skillListsSeeded`
(`{start_skills, end_skills, gatesRemoved}` or `null`) and the `maestro-install.js` JSON summary
carry it so the skill can tell the user what was seeded. `maestro-seed` is not in `STATIC_ASSETS`,
so it needs no `.claude/scripts/lib` mirror.

**Terminal-only: `--ignore-mode committed|ignored`.** `ignored` writes `.claude/` into the
clone-local `git rev-parse --git-path info/exclude` (first write of the run) instead of the
committed `.gitignore` `# Maestro` block. The app's `installRuntime()` has no ignore mode and always
writes the block. The exclude line is preceded by a `# Maestro (added by maestro-install)` marker;
`maestro-uninstall.js --purge` (only purge, since a plain uninstall keeps the `maestro.json` and
orchestrator skill the line hides) removes that marker+line pair, never a user's own `.claude/`
line. Uninstall never removes the `.gitignore` block. See the manifest, two-implementations and
uninstall-and-purge sub-concepts.

Ordering enforces a fourth: **everything that can refuse is checked before the first byte is
written**, so a rejected install leaves the project exactly as it was. Past that point every step
is a copy or an append that re-running completes.

**An unusable `maestro.json` is refused, never blanked or stamped over (`096`).** An existing file
that is not parseable JSON, or not `version: 3`, is the user's authored graph. Both paths call
`maestroConfigRefusal(raw)` from `apps/maestro/src/core/config-usable.ts` (pure, text in, verdict
out; reaches the plugin through the `maestro-seed` bundle) — the single definition of "unusable" and
of the wording. It returns `{kind: "unparseable" | "unsupported-version", file, problem, message}`
or `null`; a missing file is not its business.

| | App | Terminal |
| --- | --- | --- |
| Refusal | `installRuntime()` returns a report with `configRefusal` set (`InstallReport.configRefusal`, `null` otherwise); every other field is the empty/unchanged value | JSON `{ok:false, refused:"config", kind, file, problem, reason}`, exit 1 (a non-`ENOENT` read error gives `refused:"config"` with just `reason`) |
| Shown by | `install-report-card.tsx` renders an alert instead of "What changed on disk"; `maestro.tsx` and `install-context.tsx` skip the tags offer and the auto-refresh follow-ups when it is set | the `maestro-install` skill relays `reason` |

**Known edge:** an *unreadable* `maestro.json` (e.g. a directory at that path) makes the app's
`installRuntime()` **throw** from `readFileSync` rather than return a refusal, while the plugin
refuses cleanly. Both write nothing; only the shape differs.

## Files

| File                                                         | Lines | What it owns                                                                                  |
| ------------------------------------------------------------ | ----- | --------------------------------------------------------------------------------------------- |
| `apps/maestro/src/core/install.ts`                           | 957   | The manifest (`STATIC_ASSETS`, `HOOK_SCRIPTS`, `HOOK_REGISTRATIONS`, `RETIRED_HOOK_SCRIPTS`), `installStatus`, `installRuntime`, `refreshStaleRuntime`. |
| `apps/maestro/src/core/uninstall.ts`                         | 465   | The mirror — `uninstallPlan`, `purgeTargets`, `uninstallRuntime`.                             |
| `apps/maestro/src/core/hook-arbitration.ts`                  | 144   | Which copy of a hook runs when both delivery paths are live. Owns `Settings`/`HookEntry`/`HookCommand` and `samePath`. |
| `apps/maestro/src/core/skill-resolve.ts`                     | 91    | `walkProjectSkillIds`/`resolveProjectSkillPath`/`isRootSkillPath` (`061`) — see the skill-discovery sub-concept. |
| `plugins/maestro/scripts/maestro-install.js`                 | 976   | The terminal implementation of the same manifest, including `syncProjectHandoffs()` and `syncProjectReports()` (`059`). Its `HOOK_REGISTRATIONS`/`STATIC_ASSETS`/`runtimeAssets` are `module.exports`ed with **no side effect** (`060`) — everything that touches a project sits behind `require.main === module` — so the uninstaller can `require` them instead of keeping a second manifest. |
| `plugins/maestro/scripts/maestro-uninstall.js`               | 351   | The terminal implementation of the same removal — `require`s its hook-script and asset lists from `maestro-install.js` (`060`). |
| `plugins/maestro/scripts/maestro-step0.js`                   | 157   | The orchestrator's Step 0 as a hook (`UserPromptExpansion` on `maestro`, `PreToolUse` on `Skill`). Runs the readiness check and the agent-fork check (the two rows below) and answers in the shape each event accepts; `install` exits 2 and blocks the invocation. |
| `plugins/maestro/scripts/maestro-enable-task-routing.js`     | 102   | `047`'s addition, dual-registered the same way (`UserPromptExpansion` on `to-maestro-tasks`, `PreToolUse` on `Skill`, sharing that matcher's block with `maestro-step0.js`). Injects nothing — its only effect is flipping `maestro.json`'s `use_maestro_tasks` to `true` on the first `/to-maestro-tasks`. |
| `plugins/maestro/scripts/maestro-check-runtime.cjs`          | 281   | The readiness check itself — `checkRuntime(projectDir)`, which the hook `require`s. Its `require.main` CLI prints the same JSON, for a **person** debugging by hand; nothing in the orchestrator runs it. |
| `plugins/maestro/scripts/maestro-step1-gates.cjs`            | 109   | `032`'s addition, and the first asset invoked by the *harness* rather than by a hook or the model: Step 1 injects it with `!`-prefixed command injection. Prints one line naming the start skills to run (from `start_skills`; `--for to_maestro_tasks` selects the other list); **exits 0 and writes no stderr under every input**, because a non-zero exit aborts the invocation. |
| `plugins/maestro/scripts/maestro-end-skills.cjs`              | 50    | `089`'s addition — same harness-invoked, exit-0 contract, for Step 7: prints the `end_skills.maestro` list as one line. Requires `lib/maestro-skill-lists.cjs`, also a `STATIC_ASSET`. |
| `plugins/maestro/scripts/maestro-step4-gate.cjs`              | 80    | `046`'s addition — same harness-invoked, exit-0-unconditional contract, for Step 4: resolves `use_maestro_tasks` and prints a line naming `/to-maestro-tasks` when on, a neutral line when off. |
| `plugins/maestro/scripts/maestro-agent-forks.cjs`            | 127   | Step 0's *second* check (`031`) — `list`/`diff`/`update`/`keep`/`detach` over forked agents. `list` and `diff` write nothing. The hook calls `computeAgentSync` directly; this CLI is the user-facing half. |
| `plugins/maestro/scripts/maestro-resolve-skill-path.cjs`     | 40    | `061`'s addition — a `STATIC_ASSET`, not a hook. See the skill-discovery sub-concept. |
| `plugins/maestro/scripts/maestro-post-mortem-context.js`, `maestro-session-name.js` | 130, 84 | The other two dual-registered `HOOK_SCRIPTS` (post-mortem context, see `task-queue`; `113`'s deterministic session names, see `maestro-architecture`). Both are in `HOOK_REGISTRATIONS` and renamed `.cjs` on copy. |
| `plugins/maestro/scripts/maestro-human-review-gate.js` | 55 | `130`'s `PreToolUse` hook, matcher `AskUserQuestion|SendMessage` since `132` (see `task-queue`, `maestro-architecture`); an install moves an entry still on the old `AskUserQuestion` matcher (`updateHookMatchers`). A `HOOK_SCRIPTS` entry renamed `.cjs` on copy and a `HOOK_REGISTRATIONS` entry, dual-registered with the plugin's `hooks.json`; like the other dual-registered hooks the plugin copy stands down (`projectOwnsHook`) when the project registers it. |
| `plugins/maestro/scripts/maestro-epic.cjs`, `maestro-workflow-spec.cjs`, `maestro-resume-target.cjs` | — | Orchestrator- or skill-invoked `STATIC_ASSETS` (`084`, `063`, `039`), not hooks. |
| `plugins/maestro/scripts/maestro-sandbox-allow.cjs` | 314 | Not part of the install: the sandbox allow-list the `maestro-install`/`maestro-update` skills dry-run (install step 5; update step 1, run before the installer since its versioned `excludedCommands` entry goes stale on a plugin update) and `maestro-uninstall` `--remove`s. Writes only `.claude/settings.local.json`, and only when the **user** runs the printed `applyCommand` — never the session. `--herdr` (`127`) is an explicit opt-in adding herdr's socket (`allowWrite`; `allowUnixSockets` unless `allowAllUnixSockets` is effectively `true`) and a herdr binary under `$HOME` (`allowRead`). The JSON's `herdr.present` is true when every herdr entry is already in settings (a hand-written `~/...` and the absolute `$HOME/...` count as one entry); the skills decide the opt-in question from it, not from `upToDate`, which a plugin update makes false. `herdr.inUse` is true when any of `socketExists` (the socket is visible to the sandboxed script), `herdrEnv` (`HERDR_ENV=1`) or `settingsEntries` (`[{file,kind,value}]`, herdr entries already in settings) holds; the skills read it instead of `command -v herdr`, which fails under the sandbox because the binary is hidden unless `allowRead` lists it, so a failed `command -v` is never "not installed" — they print that herdr is running but the sandbox can't see it, with the `--herdr` apply command. `herdr.unparseableSettings` (`[{file,error}]`) lists settings files that exist but do not parse; `allowAllUnixSockets` reads as unset from them. Plain `--apply` leaves earlier herdr entries alone; plain `--remove` takes them too; `--remove --herdr` takes only them. |
| `plugins/maestro/hooks/hooks.json` | — | **One-for-one with `HOOK_REGISTRATIONS`.** `maestro-channel-write-guard.js` (`PreToolUse`, `Write\|Edit\|MultiEdit\|NotebookEdit`) was plugin-only until `121`; it is now a `HOOK_SCRIPTS` entry and registered by the install too (`CHANNEL_GUARD_MATCHER`). Unlike the other dual-registered hooks its plugin copy does **not** stand down (`122`; fail-closed confinement hook). |
| `plugins/maestro/skills/maestro-{install,update,uninstall}/` | 369   | The published skills that drive the terminal path (184 + 100 + 85).                           |

Supporting: `config-usable.ts` (`maestroConfigRefusal`, `096`; re-exported by
`plugin-entries/maestro-seed.ts`), `skill-regions.ts` (managed-region sync), `render.ts` (the
HANDOFFS table), `seed.ts` (`defaultV3Config`), `detect.ts`, `report-sync.ts`, and — since `033` — `handoff-sync.ts`
(`syncProjectHandoffs`, run right after `syncProjectReports`, and the **third** caller of
`decideSync`). Test: `test/core/install.test.ts`, `test/core/uninstall.test.ts`,
`test/core/hook-arbitration.test.ts`, `test/core/handoffs.test.ts`, `test/core/parity.test.ts`,
`test/core/install-unusable-config.test.ts` (both paths), `test/renderer/install-report-card.test.ts`.

## Things that bite

- **The hook scripts are renamed `.js` → `.cjs` on copy**, and it is load-bearing: inside a project
  under `"type": "module"` node parses their `require()` as ESM and **fails the hook on every tool
  call**. Adding a script to `HOOK_SCRIPTS` gets the rename; adding one to `STATIC_ASSETS` does not.
  See the manifest sub-concept.
- **A registration decides which copy of the hook runs**, not just whether the project is installed.
  The plugin's copy stands down for exactly the hooks the project registers, so removing a
  registration hands that hook back to the plugin rather than turning it off. Read the
  hook-arbitration sub-concept before changing `HOOK_REGISTRATIONS` or how `hasHook()` matches. A
  hook the plugin registers that is not in `HOOK_REGISTRATIONS` would have no project copy to
  arbitrate and always run from the plugin; none exists today — `maestro-channel-write-guard.js` was
  the last, closed by `121`. (It is also registered by the install, but deliberately never stands
  down — `122`.) Keep `hooks.json` and `HOOK_REGISTRATIONS` identical.
- **The install writes HOOKS into `settings.json` and exactly one permission rule.** `032` kept its
  grant out of settings (the orchestrator template's `allowed-tools`). The one exception is `139`'s
  `Write(/.claude/channels/**)` in `permissions.allow` (`addChannelAllowRule`, both installers,
  idempotent), added because a skill's `allowed-tools` cannot cover a subagent's writes. Do not add
  a second rule without the same argument. See the manifest sub-concept.
- **The skills must run `maestro-install.js` unquoted, on one line:**
  `node ${CLAUDE_PLUGIN_ROOT}/scripts/maestro-install.js . …` (`127`). The allow-list's
  `excludedCommands` entry (`node <plugin>/scripts/maestro-install.js *`) matches the literal command
  text, so the old quoted `"${CLAUDE_SKILL_DIR}/../../scripts/…"` form, or a `\` line break, runs
  sandboxed and fails with `EPERM` on `.claude/settings.json` / `.claude/skills/`.
- **A script dropped from the manifest must be listed in `RETIRED_HOOK_SCRIPTS`.** Removing it from
  `HOOK_REGISTRATIONS`/`runtimeAssets` only stops new installs getting it; an already-installed
  project keeps the `settings.json` entry and the file, firing at a script nothing refreshes. Install
  removes both (`hooksRemoved`, `retiredScriptsRemoved`) and uninstall still recognises the name.
  `bash-validation.sh` (the old secrets-file read guard) is the first entry.
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
  never overwritten — by install, re-install, or refresh. An existing but corrupt or non-v3 one is
  *refused* (`096`), not treated as absent: do not "fix" that by falling back to the seed.
- **A lib a copied script `require`s must be in `STATIC_ASSETS`, and forgetting one fails silently
  (`035`).** Every sqlite `require` sits inside a try/catch, so a missing lib is swallowed and the
  tier it backed stops existing — for projects on their own copy only, while the plugin's copy keeps
  answering from the marketplace cache. `install.test.ts` now scans for this. See the manifest
  sub-concept.
- **Changing the asset list makes every installed project stale exactly once.** `031` added two,
  `032` one, `033` **removed ~23**, `035` two, `046` one, and more since (`063`, `084`, `089`, `113`;
  the manifest is 31 files now, 12 scripts + 9 libs + the cleanup + 9 hook scripts; `121` added the channel guard) — `shippedRuntimeId` moved each time and
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
