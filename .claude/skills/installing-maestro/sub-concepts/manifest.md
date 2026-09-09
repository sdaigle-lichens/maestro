# The manifest

What an install writes, in two lists that both implementations mirror by hand: `STATIC_ASSETS`
(the files) and `HOOK_REGISTRATIONS` (the settings entries). Since `033` there is no second file
list — `handoffAssets()` is deleted and `runtimeAssets()` returns `STATIC_ASSETS` alone.

## Files — `runtimeAssets()`

Everything lands under `<project>/.claude/`. Three groups — 20 files:

| Group                                               | Destination                        | Note                                                                                                          |
| --------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Scripts the orchestrator, a hook, or the app invokes | `.claude/scripts/*.cjs`           | `maestro-set-session-workflow`, `maestro-render-orchestrator`, `maestro-task-status`, `maestro-check-runtime` (`require`d by the `maestro-step0` hook), `maestro-agent-forks` (`031`), `maestro-step1-gates` (`032`), `maestro-step4-gate` (`046`) |
| Shared libs the copied scripts `require("./lib/…")` | `.claude/scripts/lib/*.cjs`        | `maestro-session`, `maestro-tasks`, `maestro-skill-regions`, `maestro-agent-sync` (`031`), `maestro-report-defaults` + `maestro-handoff-defaults` (`035`) |
| Hook scripts                                        | `.claude/scripts/*.cjs`            | **renamed from `.js`** — see below                                                                            |

Plus `bash-validation.sh`, the one asset copied **executable** (`0o755`) because its hook runs it as
a bare command rather than through `node`.

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
caught exception. (`install.ts`'s comment on the shared-libs block says this test lives in
`parity.test.ts` — it does not; flagged, not edited here.)

**The `.js` → `.cjs` rename is load-bearing.** The six `HOOK_SCRIPTS`
(`maestro-inject-agent-context`, `maestro-subagent-log`, `maestro-session-log`,
`maestro-validate-tasks`, `maestro-step0`, `maestro-enable-task-routing` (`047`)) keep `.js` in the plugin, whose directory has no `package.json` declaring
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
from ~37 to 17 (19 since `035`, 20 since `046`), and adding a handoff pair no longer touches
`shippedRuntimeId` — it is a seed edit plus a `build:plugin-libs`.

**`032` added one more `STATIC_ASSET`: `maestro-step1-gates.cjs`.** It is the only copied asset run
by the **harness** rather than by a hook or by the model — the orchestrator's Step 1 names it in a
`` !`command` `` line, and Claude Code substitutes its stdout into the skill body before the model
reads it. Two manifest consequences: `shippedRuntimeId` moved again, so every installed project
reported stale once and re-copied; and a project **missing** it does not degrade but loses
`/maestro` outright (`node` on an absent file exits 1, and a non-zero exit aborts the invocation),
which is why `maestro-check-runtime.cjs` grew a presence check over it — see the staleness
sub-concept.

**`046` added a sibling, `maestro-step4-gate.cjs`, same shape.** Same harness-invoked,
exit-0-unconditional, one-line-of-stdout contract, resolving `use_maestro_tasks` instead of `gates`
and injected by Step 4 instead of Step 1. `maestro-check-runtime.cjs`'s `SKILL_INVOKED_SCRIPTS`
gained it too, for the same fatal-if-missing reason.

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
It is also the one hook script with **no arbitration guard**: both copies just `rm -f` the same three
ephemeral files, so a double fire is unobservable (see the hook-arbitration sub-concept).

> `install.ts`'s asset-manifest comment (around line 155) still claims the `.sh` "also tears down
> the per-project web-app container". That is stale — flagged, not edited here.

## Hooks — `HOOK_REGISTRATIONS`

Eleven entries (`047`; nine before it), written into the project's `.claude/settings.json`,
mirroring the plugin's `hooks.json` one-for-one:

| Event                 | Matcher      | Script                             |
| --------------------- | ------------ | ---------------------------------- |
| `UserPromptExpansion` | `maestro`    | `maestro-step0.cjs`                |
| `PreToolUse`          | `Skill`      | `maestro-step0.cjs`                |
| `UserPromptExpansion` | `to-maestro-tasks` | `maestro-enable-task-routing.cjs` (`047`) |
| `PreToolUse`          | `Skill`      | `maestro-enable-task-routing.cjs` (`047`) |
| `SubagentStart` | `.*`         | `maestro-inject-agent-context.cjs` |
| `SubagentStart` | `.*`         | `maestro-subagent-log.cjs`         |
| `SubagentStop`  | `.*`         | `maestro-subagent-log.cjs`         |
| `PreToolUse`    | `.*`         | `maestro-session-log.cjs`          |
| `PreToolUse`    | `Bash`       | `bash-validation.sh`               |
| `PostToolUse`   | `TaskCreate` | `maestro-validate-tasks.cjs`       |
| `SessionEnd`    | _(none)_     | `maestro-session-cleanup.cjs`      |

`id` is `<Event>:<script>`, unique because now **three** scripts are registered on two events each
(`maestro-subagent-log` on SubagentStart/Stop, `maestro-step0` and, since `047`,
`maestro-enable-task-routing` on the two entrances to a skill invocation — a typed slash command, and
a `Skill` tool call — each keyed by its own matcher on `UserPromptExpansion` but **sharing** the
`Skill` matcher on `PreToolUse` with `maestro-step0`, two commands under one matcher block). **`SubagentStop`
is included even though the plan lists four events** — without it the session log has dispatch
entries with no matching handoff and `/session-log` renders half a conversation.

Two properties of how they are written:

- **Idempotency keys on the basename**, not the exact command: users re-quote paths, and a second
  entry differing only by quoting fires the hook twice.
- **An existing entry for the same matcher is reused** rather than a second one added, so a user's
  own `Bash` hook and Maestro's live side by side under one matcher.

`bash-validation.sh`'s command is written **unquoted and un-prefixed**, byte-for-byte as the legacy
installer wrote it, because `maestro-uninstall.js` removes it by exact string match.

**`hooks` is the only key either implementation writes into `settings.json`.** No `permissions`
block, no `env`, no `model` — and `032` is the change that had the strongest reason to break that
and did not. It needed a permission grant for the command Step 1 injects (an injected command whose
check answers anything but `allow` aborts the invocation), and put it in the orchestrator
**template's frontmatter** as `allowed-tools` instead. That keeps the installer out of a block users
hand-edit, and keeps uninstall's removal list to hook entries: the grant lives in the skill file and
leaves with it under `--purge`. See the uninstall sub-concept for what that removal list is.

## The other two writes

**`.gitignore` at the repo root** (found via `git rev-parse --show-toplevel`) gets a `# Maestro`
section with three `**/.claude/maestro_session*` entries plus, since `036`, `**/.claude/channels/`.
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

**`--project-tags` is no longer freely-picked (`055`).** The `maestro-install` skill's Step 2
computes which of step 1's detected `implAgents` are already catalog entries and pre-selects
exactly those — the question only has to be answered to *remove* one, not to re-derive the set from
scratch — and, when a detected category has no matching catalog entry at all, offers to add it via
`addProjectTag` (a new export off `project-tags.ts`, alongside the pre-existing `readAllProjectTags`
read) before assembling the flag. `maestro-install.js` itself still only reads and intersects the
catalog — unchanged. The app's own `installRuntime()` path has no equivalent prompt: it silently
intersects `detection.implAgents` against the catalog with no consent step and no way to propose an
uncataloged category, which is the same silent-drop gap the terminal skill used to have, still open
on that side.

`runtimeVersion` is stamped **last**, after the files it describes are current on disk.

Files: `apps/maestro/src/core/install.ts` (`STATIC_ASSETS`, `HOOK_SCRIPTS`, `runtimeAssets`,
`HOOK_REGISTRATIONS`), `apps/maestro/src/core/handoff-sync.ts` (the handoff half, which is a sync
rather than a manifest entry), `plugins/maestro/scripts/maestro-install.js` (the mirror of both).
