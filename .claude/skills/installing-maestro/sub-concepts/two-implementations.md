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

**Report sync joined this discipline in `059` — it used to be the odd one out.**
`maestro-install.js`'s `syncProjectReports()` was a hand-rolled duplicate of four branches that did
NOT call `decideSync` at all, unlike `syncProjectHandoffs()` right beside it. `059` refactored it to
`require` `decideSync` from `lib/maestro-agent-sync.cjs` and mirror `syncProjectHandoffs()`'s
structure, so the two sync functions in this file can no longer drift from each other or from the
app on the new `adopt` branch (or any future one) the way handoffs and reports used to be able to.
Both terminal sync functions gained the `adopted` bucket and a `matchesKnownVersion` computation —
reports via `priorReportSeeds` from `lib/maestro-report-defaults.cjs`, handoffs via
`PRIOR_HANDOFF_SEEDS` from `lib/maestro-session.cjs`.

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

## A third implementation: the skill's own prose (`053`)

The two rows above are both **code** — a differential test can compare their output byte for byte.
`maestro-install/SKILL.md`'s step 1 is a third rendering of `detect.ts`'s `detectImplAgents()`, and
it is **prose**, read and applied by a live session with no test able to run it. It has to reach the
same verdict as the other two for the same repository, and nothing enforces that but a human (or an
agent) rereading both sides after a `detect.ts` change.

`052` added an infrastructure category to `detect.ts`: an infra signal (`terraform`, `*.tf`,
`Pulumi.yaml`, `cdk.json`, …) makes the whole chain collapse to `infra` alone, suppressing every
application category the same repo would otherwise show — evidence naming what was set aside, not
dropped. `053` is what caught that step 1's prose still described only the application categories,
with no precedence rule at all — a session doing the classification by hand would have kept
`backend,frontend` for a repo `detect.ts` now calls `infra`. The fix reads the same as the code:
infrastructure is checked **first** and is **exclusive**, and the prose now says explicitly to note
which application signals were set aside, mirroring `detect.ts`'s own evidence shape.

The seeded-agent list step 1 describes (step 3's "drop any skill already tagged" note, and step 4's
summary) is chain-dependent for the same reason: `seededAgentNames()` seeds `test`/`refactor`
alongside the impl agent(s) for every chain except `infra`-only, which gets only `reviewer`/`scribe`
beside `infra`. The skill's prose has to restate that split rather than assume a fixed list, or a
skill-tag routed at `test` on an infra-only repo reads as covered when nothing seeded owns it.

**The trap this leaves:** a future `detect.ts` category or a change to `seededAgentNames()` has no
test that fails when the skill's own step 1 (or step 3/4) goes on describing the old rule — the
differential test above only runs `maestro-install.js`, never the prose a session reads. Treat a
`detect.ts` or `seed.ts` change as incomplete until `maestro-install/SKILL.md` has been reread
against it, the same discipline `plugin-libs-parity` asks for the generated bundles, applied to text
instead of code.

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
