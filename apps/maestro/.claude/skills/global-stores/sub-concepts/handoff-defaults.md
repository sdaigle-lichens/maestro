# Handoff defaults

`~/.claude/maestro-handoff-defaults.sqlite` (`033`) is the global tier for a route's
`handoff_details` payload protocol. Same argument for being global as `report-defaults.ts` — it is
the fallback a project falls back to, and what install syncs `.claude/handoffs/**.md` from —
deliberately not the same shape.

**Since `036` a body is what the sender writes to a channel file, not a JSON field it returns.**
The stored content itself is unaffected — still the protocol text resolved by `resolveHandoff()` —
but the 23 `SEED_HANDOFFS` bodies were rewritten to drop the `{"handoff_details": {...}}` wrapper in
favour of the flat shape written to `.claude/channels/<receiver>/<sender>.1.md`. Every rewritten
body's previous text is in `PRIOR_SEEDS`, per the rule below.

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

**Since `035` the store's bundle IS copied into a project** (`STATIC_ASSETS` gained
`lib/maestro-handoff-defaults.cjs`), so "the store is unreachable from a project install" has
stopped being the condition that reaches the seed. It was copied even though the seed already
covered the gap, because the global row is the tier `/templates`' Handoffs tab writes and
`syncProjectHandoffs` runs only from install/refresh — a route wired in the app *after* the last
install has no materialized project file, so falling through to the seed would silently discard the
user's customization. What still reaches the seed is a `node` older than 22.5 or a project on a
pre-`0.4.4` runtime, and `install.test.ts`'s seed test now **deletes** the copied lib to get there:
the fall-through is simulated, not a property of the manifest.

**`PRIOR_SEEDS` is not optional and is exported.** `seedIfEmpty` only fires on a store never
written to, so on any machine that has opened the db, editing `SEED_HANDOFFS` does nothing — the new
body is in the source and no agent ever sees it. `refreshSupersededSeeds` closes that by moving a
row still carrying a *previous* seed body forward while leaving a hand-edited row alone; both run on
every `openDb()`. It is empty today (no seed has been revised yet) and exported anyway, so the
mechanism is testable before the first edit — `report-defaults.ts` keeps its equivalent private.

**`deleteHandoffDefault` re-seeds when the delete empties the table.** "Delete" means "stop
overriding the seed", never "leave this route protocol-less".

## The two editing surfaces (`034`)

The store had no UI when `033` landed it. It has two now, one per tier, and they are deliberately
different pages because they answer to different scopes.

| Surface | Tier it writes | Channels |
| --- | --- | --- |
| `/templates` → **Handoffs** tab (`components/tabs/global-handoffs-tab.tsx`) | the GLOBAL row | `template:handoffs:list` → `HandoffDefaultsListing`, `template:handoffs:save`, `template:handoffs:delete` |
| `/agents` → **Interactions** pane (`components/agents/interactions-pane.tsx`) | this project's `.claude/handoffs/<sender>/<receiver>.md` override | `handoff:routes` → `ResolvedHandoffRoute[]`, `handoff:save` |

**There is no `handoff:get`.** The pane needs the route LIST, and `handoff-routes.ts` is not
renderer-safe (`test/isolation.test.ts` lets only `contracts.ts` and `text.ts` cross), so the walk
has to happen in main regardless; `resolvedRoutesFrom` (`handoffs.ts`) returns every route already
resolved, so a selection costs one round trip instead of 1 + N and one sqlite open instead of N.
`handoff:routes` takes an **agent name**; every other channel here takes the **`handoffId` string**
rather than `(sender, receiver)` — that is what `033`'s core functions already take and what the
store is keyed by. The renderer joins and splits the id with a template literal and a local
`endsOf`, a deliberate non-import of `splitHandoffId` across the same boundary.

**`template:handoffs:list` returns the rows AND `SEED_HANDOFFS` itself** (`HandoffDefaultsListing`
= `{ rows, seeded }`). `isSeededHandoff` and `SEED_HANDOFFS` live behind the `src/core` boundary,
and the tab needs the seeded id set to pick its footer button — with the rows alone it would render
Delete on a pair the store refuses to delete. The seed **bodies** travel too (~9 KB, read once with
the rows) because Reset to default is a plain `save` of `SEED_HANDOFFS[id]`; sending only the keys
would need a second round trip at click time.

**A shipped pair offers Reset to default; only a user-created one offers Delete — and the refusal
lives in main** (`template:handoffs:delete` throws `"<id> is one of Maestro's own handoff protocols
— reset it to the default instead."`). `seedIfEmpty` fires only on a store that has *never* been
written to, so deleting a shipped pair from a store with any other row in it is irreversible: no
tier below would answer for that route again. `deleteHandoffDefault`'s own re-seed-when-emptied
covers the empty-table case, not this one.

**The pair roster in the Create row is `BUNDLED_AGENT_NAMES`** (`contracts.ts`), the seven bundled
bare names — not a project's `agents_available`, because `/templates` threads no project context at
all and a global default has to be authorable with nothing open. Create refuses a same-agent pair,
and creating a pair that already exists SELECTS it rather than clobbering the body.

Files: `apps/maestro/src/core/handoff-defaults.ts` (the store),
`apps/maestro/src/core/handoff-seeds.ts` (the seed tier, import-free),
`apps/maestro/src/core/handoff-resolution.ts` (the pure three-tier decision),
`apps/maestro/src/core/plugin-entries/maestro-handoff-defaults.ts` (its own bundle).
Test: `apps/maestro/test/core/handoffs.test.ts`.
