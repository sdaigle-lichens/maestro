# Customizable handoff templates

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The `SubagentStart` hook injects two kinds of prose into a subagent: its **report** (the "Mandatory
Output Format" block) and its **handoff protocol** — the `handoff_details` JSON shape the receiving
agent expects, one per outgoing route. A user can customise the first and not the second.

| | Reports | Handoffs today |
| --- | --- | --- |
| Global tier | `~/.claude/maestro-report-defaults.sqlite`, versioned, seeded, superseded-seed refresh | **none** |
| Project tier | `.claude/reports/<id>.md`, tracked in `maestro.json`'s `reports` slice with `syncedFrom{version,hash}` | `.claude/handoffs/<sender>/<receiver>.md` — read first by the hook, but nothing writes, tracks or surfaces it |
| Sync | `report-sync.ts` through `decideSync` | none — `.claude/templates/handoffs/` is blind-overwritten on every install |
| Resolution | `report-resolution.ts`, pure, shared by the hook and the app | inline in the hook |

`.claude/handoffs/` is a real escape hatch — `readHandoffProtocol` in
`maestro-inject-agent-context.js` checks it first — but nothing creates it, nothing tracks it and
nothing tells the user it exists. And the thing that *is* installed,
`.claude/templates/handoffs/`, is overwritten by every install, so a user who edits it loses the
edit silently. That is precisely the failure `syncedFrom` was built to prevent, one directory over.

Bring handoffs to report parity. **This ticket is the runtime half**; the editing surfaces are
`034`.

### Three tiers, and the install-managed copy goes away

Resolution becomes exactly the report's shape:

```
project file (.claude/handoffs/<sender>/<receiver>.md)   the user's own
  -> global row  (~/.claude/maestro-handoff-defaults.sqlite)   this machine's default
    -> seed constant                                       what Maestro ships
```

`<project>/.claude/templates/handoffs/` is **removed from the install manifest**. It is a fallback
that install blind-overwrites, so it can never hold an opinion; the global store is the tier that
does that job now, and it is what install syncs *from* — the same argument `report-defaults.ts`'s
header makes for why a report default is global.

**No migration is required.** No project is actively using Maestro. The change ships with
"uninstall, then reinstall".

### The floor ships inside the bundle, not as files

Dropping the installed templates leaves a hole: `node:sqlite` needs `node` ≥ 22.5, and this runs
under whatever `node` is on the session's PATH, not Electron's. `readGlobalReportDefault`'s
try/catch degrades a report to "none" and that is tolerable; degrading a handoff to "none" after
removing the only other fallback is not.

So the seed travels with the hook. **Split it out of the store**, for the same reason `031` split
`agent-fork-record.ts` out of `agent-fork.ts`:

- **`src/core/handoff-seeds.ts`** — `SEED_HANDOFFS`, `PRIOR_SEEDS`, `isSeededHandoff(id)`. Imports
  **nothing** that reaches `node:sqlite`. Re-exported from `plugin-entries/maestro-session.ts`, the
  bundle the hook already `require`s unconditionally.
- **`src/core/handoff-defaults.ts`** — the sqlite store, imports the seeds. Its own new bundle,
  `require`d inside try/catch.

Then the hook's sqlite `require()` can fail and the seed tier still answers. Verify with
`grep -c "node:sqlite" plugins/maestro/scripts/lib/maestro-session.cjs` → **0**, the same check
`031` used on `maestro-agent-sync.cjs`.

### One table, not two

```sql
CREATE TABLE handoffs (handoff_id TEXT PRIMARY KEY, content TEXT NOT NULL, version INTEGER NOT NULL)
```

`handoff_id` is `"<sender>/<receiver>"`, which maps straight onto the existing
`.claude/handoffs/<sender>/<receiver>.md` path, so `report-sync.ts`'s `reportFilePath(root, id)`
transfers with no shape change.

**Do not copy `report-defaults.ts`'s two-table indirection.** Its own header admits nothing creates
the id-sharing it exists for, and handoffs have 23 keys to reports' 5 — an unused hop is more code
to keep correct here, not less. Eight of the 23 seed bodies are currently byte-identical
(`backend|frontend|mobile → reviewer`, and a five-way group across `refactor|reviewer → …`); those
are seed artifacts and are expected to diverge as the app is refined. The store self-seeds, so if
edit-once ever matters, "migrating" is deleting the sqlite file.

`SEED_HANDOFFS` is the 23 bodies as hand-written string constants — the same shape `SEED_REPORTS`
uses for the bodies stripped out of `plugins/maestro/agents/*.md`. **Delete
`plugins/maestro/templates/handoffs/*` once the constant carries them**: two copies of the same
default is exactly the drift this ticket removes.

`PRIOR_SEEDS` + `refreshSupersededSeeds` are not optional. `seedIfEmpty` only fires on a store that
has never been written to, so on any machine that has ever opened the db, editing `SEED_HANDOFFS`
does nothing — the new field is in the source, the agents never see it, and nothing reports the
discrepancy. That is the failure the list closes; read `report-defaults.ts`'s header on it.

### Candidate pairs come from the workflow graph

`report-sync.ts` walks `new Set([...Object.keys(reports), ...cfg.agents_available])` — "every agent
already tracked, plus every agent the project opted into". The pair analogue is **not** an
`agents_available` cross product: that materialises 18 files for a fullstack project where the
workflows wire 6–8.

Instead, walk the graph — which is the route resolution `collect()` in
`maestro-inject-agent-context.js` **already does inline**. Lift it into
**`src/core/handoff-routes.ts`** (pure, `fs`-free) and have the hook call that instead of keeping
its own copy, so this removes a duplicate implementation rather than adding one:

```ts
handoffRoutes(workflows, instances): Array<{ sender: string; receiver: string | null; label: string }>
```

Success edges resolve *through* non-agent nodes (`human review`) to the next agent; condition edges
do not. `label` is `"success"` or the condition label. First-wins per `(sender, label)`, matching
what the hook does today.

- the **hook** calls it with its `searchList` and filters `sender === bareAgentName(agentType)`;
- the **sync** calls it with every workflow and takes the distinct `(sender, receiver)` pairs with a
  non-null receiver.

Two answers to "which handoffs does this project have" is how the installed files and `034`'s UI
start disagreeing. There must be one.

Re-export it from `plugin-entries/maestro-session.ts` — it is pure, so it needs no bundle of its
own.

### The sync

**`src/core/handoff-sync.ts`** — `syncProjectHandoffs()`, structurally a copy of `report-sync.ts`
with the candidate set above. It is the **third caller of `decideSync`**
(`src/core/sync-decision.ts`); do not write a fourth set of branches. The hash is over the whole
file, as reports do — a handoff template has no frontmatter to normalise out.

The `no-template` branch already covers a wired route with no seed (`scribe → reviewer`): skipped,
no file, no noise.

### `maestro.json`

`MaestroHandoffEntry { id: string; syncedFrom?: { version: number; hash: string } }` and
`MaestroHandoffsSlice = Record<string, MaestroHandoffEntry>` keyed `"sender/receiver"`, plus
`handoffs?:` on `MaestroConfigV3`. Flat, not nested — `decideSync` takes one `SyncTracking` per
thing, and the thing here is a pair.

Like `reports`, this slice gets **no `mergeSlice` arm**: it is written directly by the sync and by
`saveProjectHandoffOverride`, never through `config:save`. Read `mergeSlice`'s header before
assuming otherwise — the absence of a trailing `else` there is deliberate.

### Path safety

`handoff_id` contains a `/` by design and is joined into a path. Validate it explicitly against
`^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+$` **before** any `path.join`, in the store and in the sync. The
report path has the same latent exposure through `entry.id` and no guard at all — **fix both while
you are here**, the same way `isValidDocSlug` guards the docs reader.

### One correctness fix to fold in

`maestro-inject-agent-context.js` calls
`readHandoffProtocol(projectDir, bareAgentName(agentType), r.target)` — **the sender is bared and
the receiver is not**. `r.target` is `inst.agent` verbatim, while every other comparison in that
file goes through `bareAgentName` precisely because an agent can be namespaced (`maestro:test`). A
project whose instances carry namespaced agents therefore resolves no handoff protocol for any
route, silently. Bare both sides, and key the store and the slice on bare names throughout.

### Files

| File | Change |
| --- | --- |
| `src/core/handoff-seeds.ts` | **new** — `SEED_HANDOFFS`, `PRIOR_SEEDS`, `isSeededHandoff`. No sqlite in its import graph. |
| `src/core/handoff-defaults.ts` | **new** — the one-table store: `readHandoffDefault`, `readAllHandoffDefaults`, `writeHandoffDefault` (upsert, bumps `version`), `deleteHandoffDefault`, `seedIfEmpty`, `refreshSupersededSeeds`. |
| `src/core/handoff-routes.ts` | **new** — `handoffRoutes()`, pure. |
| `src/core/handoff-resolution.ts` | **new** — `resolveHandoff()`, mirroring `report-resolution.ts` so the hook and the app cannot disagree. Three tiers. |
| `src/core/handoff-sync.ts` | **new** — `syncProjectHandoffs()`, third `decideSync` caller. |
| `src/core/handoffs.ts` | **new** — `getResolvedHandoff` / `saveProjectHandoffOverride`, mirroring `reports.ts`. The save **drops `syncedFrom`**, which is what marks a hand-authored override detached. |
| `src/core/types.ts` | `MaestroHandoffEntry`, `MaestroHandoffsSlice`, `handoffs?` on `MaestroConfigV3`. |
| `src/core/contracts.ts` | `HandoffSyncSummary` (the four `ReportSyncSummary` buckets), `ResolvedHandoff`, `HandoffDefault`. Interfaces only. |
| `src/core/install.ts` | Call the sync beside `syncProjectReports`; **drop** the `templates/handoffs` manifest entries; add `handoffsSync` to the result. |
| `src/core/uninstall.ts` | Keep deleting `.claude/templates/handoffs` (older installs left orphans there); `.claude/handoffs/` stays the user's and is untouched by a plain uninstall. |
| `src/core/plugin-entries/maestro-session.ts` | Re-export `handoffRoutes`, `resolveHandoff`, `SEED_HANDOFFS`, `isSeededHandoff`. |
| `src/core/plugin-entries/maestro-handoff-defaults.ts` | **new** — the sqlite tier only. |
| `apps/maestro/scripts/build-plugin-libs.mjs` | Eleventh entry. |
| `plugins/maestro/scripts/maestro-inject-agent-context.js` | Resolve through `resolveHandoff`; call `handoffRoutes` instead of the inline walk; `require` the sqlite bundle in try/catch and fall back to the seed; bare the receiver. |
| `plugins/maestro/scripts/maestro-install.js` | Mirror the sync; drop the `templates/handoffs` manifest entries. |
| `plugins/maestro/scripts/maestro-uninstall.js` | Unchanged in intent — keep removing `.claude/templates/handoffs`. |
| `plugins/maestro/templates/handoffs/**` | **deleted** — superseded by `SEED_HANDOFFS`. |
| `plugins/maestro/.claude-plugin/plugin.json` | `0.4.1` → **`0.4.2`**. |

After any edit under the `plugin-entries` import graph, run
`pnpm --filter maestro build:plugin-libs` and then **read `git diff plugins/maestro/scripts/lib/`**
— per `apps/maestro/CLAUDE.md` that script fails quietly and every test stays green while the hooks
run stale code.

## Acceptance criteria

- [x] A handoff template resolves project file → global row → seed constant, decided by one pure
      function that both the hook and the app call, mirroring `resolveReport`
      — `resolveHandoff()` in `src/core/handoff-resolution.ts` (no `fs`, no `node:sqlite`); called by
      `handoffProtocol()` in `maestro-inject-agent-context.js` and by `getResolvedHandoff()` in
      `src/core/handoffs.ts`.
- [x] The seed tier still answers when `node:sqlite` is unavailable —
      `grep -c "node:sqlite" plugins/maestro/scripts/lib/maestro-session.cjs` is `0`, and the hook
      emits the shipped payload shape with the sqlite bundle deliberately unresolvable
      — grep re-run at close: `0`, with all 23 seed bodies present in that bundle.
      `handoff-seeds.ts` imports nothing; `readGlobalHandoff()` `require`s
      `./lib/maestro-handoff-defaults.cjs` inside a try/catch. Covered by
      `install.test.ts` → `describe("handoff protocol injection")`.
- [x] The global store is one table keyed `"<sender>/<receiver>"`; a write bumps `version`, and a
      row still carrying a superseded seed body is moved forward while a hand-edited row is not
      — `handoffs(handoff_id PK, content, version)` in `handoff-defaults.ts`; `openDb()` runs
      `seedIfEmpty` then `refreshSupersededSeeds` on every open, driven by `PRIOR_SEEDS`.
      `handoffs.test.ts` covers both directions.
- [x] An install materialises `.claude/handoffs/<sender>/<receiver>.md` for exactly the routes the
      project's workflows wire — not an `agents_available` cross product — and records
      `syncedFrom{version,hash}` in `maestro.json`'s `handoffs` slice
      — `syncProjectHandoffs()` (`handoff-sync.ts`), candidates = ids already in the `handoffs`
      slice ∪ `handoffPairs(handoffRoutes(...))`, called from `installRuntime` right after
      `syncProjectReports`.
- [x] A wired route whose pair has no template is skipped silently (`decideSync` → `no-template`),
      leaving no file — no new branch was written; the existing `no-template` verdict covers it
      (`scribe → reviewer` is the live case).
- [x] A user's hand-edit to `.claude/handoffs/…` survives a second install and is reported as
      `staleCustomized`; a global version bump refreshes an untouched copy
      — both are `decideSync`'s existing `stale-customized` / `refresh` verdicts, mapped into
      `HandoffSyncSummary`'s four buckets; tested in `handoffs.test.ts`.
- [x] The route walk exists **once** — the hook calls `handoffRoutes()` and no longer carries its
      own; the sync calls the same function
      — the hook's inline `collect()` walk is deleted; it now calls
      `routesFrom(handoffRoutes(searchList, instances), agentType)` out of `lib/maestro-session.cjs`.
      Net removal of a duplicate implementation.
- [x] `syncProjectHandoffs` is the third caller of `decideSync` and introduces no second copy of
      those branches — and neither does the terminal path: `maestro-install.js`'s own
      `syncProjectHandoffs()` `require`s `decideSync` from `lib/maestro-agent-sync.cjs` rather than
      re-deriving it. `sync-decision.ts` gained no branch and no test.
- [x] `<project>/.claude/templates/handoffs/` is no longer installed, `plugins/maestro/templates/handoffs/`
      is deleted, and uninstall still removes the former for projects installed by an older release
      — `handoffAssets()` deleted, `runtimeAssets()` returns `STATIC_ASSETS` only (17 files, down
      from ~37); all 23 template files `git rm`'d; `uninstall.ts` unchanged in behaviour, with a
      new legacy-sweep test in `uninstall.test.ts`.
- [x] A `handoff_id` that is not `^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+$` is rejected before any
      `path.join`, in the store and in the sync — and the equivalent guard is added to the report
      path's `entry.id`
      — `isValidHandoffId` guards `handoff-defaults.ts`, `handoff-sync.ts` (`handoffFilePath`) and
      both entry points of `handoffs.ts`. Report side: `isValidReportId` added to
      `report-resolution.ts`; `reportFilePath` throws, the sync loop `continue`s past a bad id
      rather than failing the whole install, and `reports.ts` guards both entry points.
      `reports.test.ts` → `describe("report id path safety")`.
- [x] Both ends of a route are bare agent names, so a project with namespaced instances
      (`maestro:test`) resolves its handoff protocols
      — `handoffRoutes()` bares both `sender` and `receiver` via `bareAgentName`. This is the
      correctness fix folded in: the hook previously passed `r.target` (`inst.agent` verbatim), so a
      namespaced project resolved **no** protocol on any route, silently.
- [x] The app's `installRuntime()` and the plugin's `maestro-install.js` produce the same files and
      the same `handoffs` slice for the same project — proven against one fixture, not asserted
      — `install.test.ts` → `describe("handoff sync parity between the app and the plugin's
      installer (033)")`, which runs both against one fixture and compares files and slice.
- [x] `test/core/parity.test.ts` covers the new bundle's export surface
      — `describe("handoff bundles (033)")`, over both `maestro-handoff-defaults.cjs` and the
      handoff exports added to `maestro-session.cjs`.
- [x] `plugins/maestro/.claude-plugin/plugin.json` is `0.4.2`
      — patch, per `.claude/skills/updating-maestro/`: behaviour changed and the manifest shrank,
      but no skill, agent, command or hook event was added. That skill now carries `0.4.2` as its
      fifth worked example — the first where the published surface *shrank*.

## Divergences from this page, as built

Recorded at close by the scribe. None of these contradict the ticket; each is a decision the page
did not specify.

1. **`handoff-routes.ts` exports three functions, not one.** The page specified `handoffRoutes()`.
   It also ships `routesFrom(routes, agent)` (what the hook needs) and `handoffPairs(routes)` (what
   the sync needs). Both are one-liners over the walk's output, and putting them here is what stops
   the two callers writing their own filter and diverging on, say, whether a null receiver counts.
2. **`handoff-seeds.ts` owns the path guard.** The page put `isValidHandoffId` "in the store and in
   the sync". It lives in the seeds module instead, because that is the one module every tier
   already imports and it imports nothing itself — so the store, the sync, `handoffs.ts` and the
   hook all reach the same regex with no new import edge.
3. **`PRIOR_SEEDS` is exported and empty.** `report-defaults.ts` keeps its equivalent private.
   Exporting it lets `refreshSupersededSeeds` be tested before any seed has ever been revised —
   which matters, because the mechanism's whole failure mode is that it is invisible until the first
   edit, by which time it is too late to notice it was never wired.
4. **`ResolvedHandoff.source` has four values, not three.** `"project" | "global" | "seed" | "none"`
   — one more than `resolveReport`'s. The seed is a real source rather than a synonym for the global
   tier: on a `node` without `node:sqlite` it is the tier that answers, and `034`'s UI has to be able
   to say so.
5. **`deleteHandoffDefault` re-seeds when the delete empties the table.** "Delete" means "stop
   overriding the seed", never "make this route protocol-less".
6. **`installRuntime` / `refreshStaleRuntime` grew optional db-path parameters.** Purely for test
   isolation — without them the suite read the developer's real
   `~/.claude/maestro-handoff-defaults.sqlite`. `installRuntime` took a fifth parameter
   (`handoffsDbPath`); `refreshStaleRuntime` took `projectTagsDbPath` and `handoffsDbPath`.
7. **`lib/maestro-handoff-defaults.cjs` is deliberately NOT in `STATIC_ASSETS`.** A project-local
   hook copy therefore resolves project file → seed and never reaches the global tier. That matches
   this page's design ("the seed travels with the hook") and is not a defect here. **But
   `lib/maestro-report-defaults.cjs` has the identical gap, pre-existing, and there it *is* a latent
   bug** — a report has no seed tier to fall back on, so a project-local hook copy silently resolves
   a report to "none" where the plugin's copy would have found the global default. Worth its own
   ticket; not fixed in `033`.
8. **No UI was touched.** `maestro.tsx` still renders `reportsSync` only, so the `handoffsSync`
   summary `InstallReport` now carries is computed and unrendered. `034` picks that up.

## Notes for whoever picks this up

Read first, in this order: `.claude/skills/maestro-architecture/` (the HANDOFF contract, and why
the hook is the only thing that knows a route exists), `apps/maestro/.claude/skills/global-stores/`
(why each store is global, and that the reasons differ — do not collapse them into one),
`apps/maestro/.claude/skills/agent-fork-sync/` (`decideSync`'s contract and the two callers it
already has), and `apps/maestro/.claude/skills/plugin-libs-parity/` before touching
`build-plugin-libs.mjs`.

- **`report-defaults.ts` is the model, not the template to copy.** Take its seeding discipline, its
  `PRIOR_SEEDS` mechanism and its transaction shape; leave its second table behind.
- **`report-sync.ts`'s header states the five branches in prose.** They live in `sync-decision.ts`
  now. Re-read both before writing the sync — the `untracked` vs `detached` distinction is subtle
  and is what stops the sync overwriting a file that belongs to somebody else.
- **`.claude/handoffs/` may already exist in a project as a hand-made override**, with no entry in
  the slice. That is `untracked`, and it must be left exactly as it is.
- **The `/agents` and `/templates` surfaces are `034`.** This ticket ships the contract; do not
  start the UI here, but do make sure `handoffRoutes` and `getResolvedHandoff` are shaped for it —
  `034` needs "the routes leaving this agent, each with its resolved template and where that
  template came from".
- Fixture projects go where `apps/maestro/.claude/skills/test-maestro/` says they go, and are
  deleted afterwards. Use a fake `$HOME` for anything that touches the real
  `~/.claude/maestro-*.sqlite`.

## Blocked by

Nothing.
