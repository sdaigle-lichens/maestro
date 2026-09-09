# Move handoff payloads onto agent channels

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Today every payload an agent produces travels through the orchestrator's context. The subagent ends
with a JSON report, the orchestrator reads all of it, and then — per
`plugins/maestro/templates/maestro/SKILL.md` — *"pass that `handoff_details` payload verbatim in its
`Task` prompt"*. So the fat part of every report is paid for twice, and it can only ride one edge:
one report, one `HANDOFF:` line, one receiver.

Replace that with **channels**: a sender writes a file into the receiving agent's lane, and the
`SubagentStart` hook inlines it when that agent is invoked.

```
.claude/channels/
  reviewer/
    backend.1.md        ← written by @backend, delivered to @reviewer
    test.1.md
  test/
    backend.1.md
  scribe/
    backend.1.md        ← concept-skill gaps, waiting for a scribe that may never run
  .consumed/
    reviewer/backend.1.md
```

### Be honest about what this buys

**Not primarily tokens.** A subagent's final message returns to its caller no matter what — `Task`
hands it back. Channels shrink that message, they do not remove it. What they genuinely eliminate is
the second payment: the orchestrator re-emitting the payload into the next `Task` prompt. Across a
five-step workflow that is single-digit thousands of tokens in a session that is also holding the
orchestrator skill, the task graph and its own file reads.

**The win is fan-out and the removal of a stateful obligation.** One agent can address three
receivers, each differently — `backend → reviewer` wants `areas_of_concern`, `backend → test` wants
edge cases — which is exactly what the 23 per-pair handoff templates from `033` already model. The
channel directory is the runtime instance of the template `033` made editable.

And the orchestrator stops having to remember things. `templates/maestro/SKILL.md:58` currently
reads:

> Collect them across the run and hand them to `@scribe` (in the `handoff_details` of the scribe
> step if the workflow has one, **otherwise as a dispatch of its own once the success path
> completes**)

That parenthetical is an admission that `conceptSkillGaps` is not route-shaped: any agent can
produce one whether or not an edge to the scribe exists, so the instruction has to carry a fallback
that lives entirely in the orchestrator's memory, across a whole run, with nothing detecting the
drop. A lane the scribe drains makes the workflow graph irrelevant to it.

### What moves and what stays

| Field | Where it goes | Why |
| --- | --- | --- |
| `subagent`, `verdict`, `description` | **stays in the final message** | The orchestrator routes on the verdict and surfaces `description` at a `human review` hard stop. |
| `HANDOFF:` line | **stays** | Routing. `maestro-subagent-log.js`'s `parseHandoff` is unchanged. |
| `skillsTriage` | **stays** | Verified: its only consumer is `/session-log` (`session-log.ts:113` parses it out of the stored final message; `unaccountedSkills()` diffs it against the dispatch entry's `offered_skills`). It costs nothing to transport — the message returns anyway and the parse is free, after the fact, in the renderer. Making the agent write it explicitly would trade that for a mandatory tool call it can forget, and `parseSkillsTriage` is deliberately tolerant *because agents already omit it*. Leave it. |
| `filesChanged` | **channel** | `grep` finds **zero consumers** — not the app, not the hooks, not the orchestrator skill. It exists purely as prose for the next agent, which makes it the purest channel candidate in the report. |
| `handoff_details` | **channel**, per receiver | The fat part, the part paid for twice, already per-pair. |
| `conceptSkillGaps` | **channel**, the scribe's lane | See above. |

### One lifetime rule

**A channel file lives until the agent that receives it consumes it.** Not flushed at `SessionEnd`.
One rule, no special case for the scribe lane — and the persistent-backlog behaviour gaps need falls
out of it as a consequence rather than an exception: the gaps lane is simply a lane whose only
reader is the scribe, so it spans runs because nothing else drains it.

That rule answers **delivery**. `SessionEnd`-flush was quietly providing two other properties, and
dropping it means answering them explicitly.

**Freshness.** This is the one that bites, and it is not hypothetical: Maestro runs are abandoned
mid-path routinely, because `human review` is a hard stop and condition edges loop back. So
`@backend` writes into the reviewer's lane, the user walks away at the review stop, and next week an
unrelated run invokes `@reviewer` — and the hook inlines last week's payload as `additionalContext`,
indistinguishable from something current. Silent, and confusing in exactly the way that wastes an
afternoon.

The guard is a **run stamp**. `maestro_session.json` is already the per-run ephemeral marker — created
during a run, deleted at `SessionEnd` — so a new run necessarily gets a new one. Mint a `run_id`
into it (`MaestroSession` gains one field) and stamp every channel file with it. Then the injector:

- **same run** → inline the payload, retire the file;
- **different run, or unstamped** → do **not** inline; emit one line naming the file and its age, and
  leave it on disk.

Two lines of context instead of a silent poisoning, the resume case still works because the agent can
go read the file if it judges it relevant, and the hook never guesses.

**Boundedness.** Nothing ever invokes `@mobile` again and its lane grows forever. `SessionEnd` stops
deleting and starts **sweeping**: retire `.consumed/` and anything past an age cap (14 days). Same
hook, different verb.

### Who stamps

**Not the agent.** Asking a subagent to write correct frontmatter carrying a run id it has to look
up is a protocol it will get wrong, silently, the way it already omits `skillsTriage`.

The agent writes the body and nothing else, to `.claude/channels/<receiver>/<sender>.<n>.md`.
`SubagentStop` — already firing, already holding `agent_type` and the project dir — stamps every
unstamped file under `.claude/channels/*/` whose filename sender segment matches **its own bare
agent type**. That last clause is what keeps two parallel subagents from stamping each other's
writes.

A file left unstamped (its author was killed between the write and `SubagentStop`) is treated exactly
like a foreign-run file: mentioned, not inlined.

### Delivery, at `SubagentStart`

`maestro-inject-agent-context.js` gains a fourth `additionalContext` part, resolved for the **bare**
agent type (`maestro:test` is `test` — the bug `033` fixed on both ends of a route id):

1. read `.claude/channels/<bare agentType>/`;
2. inline every file stamped with the current `run_id`, each labelled with its sender;
3. retire what it inlined by moving it to `.claude/channels/.consumed/<receiver>/`;
4. for anything else, emit one line per file: sender, age, path.

**Retire by moving, never by deleting.** Consuming at `SubagentStart` creates a durable
*delivered-but-dropped* state the flush used to hide: the agent gets the payload, then fails, and the
file is already retired. Accept that for this slice — it is no worse than the flush, which loses it
too — but `.consumed/` plus the age cap means it is recoverable for two weeks rather than gone. If it
turns out to bite, the fix is retiring at `SubagentStop` instead, correlating on the `agent_id` that
hook already receives. Do not build the two-phase claim up front.

### The orchestrator template, line by line

`plugins/maestro/templates/maestro/SKILL.md` is where the old contract is written down, so it is
where the change is most likely to be under-done. Its `Maestro:STEPS` and `Maestro:PRINCIPLES`
regions are generated, so an edit here reaches a project only through
`maestro-render-orchestrator.cjs` (or an app save) — an already-installed project keeps the old
prose until it updates, which the plugin bump drives.

| Line | Today | After |
| --- | --- | --- |
| 45 (skill step) | *"The previous step's `handoff_details` payload is already in your context"* | **False after this slice.** See below. |
| 48 (agent step) | *"the `handoff_details` payload shape for each route"* | The hook injects the shape to **write**, and delivers whatever is waiting in this agent's lane. |
| 56 | **Forward the handoff payload.** | **Deleted.** Nothing to forward — the payload never enters the orchestrator's context. |
| 58 | **Route `conceptSkillGaps` to the scribe.** | **Deleted entirely.** |
| 79 (principle) | *"Feed it the prior step's handoff payload where relevant"* | Rewritten with the skill-step rule below. |
| — | — | **New principle:** payloads travel on channels, not through you. Do not summarise, relay, or paraphrase one. |

**Delete `conceptSkillGaps` from this file completely — do not reword it.** The knowledge already
lives on the scribe's side, in two places that need no orchestrator help:
`plugins/maestro/skills/scribe/SKILL.md`'s *"Reporting a gap"* section (*"That is the signal to run
`/update-single-concept-skill` on that skill"*) and `agents/scribe.md:76`. Under this slice the
injector puts the lane into the scribe's context at `SubagentStart`, so the scribe reads gaps the
same way it reads anything else addressed to it. Both scribe-side texts need one wording pass — they
say agents *report* gaps in their report; they now arrive on the channel — and that is the whole
change.

### The hole this opens: skill steps

`handoffRoutes` resolves a **success** edge *through* non-agent nodes, skill nodes included. So
`@backend → /some-skill → @test` produces the route `backend → test`, and backend writes into
`test`'s lane. The skill step in the middle is not a receiver, has no lane, and never fires
`SubagentStart` — it runs inline in the orchestrator's own context. Today line 45 is true only
because the orchestrator forwarded the payload by hand. After this slice it is false, and a skill
step loses its input **silently**, which is the failure mode this whole page is trying to remove.

**The fix is a read that does not retire.** For a skill step, the orchestrator reads
`.claude/channels/<downstream receiver>/<sender>.*.md` and leaves the files exactly where they are.
Retiring is `SubagentStart`'s job and nothing else's, so reading here starves no one — the
downstream agent still gets its delivery. Say this explicitly at line 45 and in the rewritten
principle; do not leave the orchestrator to infer that a read is safe.

### The seed rewrite, and the trap in it

The 23 `SEED_HANDOFFS` bodies say *"set the `handoff_details` field of your output JSON to…"*. They
become *"write this JSON to `.claude/channels/<receiver>/<sender>.1.md`"*. The `SEED_REPORTS` bodies
lose `filesChanged` and `conceptSkillGaps` and gain a line about the lane.

**`handoff-defaults.ts` and `report-defaults.ts` both require that a changed seed body's previous
text is moved into `PRIOR_SEEDS` verbatim.** Both files say so in a comment; both fail *silently* if
you skip it — `seedIfEmpty` only fires on a store that has never been written to, so on any machine
that has already opened the store, editing a seed does nothing at all. `refreshSupersededSeeds` is
what carries the change to those rows, and it can only recognise a row it has the prior text for.
This is the single most likely way to ship this slice broken and not notice.

### Where the code goes

`handoff-channels.ts` in `src/core` — `channelDir`, `laneFor`, `writeStamp`, `readLane`, `retire`,
`sweep`, and the parse/format of the stamp. `fs` and `path` only.

**Re-export it from `plugin-entries/maestro-session.ts`. Do not add a 12th bundle.** The hooks already
`require("./lib/maestro-session.cjs")` unconditionally, so a re-export needs no new bundle, no new
`STATIC_ASSETS` entry, and no manifest change in either installer. The constraint that comes with
that: `maestro-session.cjs` must stay free of `node:sqlite` — the property `handoff-seeds.ts`'s header
pins with `grep -c "node:sqlite" plugins/maestro/scripts/lib/maestro-session.cjs → 0`. Channels need
no sqlite, so this costs nothing.

If a later change does force a separate bundle, both `STATIC_ASSETS` manifests must gain it or
`install.test.ts`'s require-audit from `035` fails — which is the point of that test.

### `.gitignore`

`ensureRepoRootGitignore` currently writes three `**/.claude/maestro_session*` globs. Add
`**/.claude/channels/`. Both implementations — `install.ts:412-414` and
`maestro-install.js:258-260` — and note that the existing `GITIGNORE_HEADER` says *"removed at
SessionEnd"*, which is no longer true of everything under it. Reword it.

### Log entries for `/session-log`

The injector, when it inlines a payload, appends a `kind: "channel_delivery"` entry to
`maestro_session.log.jsonl` recording sender, receiver, `agent_id` and content. `037` renders it.
Write the entry here, in the hook, so the log is not blind for a release.

This is strictly better than what the log shows today: the payload currently appears in the
*sender's* Output panel and you correlate by hand; delivered payloads attach to the receiver's
dispatch, where they were actually used.

### Files

| File | Change |
| --- | --- |
| `apps/maestro/src/core/handoff-channels.ts` | **new** — lanes, stamps, retire, sweep. `fs`/`path` only. |
| `apps/maestro/src/core/session-runtime.ts` | `MaestroSession` gains `run_id`; minted on first write. |
| `apps/maestro/src/core/plugin-entries/maestro-session.ts` | Re-export the channel surface. Must stay sqlite-free. |
| `apps/maestro/src/core/handoff-seeds.ts` | 23 bodies rewritten; **every prior body into `PRIOR_SEEDS`**. |
| `apps/maestro/src/core/report-defaults.ts` | `SEED_REPORTS` loses `filesChanged` / `conceptSkillGaps`; **prior bodies into `PRIOR_SEEDS`**. |
| `apps/maestro/src/core/install.ts` | `.gitignore` glob; reworded header. |
| `plugins/maestro/scripts/maestro-inject-agent-context.js` | Fourth context part: deliver, retire, log. |
| `plugins/maestro/scripts/maestro-subagent-log.js` | `SubagentStop` stamps its own unstamped writes. |
| `plugins/maestro/scripts/maestro-session-cleanup.cjs` + `.sh` | Flush → sweep. |
| `plugins/maestro/scripts/maestro-install.js` | The mirrored `.gitignore` change. |
| `plugins/maestro/templates/maestro/SKILL.md` | The line-by-line table above: 56 and 58 deleted, 45/48/79 rewritten, one new principle. |
| `plugins/maestro/agents/*.md` | Wording where they describe reporting a payload. |
| `plugins/maestro/agents/scribe.md`, `skills/scribe/SKILL.md` | Gaps arrive on the channel, not in a caller's report. Behaviour unchanged. |
| `plugins/maestro/.claude-plugin/plugin.json` | `0.4.4 → 0.4.5` (**patch** — behaviour change to existing scripts, no new skill/agent/command/hook event). |
| `apps/maestro/test/core/handoff-channels.test.ts` | **new**. |
| `apps/maestro/test/core/parity.test.ts` | The re-exported channel surface. |

## Acceptance criteria

- [x] An agent writing `.claude/channels/<receiver>/<sender>.<n>.md` has it stamped at
      `SubagentStop` with the current `run_id`, and a parallel subagent of a different type does not
      stamp it.
      Evidence: `handoff-channels.ts`'s `writeStamp` keys strictly on the filename's sender segment;
      `install.test.ts` → "agent channels (036)" → *"stamps a channel file at SubagentStop, and a
      different sender's write is untouched"*.
- [x] `SubagentStart` for that receiver inlines the payload as `additionalContext`, labelled with its
      sender, and moves the file to `.claude/channels/.consumed/<receiver>/`.
      Evidence: `install.test.ts` → *"delivers a same-run stamped file at SubagentStart, retires it,
      and logs a channel_delivery entry"*.
- [x] A second `SubagentStart` for the same receiver in the same run does **not** re-deliver a
      consumed payload.
      Evidence: same test, the "nothing left to deliver" assertion on a second `SubagentStart` call.
- [x] A file stamped with a **different** `run_id` is not inlined; the hook emits one line naming it,
      its age and its path, and leaves it on disk. Same for an unstamped file.
      Evidence: `install.test.ts` → *"does NOT inline a file stamped with a different run_id, or an
      unstamped one — only mentions them, and leaves them on disk"*.
- [x] `run_id` is minted into `maestro_session.json`, and a run that starts after a `SessionEnd` gets
      a different one.
      Evidence: `install.test.ts` → *"mints run_id into maestro_session.json (at SubagentStop, which
      always touches it), and a run after SessionEnd gets a different one"*; unit coverage in
      `test/core/session-runtime.test.ts` (new).
- [x] `SessionEnd` sweeps `.consumed/` and lane files past the age cap, and **does not** delete
      unconsumed, in-cap lane files — including the scribe's, when no scribe ran.
      Evidence: `install.test.ts` → *"SessionEnd sweeps .consumed/ and ages out a lane file past the
      cap, but leaves an in-cap undelivered file — including the scribe's own lane"*.
- [x] `conceptSkillGaps` written by an agent with no route to the scribe still reaches
      `.claude/channels/scribe/` and is delivered on the next `@scribe` invocation, in a later run.
      Evidence: `install.test.ts` → *"a concept-skill gap from an agent with no route to scribe still
      reaches the scribe's lane across a SessionEnd"*. **Divergence** — see note 2 below: a
      different-run delivery is surfaced by *mention* (sender/age/path), not literal inlining: same
      outcome (the scribe reads it), different wording than the criterion's "delivered".
- [x] Every rewritten seed body has its previous text in `PRIOR_SEEDS`, and `refreshSupersededSeeds`
      carries the change to an **already-seeded** store — assert against a store seeded with the old
      bodies, not a fresh one.
      Evidence: `report-defaults.test.ts` → "superseded seed migration" → the updated assertion for
      the new content shape, plus the new v2 (pre-`036`) migration test; `handoff-seeds.ts`'s
      `PRIOR_SEEDS` carries all 23 previous bodies.
- [x] `grep -c "node:sqlite" plugins/maestro/scripts/lib/maestro-session.cjs` is `0` after
      `pnpm --filter maestro build:plugin-libs`, and `git status plugins/maestro/scripts/lib/` is read
      afterwards — that script fails quietly.
      Evidence: verified directly — `grep -c "node:sqlite" plugins/maestro/scripts/lib/maestro-session.cjs`
      → `0`. Also pinned by `test/core/parity.test.ts` → *"maestro-session.cjs carries the channel
      surface (036), and reaches no node:sqlite"*.
- [x] `**/.claude/channels/` is in both `.gitignore` implementations and the header no longer claims
      everything under it is removed at `SessionEnd`.
      Evidence: `install.ts:419` and `maestro-install.js:265` both list the glob;
      `GITIGNORE_HEADER` in `install.ts:413` reads "recreated as needed, never committed".
- [x] A `channel_delivery` entry lands in `maestro_session.log.jsonl` with sender, receiver,
      `agent_id` and content.
      Evidence: `maestro-inject-agent-context.js:305-314` appends `kind: "channel_delivery"` with
      `sender`, `receiver`, `agent_id`, `content`; covered by the delivery test above.
- [x] Route ids stay **bare** on both ends — a project whose instances carry `maestro:test` resolves
      its lane. This is `033`'s bug; do not reintroduce it one directory over.
      Evidence: `bareAgentName(agentType)` is used on both the write side (protocol block) and the
      read side (channel delivery block) of `maestro-inject-agent-context.js`.
- [x] `templates/maestro/SKILL.md` no longer mentions `conceptSkillGaps` **anywhere** — `grep -c` is
      `0` — and no longer instructs the orchestrator to forward a payload.
      Evidence: verified directly — `grep -c conceptSkillGaps plugins/maestro/templates/maestro/SKILL.md`
      → `0`. Line 78's new principle: *"Payloads travel on channels, not through you."*
- [x] A skill step between two agents still receives the upstream payload, and reading it leaves the
      downstream agent's delivery intact — assert the file is still in the lane after the read.
      Evidence: `templates/maestro/SKILL.md:45` — the skill-step instruction to `Read`/`Glob` the
      channel file **without retiring it**; retiring stays `SubagentStart`'s job alone.
- [x] The scribe still runs `/update-single-concept-skill` on a delivered gap with nothing in the
      orchestrator telling it to.
      Evidence: `plugins/maestro/agents/scribe.md` and `plugins/maestro/skills/scribe/SKILL.md`
      reworded to say a gap arrives on the channel and is read like anything else addressed to the
      scribe — no orchestrator-side instruction needed, matching the template's `conceptSkillGaps`
      deletion above.
- [x] `install.test.ts`'s require-audit still passes, and no new `STATIC_ASSETS` entry was needed.
      Evidence: `handoff-channels.ts` re-exports through the existing `maestro-session.ts` entry
      point rather than a 12th bundle; no `STATIC_ASSETS` change in either installer.
- [x] `pnpm --filter maestro test`, `typecheck` and `check` green.
      Evidence: 870/870 tests passing, verified at close-out
      (`pnpm --filter maestro test` — 45 test files, 870 tests, all green).

### Divergences from what this page planned

1. **`collect()`'s session-write bug, found and fixed while implementing.** Not on this page at
   all — a pre-existing latent bug in `maestro-inject-agent-context.js`'s `collect()`: `writeSession`
   built a bare `{workflow, generated_instances}` object instead of spreading the read session,
   silently dropping `active_task` and any future field on every dispatch that resolves a workflow
   instance. It became load-bearing for this slice because it would have wiped `run_id` on every
   such dispatch, breaking same-run delivery — so it was fixed here rather than filed separately.
2. **"Delivered ... in a later run" is implemented as reached-and-mentioned, not literally inlined,
   for a different/absent `run_id`.** Consistent with this page's own "One rule, no special case for
   the scribe lane" and its freshness section ("different run → do not inline; mention"), read as: the
   *outcome* (the scribe eventually processes the gap, per its own skill instructions to read what's
   mentioned) rather than automatic inlining regardless of run. Flagged here in case that reading
   isn't the intended one.
3. Added `apps/maestro/test/core/session-runtime.test.ts`, not named in the task's file table — unit
   coverage of `ensureSessionRunId` directly rather than only through hook integration tests.
4. Added the channel-surface re-exports to `apps/maestro/src/core/index.ts` (the app-side barrel),
   not mentioned in the task's file list — every other `handoff-*` module is already re-exported
   there, and `037` (next in the queue) needs it.

## Notes for whoever picks this up

Read `.claude/skills/maestro-architecture/` for the HANDOFF contract, then
`apps/maestro/.claude/skills/global-stores/` for the seed/`PRIOR_SEEDS` mechanism you are about to
change, and `apps/maestro/.claude/skills/plugin-libs-parity/` before touching `plugin-entries/`.

- **Verify the hook by hand, on stdin.** Feed `maestro-inject-agent-context.js` a real
  `SubagentStart` payload and read the emitted `additionalContext` — with a same-run file, a
  foreign-run file, and an unstamped one. `033` and `035` were both settled this way and it is faster
  than any fixture.
- **The two hook copies both run.** A project-local copy in `<project>/.claude/scripts/` and the
  plugin's marketplace copy arbitrate through `projectOwnsHook`. Test the path a project actually
  takes, not only the plugin's — `035` existed because those two disagreed silently.
- Do not let the delivery block grow into a summary of the payload. Inline it verbatim; the whole
  point is that the orchestrator never had to read it.

## Blocked by

(nothing)
