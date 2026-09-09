# Surface agent channels in the app

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

`036` moved `handoff_details`, `filesChanged` and `conceptSkillGaps` out of an agent's final message
and into `.claude/channels/`. Two app surfaces go blind as a result, and one new thing becomes worth
showing.

### `/session-log` loses the payload — and then gets a better one

`session-log.ts` builds an `Instance` per agent segment and fills `output` from the handoff entry's
`last_assistant_message`. Everything the detail panel shows about *what an agent produced* comes from
that string. After `036` the payload is not in it.

`036` writes the replacement: a `kind: "channel_delivery"` entry in `maestro_session.log.jsonl`
carrying sender, receiver, `agent_id` and content, appended by the injector at the moment it inlines
a payload. Consume it here.

**Attach deliveries to the receiver, not the sender.** This is the part that ends up better than what
it replaces. Today a payload appears in the *sender's* Output panel and you correlate to the receiver
by hand, by reading two cards. A `channel_delivery` is logged at the receiver's `SubagentStart`, with
its `agent_id` — the same key `buildInstances` already uses to match a handoff back to its dispatch
(`session-log.ts:100-110`). So it lands on the receiving instance, in the **Input** panel, beside the
spawning message that is the other half of what that agent was told:

```
Input
──────────────────────────────────────────
 Spawning message
 ┌────────────────────────────────────────┐
 │ Review the auth changes.                │
 └────────────────────────────────────────┘

 Delivered from @backend            channel
 ┌────────────────────────────────────────┐
 │ { "files_added_removed_renamed": [...], │
 │   "areas_of_concern": [...] }           │
 └────────────────────────────────────────┘
```

`Instance` gains `delivered: ChannelDelivery[]`. Cards and the list row get a count the way they
already carry `skillsTriage.loaded.length` — a delivered-payload count is the same class of at-a-
glance signal.

**`skillsTriage` is unchanged.** `036` deliberately left it in the final message; `parseSkillsTriage`
and `unaccountedSkills` keep working as written. Do not touch them.

### Undrained lanes are a backlog, and nothing shows it

Under `036`'s one lifetime rule a channel file survives until its receiver consumes it. That is what
makes the scribe's `conceptSkillGaps` lane a real backlog instead of something the orchestrator has
to remember — but a backlog nobody can see is only half the feature. A project can sit for a week
with four gaps waiting for a scribe that no workflow routes to.

`/maestro` already renders sync summaries (`reportsSync`, and `034`'s `handoffsSync`); the pending
lanes belong beside them:

```
 Channels
 ──────────────────────────────────────────
  scribe      4 pending   (oldest 6 days)
  reviewer    1 pending   (from a previous run)
```

Two things to distinguish, because they mean different things to the user:

- **pending, current run** — normal in-flight traffic, will be delivered.
- **pending, foreign run or unstamped** — `036`'s injector will *not* inline these; it only names
  them. They are the ones a user might want to act on, and the ones the age cap will eventually
  sweep.

Show the split. A lane whose only entries are foreign-run is not "in flight", it is stranded.

**But do not label the scribe's lane stranded.** `036` shipped its freshness rule uniformly (its
divergence 2): a foreign-run file is *mentioned*, never inlined, for every lane including the
scribe's. That is the right call — special-casing one lane would undo the single rule this design
rests on — but it means the gaps lane is in the foreign-run bucket permanently, by construction,
the moment one `SessionEnd` passes. It is a **backlog**, not stranded traffic: a concept-skill gap
from last week is still a valid gap, which is exactly why nothing sweeps it before the age cap.

So the split is by *meaning*, not just by run id: a lane the current run will deliver, versus one
waiting for an agent that has not been invoked. Word the second so a user reading `/maestro` sees
work queued up, not an error — and keep the age visible, because the age cap is the only thing that
eventually removes it.

### The Interactions pane should say where a template lands

`034` made the pane list one editor per outgoing route, each holding the resolved `handoff_details`
shape. After `036` that shape is no longer a JSON field the agent returns — it is the content of a
file the agent writes. A user editing `backend → reviewer` should be able to see that it produces
`.claude/channels/reviewer/backend.<n>.md`.

This is a label, not a redesign. The pane's structure, its shared edit session and the seventh write
path from `034` are all unchanged.

### Channels

| Channel | Shape |
| --- | --- |
| `channels:pending` | `(projectRoot)` → `PendingLane[]` — per receiver: count, oldest write, and the current-run / stranded split |

Read-only. The app does not deliver, retire or sweep — those are hook responsibilities in `036`, and
a second implementation of the lifetime rule is exactly the drift `handoff-routes.ts` was lifted out
of the hook to prevent.

Types cross from `src/core/contracts.ts`, never from `src/core/index.ts` — the barrel re-exports `fs`
and `child_process` and `test/isolation.test.ts` fails on it.

### Files

| File | Change |
| --- | --- |
| `src/renderer/src/utils/session-log.ts` | `ChannelDelivery`; `Instance.delivered`; correlate by `agent_id`. |
| `src/renderer/src/utils/maestro-session-log.ts` | `SessionLogEntry` gains the `channel_delivery` kind. |
| `src/renderer/src/components/session-log-detail.tsx` | Deliveries in the Input panel. |
| `src/renderer/src/components/session-log-view.tsx`, `session-log-cards.tsx` | Delivery count. |
| `src/renderer/src/routes/maestro.tsx` | The Channels block. |
| `src/renderer/src/components/agents/interactions-pane.tsx` | Lane path under each route's editor. |
| `src/shared/ipc.ts`, `src/main/ipc.ts`, `src/preload/index.ts` | `channels:pending` + `MaestroApi.channels`. |
| `src/core/contracts.ts` | `PendingLane`, `ChannelDelivery`. |
| `src/core/handoff-channels.ts` | A read-only `pendingLanes()` beside `036`'s functions. |
| `test/core/handoff-channels.test.ts` | `pendingLanes` cases. |
| `test/renderer/session-log.test.ts` | Delivery correlation. |

No `plugins/` change, so **no plugin version bump** — `036` ships the runtime half.

## Acceptance criteria

- [x] A `channel_delivery` entry attaches to the **receiving** instance, matched on `agent_id`, and
      renders in its Input panel labelled with the sender.
      Evidence: `buildInstances()` in `session-log.ts` collects `channel_delivery` entries into a
      `Map<agent_id, ChannelDelivery[]>` and looks each instance up by the same
      `handoff?.agent_id ?? dispatch?.agent_id` key `input` already uses. `session-log-detail.tsx`
      renders "Delivered from @<sender>" plus a channel badge below the spawning message. Packaged
      window: Input section read `"Write tests for the login endpoint.\nDelivered from
      @backend\nCHANNEL\n{\"behaviors_to_test\":[\"login flow\"]}"`.
- [x] An instance with several deliveries shows all of them, in log order; one with none renders no
      empty section.
      Evidence: `test/renderer/session-log.test.ts` asserts multiple deliveries preserved in log
      order and that an instance with none gets `delivered: []`, not `undefined`; the detail
      component renders nothing extra when `delivered` is empty.
- [x] A `channel_delivery` whose `agent_id` matches no dispatch does not crash the view and does not
      attach to an arbitrary instance.
      Evidence: `test/renderer/session-log.test.ts` covers an orphaned `agent_id` — it is left in the
      map, unattached, no throw.
- [x] The card and list row show a delivery count.
      Evidence: `session-log-cards.tsx` shows an Inbox icon + count; `session-log-view.tsx`'s center
      pane header shows "`N` delivered". Verified in the packaged window against the fixture.
- [x] `skillsTriage` still parses and `unaccountedSkills` still diffs against `offered_skills` —
      unchanged by this slice; assert it rather than assuming it.
      Evidence: neither `parseSkillsTriage` nor `unaccountedSkills` was touched; existing tests for
      both still pass in the 879-test green run, confirming the claim rather than assuming it.
- [x] `/maestro` lists every lane with pending files, its count, its oldest write, and separates
      current-run from waiting (foreign-run or unstamped).
      Evidence: `pendingLanes()` in `src/core/handoff-channels.ts` splits each lane's entries into
      `current` (stamped with the live session's `run_id`) and `stranded` (foreign-run or unstamped);
      `ChannelsCard` in `maestro.tsx` renders receiver, total count and the split per lane.
- [x] A scribe lane holding gaps from a previous run reads as queued work, not as an error or a
      stranded-traffic warning — `036`'s uniform freshness rule puts it in that bucket permanently.
      Evidence: `ChannelsCard`'s all-stranded wording is "queued for `<receiver>`, from a previous
      run (oldest `<age>`)" — verified against the fixture's `scribe` lane, which read "queued for
      scribe, from a previous run (oldest 1 hours)"; never "stranded", never phrased as an error.
- [x] A project with an empty `.claude/channels/`, and one with no such directory at all, both render
      without an error.
      Evidence: `pendingLanes()` has explicit empty-directory and no-directory-at-all test cases;
      packaged-window check with `.claude/channels/` removed entirely showed no card and no console
      errors.
- [x] The Interactions pane names the lane path each route's template writes to.
      Evidence: `interactions-pane.tsx` computes `lanePath = .claude/channels/<receiver>/<sender>.1.md`
      per route and renders it below the tier note. Verified in the packaged window: selecting
      `backend` (routed to `test`) showed `→ .claude/channels/test/backend.1.md`; null for the Main
      Session report entry and for a route with no receiver.
- [x] `channels:pending` is read-only — no app code path delivers, retires or sweeps.
      Evidence: `pendingLanes()` only calls the existing read-only `readLane()`; it never calls
      `writeStamp`/`retire`/`sweep`. It is exported from `src/core/index.ts` but deliberately not
      added to `src/core/plugin-entries/maestro-session.ts` — confirmed by rebuilding the plugin libs
      and finding `grep -c pendingLanes plugins/maestro/scripts/lib/maestro-session.cjs` is `0`
      (tree-shaken, unreferenced by any hook).
- [x] `test/isolation.test.ts` passes over the new renderer imports.
      Evidence: green in the `pnpm --filter maestro test` run below; `PendingLane`/`ChannelDelivery`
      cross from `src/core/contracts.ts`, never from the `src/core/index.ts` barrel that pulls in
      `fs`/`child_process`.
- [x] `pnpm --filter maestro test`, `typecheck` and `check` green.
      Evidence: 46 test files, 879 tests passing (up from 45/870 before this slice); `typecheck` and
      `check` (prettier) both green.
- [x] Verified in a **packaged** window per `test-maestro` — `pnpm --filter maestro build`, then
      `electron . --remote-debugging-port=9222`, never `dev` — against a fixture whose
      `maestro_session.log.jsonl` carries dispatch, `channel_delivery` and handoff entries, and whose
      `.claude/channels/` holds one current-run and one stranded lane.
      Evidence: fixture at `~/gits/maestro-037-fixture` (deleted after verification) with a `test/`
      lane stamped to the live `run_id` and a `scribe/` lane stamped with a foreign `run_id`. All of
      `/session-log`, `/maestro`'s Channels card (`data-lanes="2"`), and `/agents`' Interactions pane
      read back as described above via `document.body.innerText`.

No divergences from the plan — this slice matched the task page's design closely. One note, not a
divergence: verifying `/maestro`'s Channels card requires a project opened via
`window.maestro.project.open()` to already have `startTail()` register a log-file watcher, which it
will not do on a truly cold app launch (empty `projects.json`, no prior `current` project) — `log:subscribe`
fires before `currentRoot()` resolves, so the tail never starts and a later `retargetTails()` has
nothing to restart. This is pre-existing behavior in `src/main/ipc.ts`, not introduced or touched by
this slice, and it only affects a test harness that opens a project programmatically from a fresh
profile — worked around here by pre-seeding `projects.json` before launch. Flagging for whoever next
drives `test-maestro` from a cold profile; not filed as a bug since it does not affect `037`'s own
acceptance criteria.

## Notes for whoever picks this up

Read `apps/maestro/.claude/skills/log-view/` before touching the segmentation — `buildInstances`
starts a new segment whenever `origin` changes, so the same agent invoked twice is deliberately two
cards, and a delivery must land on the right one. Then
`apps/maestro/.claude/skills/agents-view/` for the pane, and `test-maestro/` for the CDP harness.

- **Correlate on `agent_id`, not on agent name.** The name is ambiguous the moment an agent runs
  twice in a session, which condition-edge loops make routine. `session-log.ts:100-110` already
  prefers `agent_id` and falls back to name — follow that shape, including the fallback.
- Do not reimplement `036`'s stamp parsing in the renderer. `pendingLanes()` lives in `src/core`
  beside the functions that write the stamps, and crosses the wire already-computed.
- Check `CARD_MIN_HEIGHT` in a real window if the pane's per-route editors gain a line — the pane is
  outside the card so it should be unaffected, but `agents-view` says to confirm rather than assume,
  and measuring it by blanking `card.style.minHeight` deletes React's own inline value. Save and
  restore the previous value.

## Blocked by

- `036-move-handoff-payloads-onto-agent-channels.md`
