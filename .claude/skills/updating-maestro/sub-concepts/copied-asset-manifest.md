# What recent changes did to the copied set (path 1)

Path 1 delivers by **file copy**, so its manifest — `STATIC_ASSETS` + `HOOK_SCRIPTS`, mirrored by
hand in `install.ts` and `maestro-install.js` — is the list of what a project physically gets.
`031`, `0.4.0`, `032`, `033`, `035`, `046` and `047` each moved it. Seven more files now ride path 1
into every project, and `033` took ~23 away.

| Copied to | From | Why it is copied rather than run from the plugin |
| --- | --- | --- |
| `.claude/scripts/maestro-agent-forks.cjs` | `plugins/maestro/scripts/` | `/maestro-update` invokes it as `$CLAUDE_PROJECT_DIR/.claude/scripts/…`, like every other project-copied script. |
| `.claude/scripts/lib/maestro-agent-sync.cjs` | `plugins/maestro/scripts/lib/` | The generated bundle that CLI requires — and, since `0.4.0`, the `maestro-step0` hook, which calls `computeAgentSync` from it directly. |
| `.claude/scripts/maestro-step0.cjs` (`0.4.0`) | `plugins/maestro/scripts/maestro-step0.js` | A **`HOOK_SCRIPTS`** entry, not a `STATIC_ASSET` — so it gets the `.js` → `.cjs` rename, and it needs its two `settings.json` registrations merged in as well as the file copied. |
| `.claude/scripts/maestro-step1-gates.cjs` (`032`) | `plugins/maestro/scripts/` | A `STATIC_ASSET`. The orchestrator's Step 1 injects it as a `!`-prefixed `node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/maestro-step1-gates.cjs"`, so it must be a project copy like every other `$CLAUDE_PROJECT_DIR` script. **This is the one whose absence is fatal rather than degrading** — see [the frontmatter trap](frontmatter-trap.md). |
| `.claude/scripts/maestro-step4-gate.cjs` (`046`) | `plugins/maestro/scripts/` | A `STATIC_ASSET`, same contract and same fatal-if-missing shape as the Step 1 row above, injected by Step 4 instead. `maestro-check-runtime.cjs`'s `SKILL_INVOKED_SCRIPTS` gained it alongside `maestro-step1-gates.cjs`. |
| `.claude/scripts/maestro-enable-task-routing.cjs` (`047`) | `plugins/maestro/scripts/maestro-enable-task-routing.js` | A **`HOOK_SCRIPTS`** entry, not a `STATIC_ASSET` — the `.js` → `.cjs` rename applies, like `maestro-step0`. Dual-registered on the same two events as `maestro-step0`, with its own matcher on `UserPromptExpansion` and sharing the `Skill` matcher on `PreToolUse`. Injects nothing; its only effect is the `use_maestro_tasks` write. |
| `.claude/scripts/lib/maestro-report-defaults.cjs` + `lib/maestro-handoff-defaults.cjs` (`035`) | `plugins/maestro/scripts/lib/` | `maestro-inject-agent-context` `require`s both, so `.claude/scripts/` has to hold them or the two global sqlite tiers do not exist for a project on its own copy. **This is the one whose absence is invisible rather than fatal**: both requires sit inside a try/catch, so the resolution failure is swallowed and the plugin's copy — which has the whole `lib/` beside it in the cache — goes on answering, making the arbitration winner decide what an agent is told. |

**`033` removed a whole group.** The ~23 `templates/handoffs/**.md` no longer ride path 1 at all:
`handoffAssets()` is deleted and `runtimeAssets()` is `STATIC_ASSETS` alone (17 files, 19 since
`035`). What an install writes in their place is not a copy but a sync —
`.claude/handoffs/<sender>/<receiver>.md`, for exactly the routes the workflows wire, tracked by
`syncedFrom` so a hand-edit survives the next install. The shipped floor rides inside
`lib/maestro-session.cjs` instead, which is path 1's usual trap in a new place: edit
`handoff-seeds.ts` without re-running `build:plugin-libs` and every hook keeps serving the old
protocol, silently.

## Keeping the two manifests in step

Six of the rows are in `STATIC_ASSETS`; `maestro-step0` and `maestro-enable-task-routing` (`047`)
are in `HOOK_SCRIPTS` — in **both** implementations (`install.ts` and `maestro-install.js`). The
manifests are mirrored by hand, so a file added to one and not the other is a bug. Two tests now
catch it:

- since `032`, `test/core/parity.test.ts` asserts the two `STATIC_ASSETS` `src` sets are **equal**;
- since `035`, `test/core/install.test.ts` additionally scans every copied script for relative
  `require()` specifiers and asserts the manifest copies each target, so a lib forgotten in *both*
  lists fails too.

Because the manifest grew, `installedRuntimeId` and `shippedRuntimeId` differ for every
already-installed project: **each one reports stale exactly once and re-copies.** That is this
delivery path working, not a regression.

## Step 0 reaches an installed project only after a re-pull — and since `0.4.0` the trap moved

In `0.3.5` it was prose inside the `Maestro:STEPS` **managed region** of
`templates/maestro/SKILL.md`, re-synced by `/maestro-install` and `/maestro-update`. In `0.4.0`
Step 0 was **deleted from that region entirely** and became the `maestro-step0` hook, so what a
project now needs is the new *script* plus its two new *registrations* in `.claude/settings.json` —
still delivered by the same re-pull-then-update, but no longer anything a template sync could carry
on its own. The failure mode is quieter than `0.3.3`'s: a project that never updates simply gets no
readiness check and **no warning that none happened**, because the template no longer has the
fallback commands in it.
