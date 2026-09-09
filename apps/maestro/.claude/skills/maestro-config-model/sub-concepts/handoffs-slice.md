# Handoffs slice

`MaestroHandoffsSlice` is `Record<string, MaestroHandoffEntry>` (`033`) — this project's opinion
about the `handoff_details` payload protocol on a given route. Optional, and its absence is
meaningful in the same way the `reports` slice's is.

**The key is `"<sender>/<receiver>"`, with bare agent names on both sides** (`maestro:test` is
`test`). Flat, never nested by sender: `decideSync` tracks one thing per key and the thing here is
a *pair*, not an agent. The key is also literally the path —
`.claude/handoffs/<sender>/<receiver>.md` — which is why every entry point validates it against
`^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+$` before any `path.join`.

`MaestroHandoffEntry` is `{ id, syncedFrom?: { version, hash } }`, and `syncedFrom` carries the
same two meanings as it does for a report. Present = materialized from the global default, and the
install-time sync reads it to decide materialize / refresh / skip-as-customized. Absent = the user
owns this file outright — `saveProjectHandoffOverride` **drops** the field, and that drop is the
whole mechanism by which a hand-authored protocol survives every later install.

**A `no-template` verdict now CLEARS a dead `syncedFrom` (`034`).** If the global row a project
materialised from is deleted on `/templates`' Handoffs tab, the project keeps a file whose entry
tracks a version that no longer exists and can never advance. The sync rewrites that entry to
`{ id }` — the same shape `saveProjectHandoffOverride` writes — leaves the file untouched, and
reports nothing in any bucket, because nothing happened the user needs told about. Left alone the
row would flip straight back to `refresh` the moment somebody re-created the pair under the same
name. It is the only silent branch that still writes, and **both** implementations carry it:
`handoff-sync.ts` and the terminal path's own copy in `plugins/maestro/scripts/maestro-install.js`.

**Two ways this differs from `reports`.** Its candidate set comes from the *graph*
(`handoffRoutes()` over the workflows) rather than from `agents_available`, because the pair
analogue of a list of agents is a cross product — 18 files for a project whose workflows wire 6-8.
And resolution below this slice has **three** tiers, not two: the global sqlite store, then a seed
constant bundled into `lib/maestro-session.cjs`, so a route still gets a protocol on a `node` too
old for `node:sqlite`.

Like `reports`, this slice has **no `mergeSlice` arm** — the sync and
`saveProjectHandoffOverride` read-modify-write it directly, and `config:save` never touches it.

Files: `src/core/types.ts`, `src/core/handoffs.ts`, `src/core/handoff-resolution.ts`,
`src/core/handoff-sync.ts`, `src/core/handoff-routes.ts`, `src/core/handoff-seeds.ts`.
