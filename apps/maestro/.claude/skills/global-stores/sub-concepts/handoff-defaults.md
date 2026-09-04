# Handoff defaults

`~/.claude/maestro-handoff-defaults.sqlite` (`033`) is the global tier for a route's
`handoff_details` payload protocol. Same argument for being global as `report-defaults.ts` — it is
the fallback a project falls back to, and what install syncs `.claude/handoffs/**.md` from —
deliberately not the same shape.

**One table, not two.** `report-defaults.ts` routes agent → `report_id` → content so a future UI
could point two agents at one shared body; its own header admits nothing creates that sharing.
Handoffs have 23 keys to reports' 5, so the hop would buy an id-sharing nobody asked for at the
cost of one more join. `handoffs(handoff_id PRIMARY KEY, content, version)` — and `handoff_id` is
`"<sender>/<receiver>"`, **bare** agent names on both sides, which maps straight onto the project
file's `.claude/handoffs/<sender>/<receiver>.md` path.

**The id is a path, so it is validated before it is joined.** `isValidHandoffId`
(`^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+$`) is checked in the store *and* in the sync — a guard in one of
two callers is a guard the third caller will miss. `033` added the same guard to the report path's
`entry.id`, which had none.

**The seed lives outside the store, in `handoff-seeds.ts`, which imports nothing.** This is the one
structural rule to preserve. `node:sqlite` needs `node` >= 22.5 and the SubagentStart hook runs
under whatever `node` is on the session's PATH. A report degrading to "none" when the store won't
open is tolerable; a handoff degrading to "none" is not, since `033` also removed the installed
`templates/handoffs/` fallback. So `SEED_HANDOFFS` / `PRIOR_SEEDS` / `isSeededHandoff` /
`isValidHandoffId` sit in a module with **no imports at all**, re-exported through
`plugin-entries/maestro-session.ts` — the bundle the hook `require`s unconditionally — while the
store gets its own bundle the hook `require`s in a try/catch. Same split, same reason, as `031`'s
`agent-fork-record.ts`. The property, and it fails silently:
`grep -c "node:sqlite" plugins/maestro/scripts/lib/maestro-session.cjs` must stay **0**.

**`PRIOR_SEEDS` is not optional and is exported.** `seedIfEmpty` only fires on a store never
written to, so on any machine that has opened the db, editing `SEED_HANDOFFS` does nothing — the new
body is in the source and no agent ever sees it. `refreshSupersededSeeds` closes that by moving a
row still carrying a *previous* seed body forward while leaving a hand-edited row alone; both run on
every `openDb()`. It is empty today (no seed has been revised yet) and exported anyway, so the
mechanism is testable before the first edit — `report-defaults.ts` keeps its equivalent private.

**`deleteHandoffDefault` re-seeds when the delete empties the table.** "Delete" means "stop
overriding the seed", never "leave this route protocol-less".

Files: `apps/maestro/src/core/handoff-defaults.ts` (the store),
`apps/maestro/src/core/handoff-seeds.ts` (the seed tier, import-free),
`apps/maestro/src/core/handoff-resolution.ts` (the pure three-tier decision),
`apps/maestro/src/core/plugin-entries/maestro-handoff-defaults.ts` (its own bundle).
Test: `apps/maestro/test/core/handoffs.test.ts`.
