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

Mirroring the report pairs exactly:

| Channel | Shape |
| --- | --- |
| `template:handoffs:list` | → `Record<handoffId, HandoffDefault>`, global, no project context |
| `template:handoffs:save` | `(handoffId, content)` → `HandoffDefault`; upsert, bumps `version` |
| `template:handoffs:delete` | `(handoffId)` → `void`; refuses a seeded id |
| `handoff:get` | `(sender, receiver)` → `ResolvedHandoff` for the open project |
| `handoff:save` | `(sender, receiver, content)` → `ResolvedHandoff`; always a **project** override |

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
| `src/shared/ipc.ts`, `src/main/ipc.ts`, `src/preload/index.ts` | The five channels. |

## Acceptance criteria

- [ ] `/templates` has a Handoffs tab listing every global row, shipped and user-created
      distinguished, and editing one bumps its `version` so a project that already synced it
      refreshes on the next install
- [ ] Creating a pair from the two dropdowns writes a new global row at version 1; sender and
      receiver cannot be the same agent, and creating an existing pair selects it instead of
      overwriting it
- [ ] A user-created pair offers **Delete**; a pair Maestro ships offers **Reset to default**
      instead and restores `SEED_HANDOFFS[id]` byte-for-byte
- [ ] `/templates` still threads no project context — no `ProjectSelect`, no `projectRoot` in any of
      its calls
- [ ] The Interactions pane lists the report followed by one entry per outgoing route from
      `handoffRoutes()`, each showing which tier its content came from, including a route with no
      template at any tier
- [ ] Editing a route in the pane and pressing the card's Save writes
      `.claude/handoffs/<sender>/<receiver>.md` and drops that pair's `syncedFrom`; Cancel discards
      report and handoff edits together
- [ ] A partial save failure names which fields failed and leaves the card in edit mode
- [ ] `/maestro`'s install report names materialised / refreshed / stale-customised handoffs
- [ ] `CARD_MIN_HEIGHT` re-checked in a real window — the pane is outside the card, so it should be
      unaffected; confirm rather than assume
- [ ] `test/isolation.test.ts` still passes, including the `src/core` boundary walk over the new
      renderer imports

## Notes for whoever picks this up

Read `apps/maestro/.claude/skills/agents-view/` end to end before touching `agents.tsx` — the
six-write-path fan-out, the `pendingEdit` flag for a pencil on an unselected row, and the measured
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
