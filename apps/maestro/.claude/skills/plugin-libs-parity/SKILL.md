---
name: plugin-libs-parity
description: "Explains how src/core reaches the plugin's hook scripts: build-plugin-libs.mjs bundles the eleven plugin-entries modules into committed CJS under plugins/maestro/scripts/lib, why those bundles are committed rather than built at install time, why the build pins its working directory and tsconfig, why each bundle's export surface must stay a superset of what the hook scripts require(), and why maestro-tasks.cjs is the one hand-maintained exception, and which two bundles must stay free of node:sqlite so their hooks still work on an old node. Use before shipping any change to a src/core module a hook depends on, when an edit to src/core isn't reaching a hook, when git diff shows a spurious bundle diff, or when a bundle silently came out non-strict."
metadata:
  type: concept-skill
  version: "1.6"
  last-update: 7d9972492e8941ebabb500dda544ddd621eb29a6
---

# Core ↔ plugin parity

Some logic is needed by **both** the desktop app and the standalone scripts the plugin ships — and
those scripts run under bare `node` with no `node_modules`, sometimes after being copied into a
project's `.claude/scripts/`. They cannot import from this workspace. Rather than maintain two
implementations that silently drift, `apps/maestro/src/core` is the source and
`plugins/maestro/scripts/lib/*.cjs` are **generated, committed** bundles.

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

## The export surface is a superset, not an identity

Each bundle's export list must stay a **superset** of what the hook scripts `require()` — adding an
export is safe, renaming or removing one breaks a script that runs outside this workspace (from the
marketplace cache, or from a copy inside someone else's project). `test/core/parity.test.ts` asserts
the original name list is still all there, not that the lists match exactly. `maestro-session.ts`
grew `projectOwnsHook` this way, which is how the hook-arbitration guard reaches the plugin's hook
scripts at all.

## The eleven generated entries

`maestro-session`, `maestro-skill-regions`, `maestro-seed`, `maestro-skill-tags`,
`maestro-report-defaults`, `maestro-project-tags`, `maestro-agent-project-tags`,
`maestro-agent-types`, `maestro-concept-skills`, `maestro-agent-sync` (`031`),
`maestro-handoff-defaults` (`033`).

**Five of the eleven are also COPIED into projects, which widens what a rename breaks (`035`).** A
bundle runs from the marketplace cache *and*, if it is in `install.ts`'s `STATIC_ASSETS`, from
`<project>/.claude/scripts/lib/` — where the copy is a snapshot that only a re-install refreshes.
The copied set is `maestro-session`, `maestro-skill-regions`, `maestro-agent-sync`, and — since
`035` — `maestro-report-defaults` and `maestro-handoff-defaults` (plus the hand-maintained
`maestro-tasks.cjs`). So removing or renaming an export from one of those breaks two populations
with different clocks: the cache re-pulls on a `plugin.json` version bump, the project copies do
not move until someone re-installs. See `installing-maestro`'s manifest sub-concept for the rule
the copied list answers to, and why a lib missing from it fails silently.

**`maestro-agent-sync` must not pull in `node:sqlite`.** It backs
**two** callers, both running under whatever bare `node` is on the session's PATH:
`plugins/maestro/scripts/maestro-agent-forks.cjs` (the user-facing CLI, driven by `/maestro-update`)
and `plugins/maestro/scripts/maestro-step0.js`, the readiness hook, which `require`s
`computeAgentSync` out of the bundle directly rather than spawning the CLI. Its source (`agent-sync.ts`) therefore imports
`agent-fork-record.ts` and never `agent-fork.ts` — the latter reaches three sqlite stores through
`copyAgentAttributeRows`, which is exactly why `031` split the file (see `global-stores`). The
check is `grep -c "node:sqlite" plugins/maestro/scripts/lib/maestro-agent-sync.cjs` → `0`. Nothing
fails if it stops being 0; the script just starts throwing on machines with an older `node`.

**`maestro-session` must not pull in `node:sqlite` either (`033`).** It is the bundle every hook
`require`s **unconditionally**, and since `033` it carries the handoff seed tier (`SEED_HANDOFFS`,
`isSeededHandoff`, `isValidHandoffId`) plus the pure route walk (`handoffRoutes`, `routesFrom`,
`handoffPairs`) and `resolveHandoff`. Since `036` it also carries the agent-channel surface
(`channelDir`, `laneFor`, `writeStamp`, `readLane`, `retire`, `sweep`, `formatStampedContent`/
`parseStampedContent`, `CHANNEL_AGE_CAP_MS`) and `ensureSessionRunId` — re-exported here rather than
given a 12th bundle, since `handoff-channels.ts` is `fs`/`path` only and every hook already
`require`s this one. The sqlite tier is a **separate** bundle,
`maestro-handoff-defaults`, which `maestro-inject-agent-context.js` `require`s inside a try/catch —
so on a `node` older than 22.5 the sqlite `require` fails and the seed still answers. That only
holds while `grep -c "node:sqlite" plugins/maestro/scripts/lib/maestro-session.cjs` is `0`. The
trap: `handoff-seeds.ts` imports **nothing**, and adding one store import to it moves 23 protocol
bodies behind a `node` version check without failing a single test.

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
| `apps/maestro/src/core/plugin-entries/*.ts`    | The eleven entry points — thin re-exports of `src/core`. |
| `plugins/maestro/scripts/lib/*.cjs`            | Committed output, banner-marked `DO NOT EDIT`.          |
| `apps/maestro/test/core/parity.test.ts`        | Differential test against snapshotted legacy CJS.       |
| `apps/maestro/test/core/avatar-parity.test.ts` | Same, for the avatar store.                             |

The parity tests compare against **snapshots** under `test/fixtures/legacy/`, deliberately not
against the live `plugins/maestro/scripts/lib/` files — the build overwrites those, so comparing
against them would go tautological the moment the build runs.

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

- [Plugin entries](sub-concepts/plugin-entries.md) — what an entry point may and may not pull in.
- [Parity tests](sub-concepts/parity-tests.md) — the snapshot baseline and why it is not the live file.
