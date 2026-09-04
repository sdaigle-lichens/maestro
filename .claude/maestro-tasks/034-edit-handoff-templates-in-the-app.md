# Edit handoff templates in the app

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

`033` made handoff templates a three-tier, tracked, synced thing — but the only way to change one is
to edit a file or the sqlite store by hand. Reports have two editing surfaces; handoffs need the
same two.

| Tier | Reports | Handoffs after this ticket |
| --- | --- | --- |
| Global (this machine) | `/templates` → **Reports** tab | `/templates` → **Handoffs** tab |
| Project override | `/agents` → Interactions pane | `/agents` → Interactions pane |

### The Handoffs tab

`/templates`' own header already says what to do with this: *"a future global-template class gets a
new tab here instead of a new hamburger entry"*. Add `{ id: "handoffs", label: "Handoffs" }` to
`TABS` and a `components/tabs/global-handoffs-tab.tsx` modelled on `global-reports-tab.tsx` — the
same two-pane, disabled-until-dirty Save shape, so the two tabs read as the same app.

It differs from the Reports tab in one way that matters: **it has a full lifecycle.**

```
Handoffs
──────────────────────────────────────────
 backend  → test        (shipped)
 backend  → reviewer    (shipped)
 scribe   → reviewer    (yours)      ◀ selected
 …

 [ from: scribe ▾ ]  [ to: reviewer ▾ ]   [ + Create ]

 ┌────────────────────────────────────┐
 │ the handoff_details JSON shape     │
 └────────────────────────────────────┘

 [ Delete ]                      [ Save ]
```

- **Create** is two dropdowns over the **7 bundled agents** (`backend`, `frontend`, `mobile`,
  `refactor`, `reviewer`, `scribe`, `test`) and the existing upsert — writing to an id that does not
  exist inserts it at version 1, so this needs no new store function. Sender and receiver must
  differ. Creating a pair that already exists selects it rather than clobbering it.
- **Delete** is offered only for a pair the user created. It needs a new channel and
  `deleteHandoffDefault` from `033`.
- **Reset to default** replaces Delete for the 23 pairs Maestro ships — it is a save with
  `SEED_HANDOFFS[id]`, so it costs nothing and it means **no shipped route can be permanently
  destroyed by a misclick**. `seedIfEmpty` only fires on a store that has never been written to, so
  a plain delete of a shipped pair would be irreversible.

`isSeededHandoff(id)` from `033` is what picks between the two buttons.

**`/templates` stays global.** It has no `ProjectSelect`, no `projectRoot` threaded into any call,
and this tab must not introduce one — that is why the pair picker is the fixed bundled roster and
not a project's `agents_available`.

Deleting a global row does not break a project that already materialised it: `decideSync` returns
`no-template`, the sync skips, the project file stays on disk and the project tier wins at the hook
anyway. What it does leave is a `syncedFrom` in that project's `handoffs` slice pointing at a
version that no longer exists — clear it on the next sync rather than leaving the state undesigned.

### The Interactions pane

`interactions-pane.tsx`'s header describes exactly this change already: *"the next change here turns
this into a LIST of header + body pairs"*. Today it renders one pair — "Main Session" plus the
resolved report. It becomes:

```
Interactions                          [▤]

 Main Session                         [✎]
 ┌──────────────────────────────────────┐
 │ the resolved report                  │
 └──────────────────────────────────────┘
 Project override

 → test                               [✎]
 ┌──────────────────────────────────────┐
 │ the resolved handoff_details shape   │
 └──────────────────────────────────────┘
 Global default

 → reviewer                           [✎]
 …
```

One entry per outgoing route from `handoffRoutes()`, in the order the walk returns them, each
labelled with the tier its content resolved from — the same project / global / seed provenance
`033`'s `resolveHandoff` returns. A route with no template at any tier still gets a header, saying
so, because an agent that hands off with no payload shape is a real gap and the pane is where it is
visible.

**The pane keeps no Save of its own.** It shares the card's single edit session, as it does today:
the card's Save commits the report *and* every changed handoff alongside the description, type, tag,
skills and avatar; Cancel discards all of it together. So `agents.tsx`'s fan-out goes from **six
write paths to seven**, with the same discipline — each write attempted only when that field
actually changed, failures collected per field, and a partial failure toasting what failed and
**staying in edit mode** rather than closing the editor as if the whole save had landed.

### Not the canvas

A handoff template is per-**pair**, not per-edge. `backend → test` in the `default` workflow and
`backend → test` in `tdd` are one file and one row. An editor hosted on a `/workflows` edge would
imply it was editing *that edge's* payload shape, and a user who changed it in one workflow and
found the other had changed too would be right to call it a bug. The canvas may link to a route's
editor; it must not host it.

### Channels

Planned to mirror the report pairs exactly. **As built** — the planned `handoff:get` was not,
and both tiers take a `handoffId` rather than `(sender, receiver)`; see divergences 1 and 2:

| Channel | Shape |
| --- | --- |
| `template:handoffs:list` | → `HandoffDefaultsListing` = `{ rows, seeded }`, global, no project context |
| `template:handoffs:save` | `(handoffId, content)` → `HandoffDefault`; upsert, bumps `version` |
| `template:handoffs:delete` | `(handoffId)` → `void`; **throws** on a seeded id |
| `handoff:routes` | `(agentName)` → `ResolvedHandoffRoute[]` for the open project — every outgoing route, already resolved, in one call |
| `handoff:save` | `(handoffId, content)` → `ResolvedHandoff`; always a **project** override |

`handoff:save` writes `.claude/handoffs/<sender>/<receiver>.md` and drops `syncedFrom`, exactly as
`saveProjectReportOverride` does — a hand-authored save is no longer tracking a moving global
default, it *is* the project's answer now.

Types cross the boundary from `src/core/contracts.ts`, never from `src/core/index.ts` — the barrel
re-exports `fs` and `child_process`, and `test/isolation.test.ts` fails on it.

### `/maestro`'s install report

Add the handoff lines beside the existing `reportsSync` block in `routes/maestro.tsx` — materialised
/ refreshed / stale-customised, worded as those already are.

### Files

| File | Change |
| --- | --- |
| `src/renderer/src/routes/templates.tsx` | Fourth tab + its loader read. |
| `src/renderer/src/components/tabs/global-handoffs-tab.tsx` | **new** — list, editor, create picker, Delete / Reset. |
| `src/renderer/src/components/agents/interactions-pane.tsx` | Report + one entry per route; per-entry pencil. |
| `src/renderer/src/components/agents/agent-shared.ts` | `AgentDraft` gains the handoff drafts. |
| `src/renderer/src/routes/agents.tsx` | Seventh write path in `handleSave()`; fetch routes + resolved handoffs in `refresh()`. |
| `src/renderer/src/routes/maestro.tsx` | The handoff sync lines. |
| `src/shared/ipc.ts`, `src/main/ipc.ts`, `src/preload/index.ts` | The five channels above, plus `MaestroApi.handoffs` and `templates.handoffs`, and the type/value re-exports. |
| `src/core/contracts.ts` | `HandoffDefaultsListing`, `ResolvedHandoffRoute`, `BUNDLED_AGENT_NAMES`. |
| `src/core/handoffs.ts`, `src/core/index.ts` | `resolvedRoutesFrom` and its barrel export. |
| `src/core/handoff-sync.ts` | The `no-template` branch clears a dead `syncedFrom`. |
| `plugins/maestro/scripts/maestro-install.js` + `plugin.json` | The identical branch on the terminal path; version `0.4.2 → 0.4.3`. |
| `test/core/handoffs.test.ts` | Seven new tests in two new `describe` blocks. |

## Acceptance criteria — all met

Verified with a CDP probe on the **packaged** build (`pnpm --filter maestro build`, then `electron .`
with a fake `$HOME` so the real `~/.claude/maestro-handoff-defaults.sqlite` was untouched) against a
fixture at `~/gits/maestro-034-handoffs` (deleted afterwards) whose graph wires
`backend →success test`, `backend →condition("needs a second pair of eyes") reviewer`,
`test → reviewer`, `reviewer → scribe`, `scribe → reviewer`. The probe exits non-zero on any failed
assertion; it printed **PASS** with `errors: []`. Suite: **837 tests**, typecheck and `pnpm check`
green.

- [x] `/templates` has a Handoffs tab listing every global row, shipped and user-created
      distinguished, and editing one bumps its `version` so a project that already synced it
      refreshes on the next install
      — tabs read `["Reports","Handoffs","Agent Types","Project Tags"]`; 23 shipped rows under a
      "Shipped by Maestro" section; editing `backend → test` and saving produced "version 2".
- [x] Creating a pair from the two dropdowns writes a new global row at version 1; sender and
      receiver cannot be the same agent, and creating an existing pair selects it instead of
      overwriting it
      — creating `mobile → backend` toasted "at version 1" and appeared under "Yours"; with both
      dropdowns on `mobile` the Create button is `disabled: true`; after saving the body
      `MOBILE-TO-BACKEND-BODY`, pressing Create again toasted "already has a global default" and the
      editor still held that exact body.
- [x] A user-created pair offers **Delete**; a pair Maestro ships offers **Reset to default**
      instead and restores `SEED_HANDOFFS[id]` byte-for-byte
      — shipped `backend → test` offered only "Reset to default" (no Delete); created
      `mobile → backend` offered only "Delete". After an edit and a reset, the editor content was
      `===` the pre-edit content (string equality asserted in the probe).
- [x] `/templates` still threads no project context — no `ProjectSelect`, no `projectRoot` in any of
      its calls
      — no `ProjectSelect` and no "Choose a project" text anywhere on the page; the tab was driven
      with no project open at all, before `project.open` was ever called.
- [x] The Interactions pane lists the report followed by one entry per outgoing route from
      `handoffRoutes()`, each showing which tier its content came from, including a route with no
      template at any tier
      — `backend`: `data-routes="2"`, entries `["Main Session", "test", "reviewer · needs a second
      pair of eyes"]`, tiers `["Global default …", "Global default", "Global default"]`. `scribe`:
      `data-routes="1"`, its `scribe → reviewer` entry read **"No protocol configured"** and rendered
      "No handoff protocol for this route" — Maestro ships nothing for that pair, so no tier answers.
- [x] Editing a route in the pane and pressing the card's Save writes
      `.claude/handoffs/<sender>/<receiver>.md` and drops that pair's `syncedFrom`; Cancel discards
      report and handoff edits together
      — after editing `backend/test` and pressing the card's Save, `.claude/handoffs/backend/test.md`
      held exactly `PROJECT-OVERRIDE-FROM-PANE`, `maestro.json`'s `handoffs` slice held
      `{"backend/test": {"id": "backend/test"}}` with **no `syncedFrom`**, and the pane's tier label
      had moved to "Project override". A later edit followed by Cancel left neither the pane text nor
      the file changed.
- [x] A partial save failure names which fields failed and leaves the card in edit mode
      — unchanged mechanism: the handoff loop pushes into the same `failures` array as the other six
      paths, and the existing `if (failures.length > 0) { toast(…); return; }` returns before
      `setDraft(null)`. Verified by code path rather than provoked in the window.
- [x] `/maestro`'s install report names materialised / refreshed / stale-customised handoffs
      — three `handoffsSync` blocks added to `maestro.tsx`, worded as the `reportsSync` ones.
      Rendering only; `handoffsSync` was already computed by `033`'s install.
- [x] `CARD_MIN_HEIGHT` re-checked in a real window — the pane is outside the card, so it should be
      unaffected; confirm rather than assume
      — measured by saving and restoring React's own inline value (never blanking it, per the known
      trap). View natural **618.95px**, edit natural **603.83px**, applied **627px** in both modes.
      The constant is unchanged at 627 and still ≥ both naturals, so pressing Edit does not reflow.
      Confirmed unaffected: the pane is outside the card and no edit-mode card content changed.
- [x] `test/isolation.test.ts` still passes, including the `src/core` boundary walk over the new
      renderer imports
      — 43 files / 837 tests pass; the new renderer files reach `src/core` only through
      `shared/ipc.ts`'s re-exports of `contracts.ts`.

## Divergences from what this page planned

Five, each with the reason it was taken.

1. **`handoff:get` was not built; `handoff:routes` replaced it.** The channel table above planned
   `handoff:get (sender, receiver) → ResolvedHandoff`. The pane needs the route LIST, and
   `handoff-routes.ts` is not renderer-safe (`test/isolation.test.ts` allows only `contracts.ts` and
   `text.ts` across the boundary), so the walk has to happen in main anyway. A `get` beside it would
   have meant 1 + N round trips and N sqlite opens per selection. `handoff:routes` returns the routes
   already resolved, in one call.
2. **The channels take a `handoffId` string, not `(sender, receiver)`.** This is the decision the
   "Checked against `033`" note below asked for, made once, in favour of the id — that is what
   `033`'s core functions already take and what the store is keyed by. The renderer joins and splits
   with a template literal and `id.split("/")` (a local `endsOf` in the tab, documented there as a
   deliberate non-import of `splitHandoffId`).
3. **`template:handoffs:list` returns `HandoffDefaultsListing`, not a bare
   `Record<handoffId, HandoffDefault>`.** `isSeededHandoff` and `SEED_HANDOFFS` live in
   `handoff-seeds.ts`, behind the `src/core` boundary. The seeded set must cross the wire for the tab
   to pick Delete vs. Reset, and the seed BODIES must cross for Reset to be a plain save — otherwise
   Reset needs a second channel round trip at click time. ~9 KB of constants, read once with the rows.
4. **`BUNDLED_AGENT_NAMES` was added to `contracts.ts`** rather than the roster being hardcoded in
   the tab. Same boundary reason; the repo had no existing exported constant for the seven bundled
   agents (`seededAgentNames()` in `seed.ts` is a different, project-dependent set).
5. **`plugins/maestro/scripts/maestro-install.js` also changed**, and is not in the Files table
   above. It carries its own copy of the handoff sync branches for the terminal install path, and
   leaving it behind would have made the app and the terminal disagree about what a deleted global
   row leaves in the `handoffs` slice. Plugin version bumped **0.4.2 → 0.4.3 (patch)** — a behaviour
   change to an existing script, published surface unchanged.

## Checked against `033` as built

Reconciled by the scribe when `033` closed. **The plan holds** — every `033` symbol this page names
exists with the shape it assumes (`isSeededHandoff`, `deleteHandoffDefault`, `SEED_HANDOFFS`,
`handoffRoutes`, `readAllHandoffDefaults`, `ResolvedHandoff`, `HandoffDefault`, and `handoffsSync`
on `InstallReport`). Three small adjustments, none structural:

- **`getResolvedHandoff` / `saveProjectHandoffOverride` take one `handoffId` string, not
  `(sender, receiver)`.** The id is `"<sender>/<receiver>"`; `handoffId(sender, receiver)` in
  `handoff-seeds.ts` builds it. Keep the channel signatures as this page has them and join in the
  handler — or change them to take the id. Either, but decide once.
- **Both ends of a route are BARE agent names, and a malformed id throws before any `path.join`.**
  The pair dropdowns must emit bare names (`test`, never `maestro:test`), or every call fails the
  `^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+$` guard.
- **`ResolvedHandoff.source` has four values, not three** — `"project" | "global" | "seed" | "none"`.
  The pane's tier label needs a fourth case; `"seed"` reads as "what Maestro ships", and the page's
  "no template at any tier" row is `"none"`.

Also worth knowing before the pane work: `deleteHandoffDefault` **re-seeds** if the delete empties
the table (see `033`'s divergence 5), and nothing renders `handoffsSync` yet — `maestro.tsx` still
shows `reportsSync` only, which is the last bullet of this page's Files table.

## Notes for whoever picks this up

Read `apps/maestro/.claude/skills/agents-view/` end to end before touching `agents.tsx` — the
seven-write-path fan-out (six when this page was written), the `pendingEdit` flag for a pencil on an unselected row, and the measured
`CARD_MIN_HEIGHT` are all things that break quietly. Then
`apps/maestro/.claude/skills/test-maestro/` for the CDP harness.

- **Verify in a window, not in vitest.** Nothing under `test/` can reach this. Launch the
  **packaged** build (`pnpm --filter maestro build`, then `electron . --remote-debugging-port=9222
  --user-data-dir=…` in the scratchpad) — never `dev`, which serves over `http://` and skips the
  `file://` path that ships.
- **Measuring `CARD_MIN_HEIGHT` by setting `card.style.minHeight = ""` deletes React's own inline
  declaration** until the next render, so every later measurement in the same probe silently loses
  the floor. Save the previous inline value and restore *that*. This has already cost one probe run.
- Use a fake `$HOME` for the probe so `~/.claude/maestro-handoff-defaults.sqlite` is not the real
  one, and delete the fixture project afterwards.
- The pane's textarea grows to its whole content so the pane scrolls rather than a box inside it —
  keep that behaviour for each route's editor, or a page with six routes gives you seven scrollbars.

## Blocked by

- `033-customizable-handoff-templates.md`
