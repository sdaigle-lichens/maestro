# The manifest

What an install writes, in two lists that both implementations mirror by hand: `STATIC_ASSETS`
(the files) and `HOOK_REGISTRATIONS` (the settings entries). Since `033` there is no second file
list — `handoffAssets()` is deleted and `runtimeAssets()` returns `STATIC_ASSETS` alone.

## Files — `runtimeAssets()`

Everything lands under `<project>/.claude/`. Three groups, **30 files** today: 12 scripts, 9 libs,
`maestro-session-cleanup.cjs`, and the 8 `HOOK_SCRIPTS` renamed `.cjs`. (`084` added
`scripts/maestro-epic.cjs` and `scripts/lib/maestro-epic.cjs`; `113` added `maestro-session-name`, and
the post-mortem hook joined the same list.) `test/core/install.test.ts` and `parity.test.ts` pin the
set; count from `STATIC_ASSETS` in `install.ts`, not from here.

| Group                                               | Destination                        | Note                                                                                                          |
| --------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Scripts the orchestrator, a hook, or the app invokes | `.claude/scripts/*.cjs`           | `maestro-set-session-workflow`, `maestro-render-orchestrator`, `maestro-task-status`, `maestro-check-runtime` (`require`d by the `maestro-step0` hook), `maestro-agent-forks` (`031`), `maestro-step1-gates` (`032`), `maestro-end-skills` (`089`), `maestro-step4-gate` (`046`), `maestro-resume-target` (`039`), `maestro-resolve-skill-path` (`061`), `maestro-workflow-spec` (`063` — the `create-workflow`/`update-workflow` skills' CLI), `maestro-epic` (`084` — epics and the report inbox) |
| Shared libs the copied scripts `require("./lib/…")` | `.claude/scripts/lib/*.cjs`        | `maestro-session`, `maestro-tasks`, `maestro-skill-regions`, `maestro-agent-sync` (`031`), `maestro-report-defaults` + `maestro-handoff-defaults` (`035`), `maestro-workflow-spec` (`063`), `maestro-epic` (`084`), `maestro-skill-lists` (`089`) |
| Hook scripts                                        | `.claude/scripts/*.cjs`            | **renamed from `.js`** — see below                                                                            |

**The shared-libs group is a DEPENDENCY LIST, and it fails silently when it is wrong (`035`).** The
rule it answers to: *every* `require("./lib/…")` reachable from a copied script must resolve from
`.claude/scripts/` — including the ones written inside a try/catch, which is all of the sqlite ones
(`node` < 22.5 has no `node:sqlite`). A lib the manifest forgets throws MODULE_NOT_FOUND, the catch
swallows it, and the tier that require backed just stops existing: nothing logs, nothing fails, and
the **plugin's** copy of the same hook — running from the marketplace cache with the whole `lib/`
beside it — goes on answering, so which copy won the arbitration decides what an agent is told. That
is how `lib/maestro-report-defaults.cjs` was missing for two releases: a project-local
`maestro-inject-agent-context` resolved **no** output format at all for an agent whose report is
only global (reports have no seed tier). `lib/maestro-handoff-defaults.cjs` was missing the same
way, but degraded to `SEED_HANDOFFS` rather than to nothing; it is copied all the same, because the
global row is the tier `/templates`' Handoffs tab writes and a route wired **after** the last
install has no materialized project file to answer from — degrading to the seed there discards the
user's customization.

The audit is now enforced rather than written down: `test/core/install.test.ts` › `installRuntime` ›
*"copies every lib a copied script requires, including the ones inside a try/catch"* reads every
`runtimeAssets()` entry's source, regex-scans for relative `require()` specifiers, resolves each
against the asset's **destination** (the copied layout, not the plugin's), and asserts a manifest
entry copies it. Static rather than a spawn, precisely because the failing branch sits behind a
caught exception.

**The `.js` → `.cjs` rename is load-bearing.** The eight `HOOK_SCRIPTS`
(`maestro-inject-agent-context`, `maestro-subagent-log`, `maestro-session-log`,
`maestro-validate-tasks`, `maestro-step0`, `maestro-enable-task-routing` (`047`),
`maestro-post-mortem-context`, `maestro-session-name` (`113`)) keep `.js` in the plugin, whose directory has no `package.json` declaring
a module type. Inside a project the same file may sit under `"type": "module"`, which makes node
parse their `require()` as ESM and fail the hook **on every tool call**. Scripts already named
`.cjs` in the plugin are copied under their existing names. Add a hook script to the wrong list and
it breaks only in projects that happen to be ESM.

**Handoff protocols left the manifest in `033`.** They used to be a fourth group — the ~23
`templates/handoffs/**.md` files walked off disk into `.claude/templates/handoffs/`, where the
injector's fallback looked. Both the source directory and the destination are gone. What replaces
them is not an asset copy but a **sync**: `syncProjectHandoffs()` materialises
`.claude/handoffs/<sender>/<receiver>.md` for exactly the routes the workflows wire, records
`syncedFrom{version,hash}` in `maestro.json`'s `handoffs` slice, and leaves an edited file alone.
The shipped floor is `SEED_HANDOFFS`, a constant bundled into `lib/maestro-session.cjs`, so it
needs no file on disk to answer. Consequence for this manifest: an install's file count dropped
from ~37 to 17 (30 today after later additions), and adding a handoff pair no longer touches
`shippedRuntimeId` — it is a seed edit plus a `build:plugin-libs`.

**`032` added one more `STATIC_ASSET`: `maestro-step1-gates.cjs`.** It is the only copied asset run
by the **harness** rather than by a hook or by the model — the orchestrator's Step 1 names it in a
the `!`-prefixed command-injection syntax line, and Claude Code substitutes its stdout into the skill body before the model
reads it. Two manifest consequences: `shippedRuntimeId` moved again, so every installed project
reported stale once and re-copied; and a project **missing** it does not degrade but loses
`/maestro` outright (`node` on an absent file exits 1, and a non-zero exit aborts the invocation),
which is why `maestro-check-runtime.cjs` grew a presence check over it — see the staleness
sub-concept.

**`046` added a sibling, `maestro-step4-gate.cjs`, same shape.** Same harness-invoked,
exit-0-unconditional, one-line-of-stdout contract, resolving `use_maestro_tasks` instead of `gates`
and injected by Step 4 instead of Step 1. `maestro-check-runtime.cjs`'s `SKILL_INVOKED_SCRIPTS`
gained it too, for the same fatal-if-missing reason. (That list is five names: the three gates scripts, `maestro-set-session-workflow.cjs` and `maestro-task-status.cjs`.)

**`089` added a script + lib pair, both `STATIC_ASSET`s: `maestro-end-skills.cjs` and
`lib/maestro-skill-lists.cjs`** (the lib backs it and `maestro-step1-gates.cjs`). The end-skills
script is harness-invoked like the Step 1 one, so it is in `SKILL_INVOKED_SCRIPTS` and fatal if
missing. The template's `allowed-tools` also gained its grant, which only a fresh copy delivers —
see `updating-maestro`'s frontmatter trap.

**`063` added a script + lib pair rather than a lone script: `maestro-workflow-spec.cjs` and
`lib/maestro-workflow-spec.cjs`.** Backs the `create-workflow`/`update-workflow` skills, which invoke
the CLI directly (not a hook, not harness-injected) to add or change a workflow in
`.claude/maestro.json` from a compact spec instead of hand-written graph JSON — same
read/mutate/write/re-render shape as `maestro-render-orchestrator.cjs` above. The lib is generated
from `apps/maestro/src/core/workflow-spec.ts` like the other `lib/*.cjs` entries in the row above.

**`047` added a second dual-registered hook, `maestro-enable-task-routing`, same shape as
`maestro-step0`.** It is the writer `046` left unbuilt: fires on `UserPromptExpansion` (matcher
`to-maestro-tasks`) and `PreToolUse` (matcher `Skill`, alongside `maestro-step0`'s own registration
on that same matcher — two commands under one matcher block, like `SubagentStop`'s two-hook shape),
and flips `use_maestro_tasks` to `true` in `.claude/maestro.json` on first invocation. It is a
`HOOK_SCRIPTS` entry (the `.js` → `.cjs` rename applies), not a `STATIC_ASSET`, and adds no new
`STATIC_ASSETS` entry of its own — `shippedRuntimeId` still moves, because the manifest's hook
registrations are part of what it hashes.

**Both of `031`'s additions are `STATIC_ASSETS`, not `HOOK_SCRIPTS`** — they are already `.cjs` in
the plugin and are not hooks, so they are copied under their existing names with no rename. They are
what the fork check is made of: the `maestro-step0` hook `require`s `lib/maestro-agent-sync.cjs`
directly, and `maestro-agent-forks.cjs` is the user-facing CLI `/maestro-update` drives. Adding them
moved `shippedRuntimeId`, so every
already-installed project reports stale once and re-copies; see the staleness sub-concept.

**`maestro-session-cleanup.cjs`, not the plugin's `.sh` of the same name.** The two now do the same
thing — the `.sh`'s container teardown was removed with M5. The project copy is node because the
`.sh` shells out to `python3` to parse the hook payload, which a project cannot assume is installed.
It is also the one hook script with **no arbitration guard**: since `064` both copies call the same
`resolveSessionId` + `removeSessionState` out of `lib/maestro-session.cjs` (the `.sh` shells into
`node -e` to do it), so a double fire is unobservable (see the hook-arbitration sub-concept).

## Hooks — `HOOK_REGISTRATIONS`

Sixteen entries (`113`), written into the project's `.claude/settings.json`. They mirror the
plugin's `hooks.json` **except for the plugin-only `maestro-channel-write-guard.js`**
(`PreToolUse`, `Write|Edit|MultiEdit|NotebookEdit`, `078`/`082`), which is in neither
`HOOK_SCRIPTS` nor `HOOK_REGISTRATIONS` and is never copied into a project — so it has no
arbitration guard and cannot be turned off by a project-local install:

| Event                 | Matcher      | Script                             |
| --------------------- | ------------ | ---------------------------------- |
| `UserPromptExpansion` | `maestro`    | `maestro-step0.cjs`                |
| `PreToolUse`          | `Skill`      | `maestro-step0.cjs`                |
| `UserPromptExpansion` | `to-maestro-tasks` | `maestro-enable-task-routing.cjs` (`047`) |
| `PreToolUse`          | `Skill`      | `maestro-enable-task-routing.cjs` (`047`) |
| `UserPromptExpansion` | `maestro-post-mortem` | `maestro-post-mortem-context.cjs` |
| `PreToolUse`          | `Skill`      | `maestro-post-mortem-context.cjs`  |
| `UserPromptExpansion` | `^(maestro\|(maestro:)?maestro-manager)$` | `maestro-session-name.cjs` (`113`) |
| `PreToolUse`          | `Skill`      | `maestro-session-name.cjs` (`113`) |
| `UserPromptSubmit`    | _(none)_     | `maestro-session-name.cjs` (`113`) |
| `SessionStart`        | _(none)_     | `maestro-session-name.cjs` (`113`) |
| `SubagentStart` | `.*`         | `maestro-inject-agent-context.cjs` |
| `SubagentStart` | `.*`         | `maestro-subagent-log.cjs`         |
| `SubagentStop`  | `.*`         | `maestro-subagent-log.cjs`         |
| `PreToolUse`    | `.*`         | `maestro-session-log.cjs`          |
| `PostToolUse`   | `TaskCreate` | `maestro-validate-tasks.cjs`       |
| `SessionEnd`    | _(none)_     | `maestro-session-cleanup.cjs`      |

`id` is `<Event>:<script>`, unique because a script is registered at most once per event
(`maestro-session-name` on four events since `113`). Several scripts sit on two events each:
(`maestro-subagent-log` on SubagentStart/Stop, `maestro-step0` and, since `047`,
`maestro-enable-task-routing` on the two entrances to a skill invocation — a typed slash command, and
a `Skill` tool call — each keyed by its own matcher on `UserPromptExpansion` but **sharing** the
`Skill` matcher on `PreToolUse` with `maestro-step0`, two commands under one matcher block). **`SubagentStop`
is included even though the plan lists four events** — without it the session log has dispatch
entries with no matching handoff and `/session-log` renders half a conversation.

**`maestro-session-name` has ONE `UserPromptExpansion` entry with a regex matcher** (`113`,
`SESSION_NAME_EXPANSION_MATCHER`), not one per command: `hasHook` keys on event + script, so a
second `UserPromptExpansion` entry for the same script reads as already registered and is never
written. Add another entrance by widening the regex, never by adding a row.

Two properties of how they are written:

- **Idempotency keys on the basename**, not the exact command: users re-quote paths, and a second
  entry differing only by quoting fires the hook twice.
- **An existing entry for the same matcher is reused** rather than a second one added, so a user's
  own `Bash` hook and Maestro's live side by side under one matcher.

**Retired hooks are removed, not just no longer added.** `RETIRED_HOOK_SCRIPTS` (in both
`install.ts` and `maestro-install.js`) names scripts earlier releases registered; every install
strips their `settings.json` entries and deletes the file, and uninstall/purge still match them.
Today that is `bash-validation.sh`.

**`hooks` is the only key either implementation writes into `settings.json`.** No `permissions`
block, no `env`, no `model` — and `032` is the change that had the strongest reason to break that
and did not. It needed a permission grant for the command Step 1 injects (an injected command whose
check answers anything but `allow` aborts the invocation), and put it in the orchestrator
**template's frontmatter** instead:

```
allowed-tools: Bash(node .claude/scripts/maestro-step1-gates.cjs)
```

`allowed-tools` is a **grant, not a restriction** (`disallowed-tools` is the restriction field), so
it does not narrow the orchestrator's own access to `Task`/`TaskCreate`/`Skill`/`Read`. Two things
follow, and both are why it was chosen: the installer stays out of a block users hand-edit and reason
about, and **uninstall gains no new removal logic** — the grant lives in the skill file and leaves
with it under `--purge`. See the uninstall sub-concept for what that removal list is.

Keep it that way: a permissions entry is a claim on the user's project-wide configuration that a hook
registration is not.

## The other two writes

**`.gitignore` at the repo root** (found via `git rev-parse --show-toplevel`) gets a `# Maestro`
section (`GITIGNORE_ENTRIES`, seven lines) with three flat `**/.claude/maestro_session*` entries,
`**/.claude/channels/` since `036`, `**/.claude/maestro_sessions/` since `064`,
`**/.claude/maestro-tasks/claims/` since `066` and `**/.claude/maestro-metrics/` since `080`.
`maestro-install.js` mirrors the list.

> **`GITIGNORE_ENTRIES` is not the mechanism that git-ignores `maestro_sessions/`, and must not be
> read as one.** This list is only ever *appended at install time*, so the new entry reaches a
> project only when someone re-installs — every project installed before `064` would leak the
> directory into git in the meantime. What actually covers them is `ensureSessionsRoot()` in
> `session-paths.ts` writing a `.gitignore` containing `*` into `maestro_sessions/` **as it creates
> the directory**: it ignores the directory's contents and itself, needs no re-install, and works on
> a project that has never heard of this release. The manifest entry is belt-and-braces for new
> installs, in the other direction. Any future ephemeral *directory* should follow this shape rather
> than relying on the manifest alone.

**`066`'s task claims are exactly that next instance.** `**/.claude/maestro-tasks/claims/` joins
`GITIGNORE_ENTRIES` the same way, and `ensureClaimsDir()` (in `claims.ts`, mirrored in
`maestro-task-status.cjs`) writes the directory's own `*` `.gitignore` on first create, the same
mechanism as `ensureSessionsRoot()`. The one difference: it nests under `.claude/maestro-tasks/` —
user-authored, committed content — rather than sitting flush under `.claude/`, which is why
`uninstall.ts`'s removal of it can't just be another `SESSION_FILES` entry; see the
uninstall-and-purge sub-concept.

**`--ignore-mode ignored` (terminal path only) replaces that block.** `maestro-install.js` skips
`ensureRepoRootGitignore` and instead `ensureGitExclude()` appends `.claude/` to the file
`git rev-parse --git-path info/exclude` names (right for worktrees and submodules; created if
missing). It is the run's first write, and is skipped if `git check-ignore -q -- .claude/` already
says yes or the line is present. Refusals happen before any write: an unknown value, or `ignored`
outside a git repo, gives `{ok:false, refused:"ignore-mode", reason}`. Summary adds `ignoreMode`,
`wroteGitExclude`, `gitExcludePath`. Absent flag = `committed`. The line is written under a
`# Maestro (added by maestro-install)` marker. `maestro-uninstall.js --purge` (not a plain
uninstall) removes that marker+line pair and reports `removedGitExclude`; a user's own `.claude/`
line, or one with no marker above it, is never touched. The `.gitignore` block is never removed. The `maestro-install` skill's new step 1 asks the
question (skipped when `.claude/` is already ignored, or outside git).

The leading recursive wildcard matches `.claude/` at **any** depth including the root, so a
monorepo needs no per-package `.gitignore`. Entries are appended only when missing, under a header
added only when missing. The header itself changed wording in `036`, from "removed at SessionEnd"
to "recreated as needed, never committed" — no longer everything under the block is deleted outright
at `SessionEnd`: a channel lane file is only *swept* (retired or aged out), and can survive a
`SessionEnd` on purpose. See `maestro-architecture`'s HANDOFF contract section for why.

**`maestro.json` is seeded only when absent**, from `defaultV3Config(implAgents, skillMap)` — the
_same_ function the app seeds a fresh canvas with, so both paths produce a byte-identical starting
config. The app's version additionally intersects detected impl agents with the live Project Tags
catalog and derives the skill map from the global tag store; the terminal path takes those as
`--impl-agents`, `--skill-map` and `--project-tags` flags, which its skill fills in from a repo
analysis. **All three flags only affect a fresh seed.**

**`--project-tags` is no longer freely-picked (`055`).** The `maestro-install` skill's Step 3
(Step 2 before the committed-or-ignored step was added) computes which of step 2's detected `implAgents` are already catalog entries and pre-selects
exactly those — the question only has to be answered to *remove* one, not to re-derive the set from
scratch — and, when a detected category has no matching catalog entry at all, offers to add it via
`addProjectTag` (a new export off `project-tags.ts`, alongside the pre-existing `readAllProjectTags`
read) before assembling the flag. `maestro-install.js` itself still only reads and intersects the
catalog — unchanged. **The app's own `installRuntime()` path closes the equivalent gap differently**,
because it has no interactive skill in front of it to ask mid-install: the seed reports both
`projectTags` (recorded) and `uncatalogedProjectTags` (detected but not in the catalog) on
`InstallReport.configSeeded`, instead of silently dropping the uncataloged ones. Consent happens
*after* the seed, through a dedicated IPC round trip, `install:accept-uncataloged-project-tag`
(`main/ipc.ts` / `preload/index.ts` / `shared/ipc.ts`), which a renderer `UncatalogedTagsCard`
(`renderer/routes/maestro.tsx`) offers once an install reports uncataloged categories. Accepting
does two writes — adds the tag to the machine-wide catalog **and** unions it into the project's
`project_tags` — through `applyProjectTagsSet`, a helper factored out of the existing
`project:tags:set` handler so both call sites share one writer. Declining or not answering leaves
`project_tags` exactly as seeded. Detection still never reads the catalog either way.

`runtimeVersion` is stamped **last**, after the files it describes are current on disk.

Files: `apps/maestro/src/core/install.ts` (`STATIC_ASSETS`, `HOOK_SCRIPTS`, `runtimeAssets`,
`HOOK_REGISTRATIONS`), `apps/maestro/src/core/handoff-sync.ts` (the handoff half, which is a sync
rather than a manifest entry), `plugins/maestro/scripts/maestro-install.js` (the mirror of both).
