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

- [ ] A `channel_delivery` entry attaches to the **receiving** instance, matched on `agent_id`, and
      renders in its Input panel labelled with the sender.
- [ ] An instance with several deliveries shows all of them, in log order; one with none renders no
      empty section.
- [ ] A `channel_delivery` whose `agent_id` matches no dispatch does not crash the view and does not
      attach to an arbitrary instance.
- [ ] The card and list row show a delivery count.
- [ ] `skillsTriage` still parses and `unaccountedSkills` still diffs against `offered_skills` —
      unchanged by this slice; assert it rather than assuming it.
- [ ] `/maestro` lists every lane with pending files, its count, its oldest write, and separates
      current-run from stranded (foreign-run or unstamped).
- [ ] A project with an empty `.claude/channels/`, and one with no such directory at all, both render
      without an error.
- [ ] The Interactions pane names the lane path each route's template writes to.
- [ ] `channels:pending` is read-only — no app code path delivers, retires or sweeps.
- [ ] `test/isolation.test.ts` passes over the new renderer imports.
- [ ] `pnpm --filter maestro test`, `typecheck` and `check` green.
- [ ] Verified in a **packaged** window per `test-maestro` — `pnpm --filter maestro build`, then
      `electron . --remote-debugging-port=9222`, never `dev` — against a fixture whose
      `maestro_session.log.jsonl` carries dispatch, `channel_delivery` and handoff entries, and whose
      `.claude/channels/` holds one current-run and one stranded lane.

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
