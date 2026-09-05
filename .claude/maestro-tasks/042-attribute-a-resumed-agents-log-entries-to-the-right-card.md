# Attribute a resumed agent's log entries to the right card

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

`/session-log` misattributes across the two cards of a **resumed** agent: the first run's card
shows the *second* run's spawning message and offered skills. Found while verifying `039`, and
recorded on `log-view` v2.2 as a known wrinkle rather than fixed there.

### Why `039` made this reachable

`buildInstances` (`apps/maestro/src/renderer/src/utils/session-log.ts`) correlates a subagent
segment's `input`/`offeredSkills`/`delivered` to a `dispatch` entry **by `agent_id` alone**. That
was sound while every invocation was a cold `Task`: a fresh spawn got a fresh `agent_id`, so the key
was unique per run. The comment at `:138-139` says so in as many words —

> correlate on it, not on agent name, for the same reason (a re-invoked agent gets a fresh
> `agent_id` per run).

`039` breaks that premise on purpose. A condition-edge loop-back now resumes an agent with
`SendMessage`, and *"resuming starts a new run of the agent under the same ID"* — `SubagentStart`
and `SubagentStop` both fire again, so `maestro-subagent-log.js` appends a **second**
`dispatch`/`handoff` pair carrying the **same** `agent_id`.

### What that does to each of the three correlations

Segmentation itself is unaffected: `buildInstances` starts a new segment on every `origin` change,
so a resumed run still renders as its own card. It is only the three agent_id lookups that go wrong.

| | Today | Effect on a resumed agent |
|---|---|---|
| `dispatchByAgentId` (`:97-102`) | `Map`, one forward pass, `.set(agent_id, entry)` per dispatch | **last-write-wins** — the resumed run's dispatch overwrites the first's, and *both* cards read back the second run's `input` and `offeredSkills` |
| the name fallback (`:129`) | `entries.find(kind === "dispatch" && agent === origin && input)` — the **first** dispatch of that type | wrong in the mirror direction: both cards read the *first* run |
| `deliveredByAgentId` (`:108-119`) | pushes onto an array, so nothing is lost | both cards render **every** delivery logged under that `agent_id`, not just their own run's |

Only the first is a data loss. All three are misattribution, and `offeredSkills` misattribution is
the one that bites hardest — `/session-log` diffs it against the agent's reported `skillsTriage` to
surface silent omissions, so a card showing another run's offered set can manufacture a phantom
omission or hide a real one.

### Bound each lookup by position in the log, not by `agent_id` alone

`entries` is in file (chronological) order and the log is append-only, so position already carries
the run boundary: everything belonging to run *N* of an agent sits after run *N-1*'s `handoff` entry
and at or before run *N*'s. Make that explicit rather than adding a new correlation key —
`maestro-subagent-log.js` has no run counter to log, and giving it one would mean new hook state,
which is exactly what `039` avoided.

Build an entry → index map up front (one pass; do not `indexOf` per segment inside the loop), then
for each subagent segment resolve its `handoff` index `h` and the previous `handoff` index `p` for
the *same* `agent_id` (`-1` when there is none), and:

- take the **latest** `dispatch` with that `agent_id` whose index is `< h` — not the last one in the
  file;
- take the deliveries with that `agent_id` whose index falls in `(p, h)`;
- bound the name fallback the same way: the latest `dispatch` for this `origin` with an `input`
  whose index is `< h` and `> p`.

A segment with no `handoff` entry (an agent still running, or one killed before `SubagentStop`) has
no `h`. Treat the end of the log as its upper bound rather than skipping it — a card for an
in-flight agent should still show the message that spawned it, which is the state a user is most
likely to be staring at.

This is a pure-function change. `session-log.ts` has no Node imports and must keep none, so the
whole fix is unit-testable from a fixture array with no window and no fixture project.

### Do not fix it by making the id unique

The tempting alternative is to have the hook write a per-run discriminator — a run counter, or
`agent_id + ts` as the key. Reject it: `agent_id` is the id Claude Code itself uses and the id
`039`'s `resumeTarget` returns for `SendMessage`, and a log whose `agent_id` no longer matches the
one you would address is worse than a view that has to sort two runs out. The ordering information
needed is already in the file; use it.

### Files

| File | Change |
|---|---|
| `apps/maestro/src/renderer/src/utils/session-log.ts` | index-bounded correlation for `input`/`offeredSkills`/`delivered` and for the name fallback; correct the `:138-139` comment, which now states a premise `039` invalidated |
| `apps/maestro/test/renderer/session-log.test.ts` (or the existing suite for this module) | fixtures covering a resumed agent, a twice-spawned agent, and an in-flight segment |
| `apps/maestro/.claude/skills/log-view/SKILL.md` | the "Things that bite" entry added in v2.2 describes this as live behaviour; rewrite it as the resolved rule |

Nothing under `plugins/` changes, so **no plugin version bump** — the log is written by hooks that
are already correct, and this is entirely a reader-side fix.

## Acceptance criteria

- [ ] A fixture log with two `dispatch`/`handoff` pairs sharing one `agent_id` (a resumed agent)
      produces two cards, each showing **its own** run's `input` and `offeredSkills` — asserted by a
      unit test that fails against the current code.
- [ ] The same fixture gives each card only the `channel_delivery` entries logged during its own
      run; a delivery arriving between the two runs lands on the second card, not both.
- [ ] A twice-**spawned** agent (two runs, two distinct `agent_id`s — the pre-`039` shape) still
      correlates exactly as it does today; the existing tests for that path pass unchanged.
- [ ] A segment whose `handoff` entry is missing (in-flight or killed agent) still resolves its
      spawning `input`, bounded by the end of the log.
- [ ] The name-based fallback is bounded by the same window, so it can no longer hand a later
      segment the first run's dispatch.
- [ ] The entry → index map is built once per `buildInstances` call, not per segment.
- [ ] `session-log.ts` still imports nothing from Node.
- [ ] `pnpm --filter maestro test` passes; `pnpm check` and `pnpm --filter maestro typecheck` clean.
- [ ] Verified in a real window per `test-maestro` — a `maestro_session.log.jsonl` containing a
      resumed agent, opened in `/session-log`, shows two cards whose Input panels differ.
- [ ] `log-view`'s v2.2 "Things that bite" entry is rewritten to describe the fix rather than the
      bug, and the skill's `metadata.version`/`last-update` are updated **by
      `maestro-concept-skills.cjs`**, never by hand.

## Scribe handoff

When the code is done, follow the scribe handoff in `apps/maestro/.claude/skills/test-maestro/`:
send the scribe a summary of the changes and ask it to use `/scribe` and `/update-concept-skills`,
tick the criteria above, record any divergences, set this task `done` in `status.json`, and update
`TODO.md` for the next run.
