# Two implementations

`installRuntime()` and `maestro-install.js` write the same files, and neither is a fallback for the
other — the app path is preferred where a desktop app exists; the script is the whole story on a
machine without one. `install.ts` is a **hand port**, not generated (contrast `plugin-libs-parity`,
where the `.cjs` is built from TypeScript and must never be hand-edited).

## What pins them together

`test/core/install.test.ts` opens with `describe("differential against the legacy installer")` and
asserts the app produces the same files **byte for byte** for everything the script wrote, plus the
two behaviours easiest to lose in a port: preserving a rendered HANDOFFS table on re-sync, and
migrating a pre-managed-regions skill while keeping the old body beside it.

Both file headers say the manifests mirror each other one-for-one and that a divergence is a bug in
one of them. There is no test comparing the two _lists_ directly — only their output — so a new
asset added to one and not the other shows up as a differential failure, not a lint error.

**The handoff sync is a second thing that must match, and it is hand-mirrored prose, not a shared
module.** `maestro-install.js` `require`s `decideSync` and `handoffRoutes` from the generated libs,
but its own verdict switch is a copy. `034` changed one branch in both: a `no-template` verdict now
rewrites an entry that still carries a `syncedFrom` to `{ id }` — the global row it tracked was
deleted on `/templates`, so the version can never advance — while leaving the file alone and
reporting nothing. Changing that branch in one implementation and not the other makes the app and
the terminal disagree about what a deleted global row leaves in the `handoffs` slice, and no test
catches it, because it is the terminal script's own copy.

## What only the app does

- **Reports what changed on disk.** `InstallReport` carries `scriptsWritten`, `hooksAdded`,
  `gitignoreUpdated`, `configSeeded`, `runtimeVersionUpdated` and an `unchanged` flag, which is what
  lets a second run say "nothing to do" instead of claiming success ambiguously.
- **Copies only what differs.** "Always refreshed" in the script meant an unconditional
  `copyFileSync`; comparing hashes first is what makes `unchanged` meaningful.
- **Syncs project reports** from the global report-defaults store, and reads the global agent-type,
  agent-project-tag and skill-tag stores to build the first seed. See `global-stores`.
- **Refuses on an unparseable `settings.json`** with a message the UI shows, rather than continuing
  with `{}`.
- **`refreshStaleRuntime()`** — the version-triggered auto-refresh on project selection.

## What only the terminal path does

- **Analyses the repo** to pick implementation agents, and — on a fresh install only — scans
  `.claude/skills/` and best-fit maps each project skill to a seeded agent, then asks for consent in
  a single `AskUserQuestion` before seeding. The app takes these from its own stores and its canvas
  instead.
- **Runs as two steps by contract**: scaffold, then `maestro-render-orchestrator.cjs`. The skill
  owns that sequencing; the script deliberately does not render.

## Locating the plugin's files

Only the app has this problem, and it has three answers because it runs from three places:

1. From source or a dev bundle — `findUpPluginRoot()` walks up looking for
   `plugins/maestro/templates/maestro/SKILL.md`. A fixed `../../..` silently resolves wrong,
   because vitest and the electron-vite bundle sit at different depths.
2. A packaged build ships the plugin outside any such tree and sets **`MAESTRO_PLUGIN_ROOT`** —
   env-driven rather than reading Electron's `process.resourcesPath`, so `src/core` stays free of
   Electron.
3. Tests pass `pluginRoot` explicitly.

`shippedRuntimeVersion()` reads `plugin.json`'s `version` from whichever root won. A bare terminal
session cannot do this — it has no checkout — so `maestro-check-runtime.cjs` reads
`~/.claude/plugins/installed_plugins.json` instead, i.e. the version the marketplace cache actually
installed.

Files: `apps/maestro/src/core/install.ts`, `plugins/maestro/scripts/maestro-install.js`,
`plugins/maestro/skills/maestro-install/SKILL.md`. Test: `test/core/install.test.ts`.
