---
name: plugin-libs-parity
description: "Explains how src/core reaches the plugin's hook scripts: build-plugin-libs.mjs bundles the ten plugin-entries modules into committed CJS under plugins/maestro/scripts/lib, why those bundles are committed rather than built at install time, why the build pins its working directory and tsconfig, why each bundle's export surface must stay a superset of what the hook scripts require(), and why maestro-tasks.cjs is the one hand-maintained exception. Use before shipping any change to a src/core module a hook depends on, when an edit to src/core isn't reaching a hook, when git diff shows a spurious bundle diff, or when a bundle silently came out non-strict."
metadata:
  type: concept-skill
  version: "1.3"
  last-update: dc07795aca62476b23408ba23e0455dc855aef35
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

## The ten generated entries

`maestro-session`, `maestro-skill-regions`, `maestro-seed`, `maestro-skill-tags`,
`maestro-report-defaults`, `maestro-project-tags`, `maestro-agent-project-tags`,
`maestro-agent-types`, `maestro-concept-skills`, `maestro-agent-sync` (`031`).

**`maestro-agent-sync` must not pull in `node:sqlite`.** It backs
**two** callers, both running under whatever bare `node` is on the session's PATH:
`plugins/maestro/scripts/maestro-agent-forks.cjs` (the user-facing CLI, driven by `/maestro-update`)
and `plugins/maestro/scripts/maestro-step0.js`, the readiness hook, which `require`s
`computeAgentSync` out of the bundle directly rather than spawning the CLI. Its source (`agent-sync.ts`) therefore imports
`agent-fork-record.ts` and never `agent-fork.ts` — the latter reaches three sqlite stores through
`copyAgentAttributeRows`, which is exactly why `031` split the file (see `global-stores`). The
check is `grep -c "node:sqlite" plugins/maestro/scripts/lib/maestro-agent-sync.cjs` → `0`. Nothing
fails if it stops being 0; the script just starts throwing on machines with an older `node`.

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
| `apps/maestro/src/core/plugin-entries/*.ts`    | The ten entry points — thin re-exports of `src/core`.   |
| `plugins/maestro/scripts/lib/*.cjs`            | Committed output, banner-marked `DO NOT EDIT`.          |
| `apps/maestro/test/core/parity.test.ts`        | Differential test against snapshotted legacy CJS.       |
| `apps/maestro/test/core/avatar-parity.test.ts` | Same, for the avatar store.                             |

The parity tests compare against **snapshots** under `test/fixtures/legacy/`, deliberately not
against the live `plugins/maestro/scripts/lib/` files — the build overwrites those, so comparing
against them would go tautological the moment the build runs.

## Relationships

- [`agent-fork-sync`](../agent-fork-sync/SKILL.md) — what the tenth bundle carries, and why it
  must stay free of `node:sqlite`.
- [`global-stores`](../global-stores/SKILL.md) — four of the generated entries are its stores, and
  the split that keeps the tenth free of them.
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
