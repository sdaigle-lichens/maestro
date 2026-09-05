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

- [x] A fixture log with two `dispatch`/`handoff` pairs sharing one `agent_id` (a resumed agent)
      produces two cards, each showing **its own** run's `input` and `offeredSkills` — asserted by a
      unit test that fails against the current code. Confirmed against pre-fix code via `git stash`
      on the source file alone; the new test failed there and passes after the fix.
- [x] The same fixture gives each card only the `channel_delivery` entries logged during its own
      run; a delivery arriving between the two runs lands on the second card, not both. Same
      fail-before/pass-after confirmation as above.
- [x] A twice-**spawned** agent (two runs, two distinct `agent_id`s — the pre-`039` shape) still
      correlates exactly as it does today; the existing tests for that path pass unchanged. New
      regression test added for this shape too; all pre-existing tests still pass.
- [x] A segment whose `handoff` entry is missing (in-flight or killed agent) still resolves its
      spawning `input`, bounded by the end of the log.
- [x] The name-based fallback is bounded by the same window, so it can no longer hand a later
      segment the first run's dispatch. Confirmed fail-before/pass-after.
- [x] The entry → index map is built once per `buildInstances` call, not per segment —
      `handoffIndexByInstance` is filled during the existing single segmentation pass, and the
      `dispatchesByAgentId`/`handoffIndicesByAgentId`/`deliveriesByAgentId` maps are built in one
      forward sweep before the per-instance loop.
- [x] `session-log.ts` still imports nothing from Node.
- [x] `pnpm --filter maestro test` passes (927/927 — 922 pre-existing + 5 new); `pnpm check` and
      `pnpm --filter maestro typecheck` both clean.
- [x] Verified in a real window per `test-maestro` — a `maestro_session.log.jsonl` containing a
      resumed `backend` agent (two `dispatch`/`handoff` pairs sharing `agent_id: "resumed-1"`) was
      opened in `/session-log` on the packaged build via CDP: two "Backend" cards rendered, and
      their Input panels read distinctly — "FIRST RUN — implement the button component" vs. "SECOND
      RUN — fix the failing test after resume". Zero console errors during the probe.
- [x] `log-view`'s v2.2 "Things that bite" entry is rewritten to describe the fix rather than the
      bug (the "Deriving instances" narrative section was updated too, for the same correctness),
      and the skill's `metadata.version`/`last-update` were updated by
      `maestro-concept-skills.cjs stamp log-view --bump minor` (now v2.3) — never by hand.

## Divergences

**1 — the upper bound for a handoff-less segment is the end of that SEGMENT, not `entries.length`.**
The page says "Treat the end of the log as its upper bound", and the first implementation took that
literally. That is right only when the handoff-less segment really is the last one for its origin.
When a killed agent (no `SubagentStop`, so no `handoff` entry) is followed by a re-dispatch of the
same agent type, an open-ended window lets the *first* card reach forward and claim the *second*
run's dispatch — reintroducing, in the mirror direction, exactly the misattribution this task
exists to remove. Verified: on that fixture the first implementation rendered `"SECOND"` on both
cards where the PRE-`042` code rendered `"FIRST"`/`"SECOND"` correctly, i.e. it was a regression,
not a pre-existing wrinkle. A segment is a contiguous run of entries, so
`inst.startIndex + inst.entries.length` is the correct bound and collapses to `entries.length` for a
genuinely in-flight agent, which keeps the page's stated intent intact.

The same sentinel also leaked into `lastEndByOrigin`: a handoff-less segment recorded the end of the
*log* as the lower bound for the next segment of that origin, so if that next segment took the
name-based fallback its window `(p, h)` was empty and its card rendered **no input at all** — a new
data loss, where the pre-`042` code at least showed the wrong-but-present first dispatch. Fixed by
the same change.

**2 — `p` is found by comparison, not by locating `h` in the handoff list.** `runs.indexOf(h)`
assumes the segment's recorded handoff index is the one carrying the `agent_id`. It is not, if a
segment holds more than one `handoff` entry and the last lacks an `agent_id`: `indexOf` returns
`-1`, `p` silently degrades to `-1`, and the lower bound is lost. Taking the greatest handoff index
`< h` is the same cost and has no such precondition.

Both are covered by new regression tests (`keeps a killed agent's card on its OWN dispatch…` and
`a handoff-less segment does not poison the name-fallback window…`), each confirmed to fail against
the first implementation and pass after.

**3 — `log-view` v2.3's text was corrected to match.** Its "Deriving instances" narrative and its
"Things that bite" entry both stated `entries.length` as the sentinel; both now say the end of the
segment, and the description of `p` names the comparison rather than a list position.

**Not a divergence, but an open item on the working tree:** `plugins/maestro/skills/to-maestro-tasks/SKILL.md`
carries an uncommitted one-word edit that is unrelated to this task. It is still a change under
`plugins/`, and `plugin.json` is at `0.4.8` — already committed at `e90c2a9`. Per `CLAUDE.md` that
edit needs a bump to `0.4.9` (patch) if it is committed, or it reaches nobody: the marketplace cache
is keyed on the version string. The claim that "no plugin version bump was needed" is true of this
task's own changes and false of the tree as it stands.

## Scribe handoff

When the code is done, follow the scribe handoff in `apps/maestro/.claude/skills/test-maestro/`:
send the scribe a summary of the changes and ask it to use `/scribe` and `/update-concept-skills`,
tick the criteria above, record any divergences, set this task `done` in `status.json`, and update
`TODO.md` for the next run.
