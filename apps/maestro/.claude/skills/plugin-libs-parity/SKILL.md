---
name: plugin-libs-parity
description: "Explains how src/core reaches the plugin's hook scripts: build-plugin-libs.mjs bundles the twelve plugin-entries modules into committed CJS under plugins/maestro/scripts/lib, why those bundles are committed rather than built at install time, why the build pins its working directory and tsconfig, why each bundle's export surface must stay a superset of what the hook scripts require(), and why maestro-tasks.cjs is the one hand-maintained exception, and which two bundles must stay free of node:sqlite so their hooks still work on an old node. Use before shipping any change to a src/core module a hook depends on, when an edit to src/core isn't reaching a hook, when git diff shows a spurious bundle diff, or when a bundle silently came out non-strict."
metadata:
  type: concept-skill
  version: "1.11"
  last-update: e583e25c831728794f633d2a502f67e60dcf1f0d
---

# Core ↔ plugin parity

Some logic is needed by **both** the desktop app and the standalone scripts the plugin ships — and
those scripts run under bare `node` with no `node_modules`, sometimes after being copied into a
project's `.claude/scripts/`. They cannot import from this workspace, and there is no build step
where they run, which is why `plugins/maestro/scripts/lib/*.cjs` are **generated and committed**
bundles rather than built at install time. `apps/maestro/src/core` is the source.

```
src/core/*.ts  →  src/core/plugin-entries/<name>.ts  →  esbuild  →  plugins/maestro/scripts/lib/<name>.cjs
```

Regenerate with `pnpm --filter maestro build:plugin-libs`.

## This fails quietly — the single most important fact here

The build script's own header says it: **if it stops producing correct output, the committed `.cjs`
files keep working and every test keeps passing.** The symptom is not a red suite; it is an edit to
a source module that stops reaching the plugin while the hooks go on running the old behaviour.

So after changing anything in `plugin-entries/` or in a `src/core` module one of them pulls in,
re-run the build and **read `git diff plugins/maestro/scripts/lib/`** rather than trusting green
tests. The root `CLAUDE.md` states the same rule.

**`contracts.ts` counts as "a module one of them pulls in", even though no `plugin-entries/*.ts`
imports it directly (`045`).** Several entries import a `src/core` module that in turn imports a
type or a value export (`EDITABLE_AGENT_SOURCES` and friends) from it. So **a commit that touches
`contracts.ts` needs `build:plugin-libs`**, whether or not it touches `plugin-entries/*.ts` — easy
to miss precisely because the diff that triggers it never touches `plugin-entries/` at all.

Three recorded instances of this one failure, each worse than the last:

- **`045`** — `maestro-agent-sync`, `maestro-agent-types` and `maestro-skill-tags` were already stale
  against `contracts.ts` before that task's own edits, most likely from an earlier commit that
  touched `contracts.ts` without re-running the build. No symptom at all; it sat unnoticed.
- **`053`** — `052` landed the `infra`-only seed profile (`isInfraOnlyChain`/`buildInfraWorkflow`, a
  chain-dependent `seededAgentNames()` in `seed.ts`, the `infra` category in `detect.ts`, plus the
  stores six other entries pull from) without rebuilding. `lib/maestro-seed.cjs` and six siblings
  kept exporting pre-`052` behaviour, so the terminal install path (`maestro-install.js`, which
  `require`s them) seeded the old six-workflow graph for an infrastructure repo while the app's
  `defaultV3Config` seeded the new three-workflow one. Every test green; found a task later.
- **`066`** — `CLAIM_IDLE_CAP_MS` was added to `handoff-channels.ts` and re-exported from
  `maestro-session`, but both `plugins/maestro/scripts/lib/maestro-session.cjs` and
  `.claude/scripts/lib/maestro-session.cjs` were committed without a rebuild. This one didn't keep
  old behaviour, it silently disabled the feature the commit shipped: `maestro-task-status.cjs`
  destructures `CLAIM_IDLE_CAP_MS` out of that bundle, got `undefined`, and `isSessionLive`'s
  `now - mtime <= undefined` is `false` for every claim — the shipped CLI could create a claim but
  never see one as live. Only `test/core/task-claims-cli.test.ts`'s 3 failures signalled it, caught
  only because @reviewer ran the suite against the committed diff rather than the implementer's own
  green run. Fixed by rebuilding **and** mirroring the `.claude/scripts/lib/` copy by hand.


## The export surface is a superset, not an identity

Each bundle's export list must stay a **superset** of what the hook scripts `require()` — adding an
export is safe, renaming or removing one breaks a script that runs outside this workspace (from the
marketplace cache, or from a copy inside someone else's project). `test/core/parity.test.ts` asserts
the original name list is still all there, not that the lists match exactly. `maestro-session.ts`
grew `projectOwnsHook` this way, which is how the hook-arbitration guard reaches the plugin's hook
scripts at all.

**A name kept but given a different ARITY is the break the superset rule does not catch, and `064`
produced one.** `sessionLogPath` went from `(claudeDir)` to `(claudeDir, sessionId)`: the export is
still there, the name list still passes, and an old caller passing one argument now gets `null`
(`sessionPathsFor` rejects `undefined` as a session id) rather than a `TypeError` — a silent wrong
answer instead of a crash. When you must change a signature in a bundle, grep the `.js`/`.cjs` hook
scripts for the name across `plugins/maestro/scripts/` rather than trusting the export assertion.

Related, same task: `SESSION_LOG_FILE` is now an alias for `SESSION_LOG_NAME` with **no live
callers** — retained solely because this rule forbids removing it. An export you find with no
callers is probably load-bearing for exactly that reason; check before deleting it.

## The twelve generated entries

`maestro-session`, `maestro-skill-regions`, `maestro-seed`, `maestro-skill-tags`,
`maestro-report-defaults`, `maestro-project-tags`, `maestro-agent-project-tags`,
`maestro-agent-types`, `maestro-concept-skills`, `maestro-agent-sync` (`031`),
`maestro-handoff-defaults` (`033`), `maestro-workflow-spec` (`063`).

Each `apps/maestro/src/core/plugin-entries/<name>.ts` is a thin re-export naming exactly what the
plugin's scripts need from `src/core`, mapping 1:1 to a `.cjs` in `plugins/maestro/scripts/lib/`.
The list is hard-coded in the `entries` array in `build-plugin-libs.mjs`, so adding an entry means
editing that array as well as creating the file. The constraint an entry inherits: everything it
pulls in must run under bare `node` with no `node_modules` and no Electron. Node built-ins stay
external (`node:fs`, `node:path`, `node:os`, `node:sqlite`, and their bare aliases); anything else
it imports is inlined into the bundle. Reaching into a module that touches Electron, the Agent SDK
or a third-party dependency is how an entry stops being buildable — or worse, builds and fails at
hook time in a project with no dependencies installed.

**Six of the twelve are also COPIED into projects, which widens what a rename breaks (`035`).** A
bundle runs from the marketplace cache *and*, if it is in `install.ts`'s `STATIC_ASSETS`, from
`<project>/.claude/scripts/lib/` — where the copy is a snapshot that only a re-install refreshes.
The copied set is `maestro-session`, `maestro-skill-regions`, `maestro-agent-sync`,
`maestro-report-defaults` and `maestro-handoff-defaults` (since `035`), and — since `063` —
`maestro-workflow-spec`, which backs the `maestro-workflow-spec.cjs` CLI the `create-workflow`/
`update-workflow` skills invoke directly (plus the hand-maintained `maestro-tasks.cjs`). So removing
or renaming an export from one of those breaks two populations with different clocks: the cache
re-pulls on a `plugin.json` version bump, the project copies do not move until someone re-installs.
See `installing-maestro`'s manifest sub-concept for the rule the copied list answers to, and why a
lib missing from it fails silently.

**`maestro-agent-sync` must not pull in `node:sqlite`.** It backs **two** callers, both running
under whatever bare `node` is on the session's PATH: `plugins/maestro/scripts/maestro-agent-forks.cjs`
(the user-facing CLI, driven by `/maestro-update`) and `plugins/maestro/scripts/maestro-step0.js`,
the readiness hook, which `require`s `computeAgentSync` out of the bundle directly rather than
spawning the CLI. Its source (`agent-sync.ts`) therefore imports `agent-fork-record.ts` and never
`agent-fork.ts` — the latter reaches three sqlite stores through `copyAgentAttributeRows`, which is
exactly why `031` split the file (see `global-stores`). The check is
`grep -c "node:sqlite" plugins/maestro/scripts/lib/maestro-agent-sync.cjs` → `0`. Nothing fails if
it stops being 0; the script just starts throwing on machines with an older `node`.

**`maestro-session` must not pull in `node:sqlite` either (`033`).** It is the bundle every hook
`require`s **unconditionally**, and it has now absorbed three surfaces on the same "it's `fs`/`path`
only and every hook already requires this bundle" argument:

- `033` — the handoff seed tier (`SEED_HANDOFFS`, `isSeededHandoff`, `isValidHandoffId`), the pure
  route walk (`handoffRoutes`, `routesFrom`, `handoffPairs`) and `resolveHandoff`.
- `036` — the agent-channel surface from `handoff-channels.ts` (`channelDir`, `laneFor`,
  `writeStamp`, `readLane`, `retire`, `sweep`, `formatStampedContent`/`parseStampedContent`,
  `CHANNEL_AGE_CAP_MS`) and `ensureSessionRunId`, re-exported here rather than given a 13th bundle;
  `066` added `CLAIM_IDLE_CAP_MS`, the claims subsystem's mtime cap, to the same list.
- `064` — all of `session-paths.ts` (`resolveSessionId`, `isValidSessionId`, `sessionPathsFor`,
  `resolveSessionPaths`, `ensureSessionPaths`, `ensureSessionsRoot`, `listSessionIds`,
  `removeSessionState`, `LEGACY_SESSION_FILES`, `SESSIONS_DIR_NAME`).

The argument is sound every time, and it is also how a bundle acquires a sqlite import by accident.
Re-run `grep -c "node:sqlite" plugins/maestro/scripts/lib/maestro-session.cjs` → `0` after any
addition. The sqlite tier is a **separate** bundle, `maestro-handoff-defaults`, which
`maestro-inject-agent-context.js` `require`s inside a try/catch — so on a `node` older than 22.5 the
sqlite `require` fails and the seed still answers. The trap: `handoff-seeds.ts` imports **nothing**,
and adding one store import to it moves 23 protocol bodies behind a `node` version check without
failing a single test.

**`maestro-workflow-spec` carries no `node:sqlite`-free requirement of its own.** It is `require`d
only by the standalone `maestro-workflow-spec.cjs` CLI, which has no try/catch degrade path at all —
a missing or throwing `require` fails it outright regardless of cause. It happens to pull in no
`node:sqlite` (`workflow-spec.ts` only reaches `config.ts`, `success-path.ts` and `seed.ts`'s layout
helpers), but that is incidental, not an invariant.

**`maestro-tasks.cjs` is not generated.** It has no entry in `plugin-entries/` and is hand-maintained
alongside `src/core/tasks.ts`, kept in sync so a task close from the UI and one from the orchestrator
cannot disagree about which tasks are ready. Editing `tasks.ts` alone is not enough.

## Why the build is so specific

- **`absWorkingDir` is pinned to the app root.** esbuild stamps a `// <path>` comment above each
  bundled module _relative to its working directory_, so the bundle's bytes depend on where the
  build was launched. Without the pin, `pnpm --filter maestro build:plugin-libs` and
  `node apps/maestro/scripts/build-plugin-libs.mjs` from the repo root produce a spurious diff.
- **`tsconfig` is pinned to `tsconfig.node.json`.** esbuild otherwise walks up for one, and `strict`
  there is what makes it emit `"use strict";`. A previous move changed which file that walk found and
  the bundles silently came out non-strict — nothing failed, the hooks just stopped throwing on the
  assignments strict mode catches.
- **Node built-ins stay `external`.** In particular `node:sqlite`: keeping the `require()` in the
  output is what lets `maestro-skill-tags.cjs` degrade gracefully on an older `node` on the session's
  PATH, since the script's own try/catch can catch it. An inlined shim would throw at a different,
  harder-to-catch point.

## Files

| File                                           | Role                                                    |
| ---------------------------------------------- | ------------------------------------------------------- |
| `apps/maestro/scripts/build-plugin-libs.mjs`   | The generator. Carries the reasoning above in comments. |
| `apps/maestro/src/core/plugin-entries/*.ts`    | The twelve entry points — thin re-exports of `src/core`. |
| `plugins/maestro/scripts/lib/*.cjs`            | Committed output, banner-marked `DO NOT EDIT`.          |
| `apps/maestro/test/core/parity.test.ts`        | Differential test against snapshotted legacy CJS.       |
| `apps/maestro/test/core/avatar-parity.test.ts` | Same, for the avatar store.                             |

## Relationships

- [`agent-fork-sync`](../agent-fork-sync/SKILL.md) — what `maestro-agent-sync` carries, and why it
  must stay free of `node:sqlite`.
- [`global-stores`](../global-stores/SKILL.md) — five of the generated entries are its stores, and
  the two splits (`031`'s `agent-fork-record.ts`, `033`'s `handoff-seeds.ts`) that keep the bundles
  above free of them.
- [`agents-view`](../agents-view/SKILL.md) — what `maestro-agent-sync` computes, and the app-side
  surface that shares the verdict with the CLI.
- [`maestro-config-model`](../maestro-config-model/SKILL.md) — `maestro-session` and
  `maestro-skill-regions` read and rewrite what it defines.
- `maestro-architecture` and `updating-maestro` (at the repo root `.claude/skills`) — the hooks
  that consume these bundles, and the _other_ staleness problem (delivery, not generation).
- `installing-maestro`'s **hook arbitration** sub-concept — `projectOwnsHook` ships through the
  `maestro-session` bundle, so editing `hook-arbitration.ts` without re-running the build leaves the
  plugin's hooks arbitrating with the old rule.

## Sub-concepts

- [Parity tests](sub-concepts/parity-tests.md) — the snapshot baseline, why it is not the live file,
  and the user-visible strings it freezes byte for byte.
