# Skip re-injecting static context into a resumed subagent

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

`SubagentStart` fires again on a resumed run. Everything
`maestro-inject-agent-context.js` composes is therefore injected a second time into a context that
already contains it, verbatim:

| Block | Source | Why re-injecting is wrong |
| --- | --- | --- |
| `loaded_skills` | `:217-223` | Tells the agent to `Skill`-load what is already loaded. Worse than waste — it is an instruction to redo a tool call. |
| `referenced_skills` | `:224-235` | ~90 words of standing policy the agent has already read. |
| `HANDOFF:` routing | `:237-249` | The routes have not changed mid-run. |
| Per-route protocols | `:261-277` (guarded at `:271`) | Two or three full JSON shapes, for routes it may not take. |
| Report ("Mandatory Output Format") | `collectReportContext`, called at `:337` | Already in history. |

Call it 500-700 tokens of exact repetition per resumed run. Skip them when the run is a resume.

**Do not skip the channel delivery.** It is the one block that is *not* static: a payload may have
arrived in this agent's lane between its two runs, and delivering it is the reason resume and
channels compose rather than collide. It also does not duplicate on its own — `retire()` moved the
first run's file to `.consumed/`, so `readLane` returns only what is genuinely new. Keep the
`warning` too; a warning is about now, not about the first run.

## The resume signal

A resume is a `SubagentStart` whose `agent_id` **already has a `kind:"handoff"` entry** in this
run's `maestro_session.log.jsonl`. That entry is written by `SubagentStop`
(`maestro-subagent-log.js:114-124`) and only exists once the agent has completed a run.

Three things make this the right signal and each one is load-bearing:

- **The log has exactly the right lifetime.** `maestro-session-cleanup.cjs` deletes it at
  `SessionEnd` alongside `maestro_session.json`, so an entry in it is by construction from this run
  — the same guarantee `036` gets from `run_id`, for free.
- **It is order-independent.** The sibling `SubagentStart` hook (`maestro-subagent-log.js`) writes a
  `kind:"dispatch"` entry carrying the *same* `agent_id`, and both hooks sit in one matcher in
  `hooks.json` with no ordering guarantee between them. Keying on `dispatch` would race — this hook
  could find the sibling's entry for its own run and mistake a first run for a resume. `handoff`
  cannot be written for a run that has not finished, so it is immune.
- **It needs no new write.** `039` establishes the same index; this slice reads it for a different
  question.

`039` already lands `agentRunsFromLog` in `apps/maestro/src/core/agent-runs.ts`. Add the predicate
beside it — `hasCompletedRun(lines, agentId): boolean` — rather than re-parsing the log in the hook,
so the two consumers of this log cannot drift.

**Do not implement this with a counter or an id list in `maestro_session.json`.** It is a
read-modify-write file, parallel subagents race on it, and `session-runtime.ts:56-59` documents that
exact hazard as the reason the log is append-only. The log already answers the question.

## What a resumed run gets instead

Not silence. Replace the five static blocks with one line, before the channel delivery:

> Resumed run — the skills, handoff routes and output format from your first run still apply.

~20 tokens against ~600. The agent's history does contain those blocks, but the report governs the
**new** final message it is about to write, and a resumed agent that forgets its `HANDOFF:` line
strands the workflow. Cheap insurance against a failure whose cost is a stalled run.

If nothing else would be emitted — a resumed run with no delivery and no warning — emit the reminder
alone rather than exiting silently, so `/session-log` still shows the hook fired.

## Files

| File | Change |
| --- | --- |
| `apps/maestro/src/core/agent-runs.ts` | Add `hasCompletedRun(lines, agentId)`. |
| `apps/maestro/src/core/plugin-entries/maestro-session.ts` | Re-export it. Still no new bundle. |
| `plugins/maestro/scripts/maestro-inject-agent-context.js` | Gate the five static blocks; keep delivery and warning; emit the reminder. |
| `plugins/maestro/.claude-plugin/plugin.json` | `0.4.6` → **`0.4.7`** (patch — behaviour change to an existing hook script). |
| `apps/maestro/test/core/*` | Unit tests for `hasCompletedRun`; `parity.test.ts` for the new export. |

## Acceptance criteria

- [ ] A **first** run of an agent gets the full injection exactly as it does today — skills, routing,
      protocols, report — byte-for-byte unchanged. Pin this; it is the regression that matters.
- [ ] A **resumed** run gets none of those five blocks, and gets the one-line reminder instead.
- [ ] A resumed run still gets a channel payload that arrived **between** its two runs, and still
      gets a `warning` when one applies.
- [ ] Two agents running in **parallel** are classified independently — one resuming does not make
      the other look resumed, and neither is misclassified by the sibling hook's `dispatch` entry
      for its own run. Exercise this with both hooks firing, not with a hand-built log.
- [ ] The detection reads `kind:"handoff"`, never `kind:"dispatch"`, and never
      `maestro_session.json`. Source-level pin, for the same reason `038` has one: the failure is a
      race, and no run-level test reliably catches it.
- [ ] A missing or unreadable log classifies as **not** a resume, so the agent gets the full
      injection. Degrading to today's behaviour is the safe direction; degrading to silence is not.
- [ ] `grep -c "node:sqlite" plugins/maestro/scripts/lib/maestro-session.cjs` is `0` after
      `pnpm --filter maestro build:plugin-libs`, and `git diff plugins/maestro/scripts/lib/` is
      inspected — that script fails quietly.
- [ ] `plugin.json` bumped to `0.4.7`.
- [ ] `pnpm --filter maestro test`, `typecheck` and `check` green.
- [ ] Measured, not asserted: capture the injected `additionalContext` for a first run and for a
      resumed run of the same agent and record both sizes on this page. The claim is a ~600-token
      saving; if it is not, say what it actually is.

## Notes for whoever picks this up

- Run the hook by hand with a `SubagentStart` payload on stdin and read the emitted
  `additionalContext`, the way `033` verified its three tiers. That is the fastest way to see both
  branches without driving a whole workflow.
- Resist widening this. Skipping the report is the only judgement call here, and it is deliberate:
  the reminder covers it. Do not also drop the delivery "because the agent has seen a payload
  before" — it has not seen *this* one.
- Concept skill to revisit when this lands (scribe's job): `maestro-architecture`, whose injection
  section currently describes one unconditional shape for every `SubagentStart`.

## Blocked by

`039-resume-subagents-on-loop-back-edges.md` — nothing resumes until the orchestrator resumes it, so
this slice has no observable effect before it, and no way to be tested end to end.
