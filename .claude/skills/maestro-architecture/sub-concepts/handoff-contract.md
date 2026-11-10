# The HANDOFF contract

The subagent has no static knowledge of its handoffs — the `SubagentStart` hook
(`maestro-inject-agent-context.js`) injects, per its active-workflow instance, four blocks on a
**first** run of an `agent_id` (a resumed run gets one line instead — see `agent-resume.md`):

1. **Skills**, in two kinds. `loaded_skills` are auto-loaded (`Skill` tool) before working — the
   imperative "load each one first" block. `referenced_skills` are surfaced as _available_: the
   agent loads one only if the task involves the logic that skill describes (it reads each skill's
   description to decide), otherwise ignores it. A skill that is `loaded` for any matched instance
   is dropped from the referenced list (loaded wins). **An id that resolves outside the repository
   root's `.claude/skills` gets an appended note (`061`)**: the Skill tool only indexes the root
   plus installed plugins, so a monorepo skill discovered elsewhere in the tree answers "Unknown
   skill" there. The hook resolves each injected id with `resolveProjectSkillPath`/`isRootSkillPath`
   (`apps/maestro/src/core/skill-resolve.ts`) and, for any that land outside the root, tells the
   agent to `Read` the file directly instead — an id that resolves inside the root keeps the plain
   wording. See `installing-maestro` for the shared tree walk this reuses.
2. **Routing lines** — the `HANDOFF:` labels this node may emit: `success` (when a success edge
   leaves the node, resolved _through_ non-agent nodes like `human review` to the next agent) plus
   each labeled `condition` edge. Unlabeled condition edges are skipped — they aren't routable.
3. An instruction to **end its final message with exactly one `HANDOFF: <label>`** (`success`, or
   the exact condition label).
4. **The `handoff_details` payload protocol per route** — see below.

The route walk itself is `handoffRoutes()` in `lib/maestro-session.cjs`, shared with the
install-time sync.

## The payload protocol, resolved across three tiers

The protocol is the JSON shape the sender must **write to its channel file**,
`.claude/channels/<scope>/<receiver>/<sender>.1.md` (**`036`**; `<scope>` since `144`, see `channels.md`; before it, the shape of a `handoff_details`
field in the final-message JSON, forwarded by the orchestrator — that forwarding is gone). Since
`033` the shape itself is resolved by one pure `resolveHandoff()` (`src/core/handoff-resolution.ts`)
that the hook and the app both call:

| Tier | Source | Editing surface |
| --- | --- | --- |
| 1 | the project file `.claude/handoffs/<sender>/<receiver>.md` | `/agents`' **Interactions** pane (also drops that pair's `syncedFrom`) |
| 2 | the machine-wide row in `~/.claude/maestro-handoff-defaults.sqlite` | `/templates`' **Handoffs** tab |
| 3 | the `SEED_HANDOFFS` constant (`src/core/handoff-seeds.ts`), shipped **inside** `lib/maestro-session.cjs` | none — a compiled-in constant, edited in source |

The seed tier is a real source, not a synonym for the global one: the sqlite bundle is `require`d in
a try/catch, so on a `node` older than 22.5 the seed is what still answers.

`171`: the global tier is machine-wide, so a sync that reads it can copy another checkout's body. The
installer's `--checkout-seeds` flag (`pnpm refresh:runtime` passes it) takes tier 3 for a checkout's
tracked `.claude/handoffs/` and never opens tier 2.

**A middle tier only exists if its bundle is where the running copy of the hook can `require` it** —
until `035` neither `lib/maestro-handoff-defaults.cjs` nor `lib/maestro-report-defaults.cjs` was
copied into `.claude/scripts/lib/`, so the project's own copy of this hook fell past the global row
in silence (to the seed for handoffs; to *nothing* for a report, which has no seed) while the
plugin's copy, running beside the whole `lib/`, answered correctly — making the arbitration winner
decide what an agent was told. Both are `STATIC_ASSETS` now; a project on a pre-`0.4.4` runtime
still behaves the old way until it re-installs.

Both ends of a route are **bare** agent names (`maestro:test` → `test`), which is what makes the id
`"<sender>/<receiver>"` map straight onto the project file's path. This is the whole communication
layer: agent files no longer carry their own handoff shapes. A route with no seed and no override
just gets the routing line, no payload. See `global-stores` and `agents-view` in
`apps/maestro/.claude/skills`.

Protocol templates live **only** in the agent template files, never in `maestro.json` — keeping the
app/skill byte-identical `maestro.json` invariant intact. The hook reads them as a side input,
exactly as it reads session state.

## What the orchestrator does with the line

The orchestrator (`templates/maestro/SKILL.md`, Step 5) reads the `HANDOFF:` line: `success`
continues the workflow's success path; a label matching a condition edge routes back to that edge's
target node — resuming the target agent when `maestro-resume-target.cjs` finds it a completed run
this session (`039`, see `agent-resume.md`), otherwise dispatching a fresh `Task` exactly as the
success path always does. A missing/unknown line is never
silently `success` (`083`, below).

### Verdict and HANDOFF must agree (`083`)

A real defect must end with the matching condition-edge label when the workflow has one, and a
report `"verdict": "FAIL"` with `HANDOFF: success` is **invalid**. Both the injected routing block
(`maestro-inject-agent-context.js`) and the backend-like/test report seeds (`VERDICT_HANDOFF_NOTE` in
`report-defaults.ts`, previous bodies in `PRIOR_SEEDS`) say so. The `SubagentStop` hook judges every
workflow agent's final message with `checkHandoff` (`core/handoff-check.ts`, in `maestro-session.cjs`):
a **missing** `HANDOFF:` line or a **contradiction** is put on the `kind:"handoff"` log entry as
`handoff_issue`, appended to `session.json`'s `handoff_issues`, and echoed as a `systemMessage`. The
orchestrator template tells it to run `maestro-task-status.cjs handoff-issues` after each subagent
returns — it prints and clears the list — and to route deliberately (matching condition edge, or
resume the agent for a corrected line) instead of defaulting to success. Agents that map to no workflow
instance, and meeting participants, are never judged.

**The scribe gets its ending rule from its own report (`114`).** It carries no verdict, so
`VERDICT_HANDOFF_NOTE` never reached it, and a finished scribe ended `HANDOFF: done` — routed by no
workflow, so the orchestrator stopped and asked. `SCRIBE_ENDING_NOTE` (appended to the scribe report
seed) and the scribe agent file's "Ending your run" section now state it: `SKILL_GAPS_HANDLED:` first
(when gaps were acted on), `HANDOFF:` last; `success` when the docs are done even with skipped steps,
else a routed condition label or the deliberately unrouted `partial`. The note lives in the report,
not only in the `SubagentStart` block, because a resumed scribe never sees that block (`088`).
`checkRoute` is unchanged and still strict.

**Two kinds of failure, two outcomes.** A code defect takes its condition edge back to the
implementer: the default and Tests seeds now wire `@test → <impl>` (`FAIL: a test exposes a code
defect`, split per agent for fullstack; none in tdd, where failing tests come before any code).
Before that, a test failure printed `NO ROUTE for HANDOFF: fail` and stopped. A problem only the
user can fix (a port in use, a service that won't start, missing credentials) ends
`HANDOFF: blocked` (`BLOCKED_LABEL`, `handoff-check.ts`), which every agent learns from the routing
block. With no `blocked` edge in the workflow, `checkRoute` returns kind `blocked` instead of
`unrouted`. `handoff-issues` prints `BLOCKED on the user`, and the orchestrator template tells the
user what to do, then resumes the same agent. A workflow that wires a `blocked` edge routes it
normally. The seeded FAIL edges only reach a new seed; an existing project adds them with
`/update-workflow`.

**The line may arrive in a tool call (`078`, `087`).** Current Claude Code tells every subagent to
end with a `SubagentHandback({message})` call, and then the `SubagentStop` payload has no
`last_assistant_message`. The hook recovers the label from the agent's transcript via
`handbackHandoff` (`core/handoff-label.ts`), which matches every tool in `HANDBACK_TOOLS`
(`SubagentHandback`, `SendMessage`). Trap: `078` matched `SendMessage` only, so in task 084 every
agent was flagged `missing` while each had ended `HANDOFF: success`.

**The transcript is read early, so the hook waits for it (`124`).** Even with the tool name right,
every hand-back agent of task 123 was still flagged `missing`. The parser was fine: Claude Code fires
`SubagentStop` **before** it flushes the agent's final `SubagentHandback` `tool_use` line to
`agent_transcript_path` (probed live: the hook read the file one assistant turn short, with no
hand-back call in it, and the complete file held the line moments later; the payload does carry
`agent_transcript_path`, just no `last_assistant_message`). So the single read of `087` found nothing.
`awaitHandback` (`core/handoff-label.ts`) re-reads every `HANDBACK_POLL_MS` (100 ms) for up to
`HANDBACK_WAIT_MS` (3 s) until a hand-back call appears (`hasHandbackCall`), then judges it as before.
It stops early once any call is present — a labelless one is a real `missing` — or the file cannot be
read, so only an agent that ended with plain text and no label pays the full wait. The sleep and read
are injected; the hook script supplies `fs` and a `setTimeout` promise.

**Only the current run's hand-back counts (`151`).** A resumed agent's transcript still holds the
previous run's hand-back call, so `124`'s "stop once any call is present" ended the wait at once on the
OLD text: task 150's worker logged a resumed test, reviewer and backend agent as copies of their first
runs, and a passing reviewer as `FAIL` plus a false missing-payload warning for the FAIL route.
`scanHandbacks` now ignores every call before the last non-`tool_result` `user` entry (the resume
prompt; a first run's boundary is its own opening prompt, so it reads as before). With no call after
that boundary `awaitHandback` keeps polling, and on timeout returns null (the hook reports `missing`),
never the earlier run's message.

`151`'s two known limits (an unflushed resume prompt returning the earlier hand-back, and a text user
entry after the hand-back discarding it) are closed by `153`, below, as far as the log's dispatch time
and the entries' timestamps allow (pinned by `apps/maestro/test/core/handoff-run-boundary-151.test.ts`,
probes A and B; the closing rule's limit is stated at the end of the `153` run-boundary paragraph).
Still true for entries with no `promptId`: empty-content and mixed user entries open a run (probes D and E).

**A resumed run's payload expectation (`153`).** The payload check is now judged from the run itself.
`runProfile` (`handoff-label.ts`) reports `resumed` (an earlier run's hand-back precedes the boundary)
and `wroteFiles` (a `Write`/`Edit`/`MultiEdit`/`NotebookEdit` call in the current run). A resumed run
that wrote no file only re-verified, so `maestro-subagent-log.js` skips `checkPayload` for it; a resumed
run that edited files and wrote no payload is still flagged, and a first run is checked as before.
`payloadWrittenSince` also counts the sender's next-numbered file (`test.2.md`) in the receiver's lane.
Known limit (accepted): a resumed run that changes files only through Bash (a redirect, `tee`, `sed -i`) counts as re-verify-only, so a payload it skipped is not flagged. Only `Write`/`Edit`/`MultiEdit`/`NotebookEdit` count as writing files (`EDIT_TOOLS`, `handoff-label.ts`).

**The run boundary is a `promptId` change, plus the dispatch time (`153`).** Checked against a real
resumed subagent's transcript: the resume prompt is a `type:"user"` entry with `isMeta: true`,
`origin: {kind: "coordinator"}`, plain-string content and a NEW `promptId`; every later `tool_result`
entry of that run repeats it, and the first run shares the first `promptId`. It is written before the
SubagentStart attachment and before any assistant reply. Two rules replace `151`'s "last non-tool_result
user entry":

- A run opens on a non-`tool_result` user entry whose `promptId` differs from the current run's and
  that is not a bare `isMeta` entry without the coordinator origin. A string `isMeta` reminder after
  the hand-back (`[handback-send-enforce] ...`) is therefore NOT a boundary and no longer discards it.
  Entries with no `promptId` (old fixtures) keep the old rule, minus `isMeta`-only entries.
- A hand-back call whose entry `timestamp` is older than this run's last `kind:"dispatch"` log entry
  (`runStartedAt`, less 1 s slack) belongs to an earlier run and is ignored, even if the resume prompt
  is not in the file yet; `awaitHandback` keeps polling and ends `missing`, never on the old label. No
  known start or no entry timestamp keeps the call (first runs). The same rule applies to a
  file-writing tool call for `runProfile.wroteFiles`: one older than the dispatch is an earlier run's
  and does not make the current run an editing one, so a re-verify with no resume prompt yet is still
  recognised (`resumed` is set by the stale hand-back). The hook passes `runSince` to `awaitHandback`,
  `runProfile` and the payload check. No SubagentStart baseline is used.

Limit that remains: the timestamp rule needs the log's dispatch time and an entry timestamp. With no
dispatch entry, or entries lacking a timestamp, an unflushed resume prompt is not detected and an
earlier run's hand-back or writes are kept, exactly as for a first run.

Fixtures with a hand-back timestamp must be dated after the test's own dispatch (the shared
`handbackTranscript` uses 2099) or the call reads as an earlier run's.

### Interim stops are judged at the run's final stop (`160`)

A workflow agent can stop before it is done (to wait on background work) and be resumed later, so
one run is several stops. Judging each one flagged false `missing` issues (task 075's backend and
reviewer) that the orchestrator then had to dismiss by timestamp. But a stop with no hand-back can
also be the agent's last one, so the judgement is deferred, never dropped.

**What the stop carries.** The `SubagentStop` input has nothing that says "interim": no
pending-background-task field and no final flag (it carries the ids, `agent_type`,
`agent_transcript_path` and sometimes `last_assistant_message`). The transcript has the signal that is
usable: `isInterimStop` (`handoff-label.ts`) is true when the current run (run boundary and dispatch
time rules of `151`/`153`) made no real hand-back call, after `awaitHandback`'s bounded wait for the
flush. A real hand-back is a `SubagentHandback` call (any text), or a `SendMessage` whose message carries an
uppercase `HANDOFF: <label>` line at the start of its line, label on the same line (`077`/`078`;
case-sensitive and line-anchored for this gate only, so a mid-sentence "I will end with HANDOFF: success"
or a prose note such as
`Handoff: waiting on the build` stays interim, while `lastHandoffLabel` itself stays case-insensitive), or a malformed HANDOFF line: a whole line that is `HANDOFF`, an
optional colon and one word, with trailing punctuation (`. , ; !`), backticks and asterisks tolerated,
such as `HANDOFF success` or `HANDOFF success.` (`MALFORMED_HANDOFF_LINE_RE`, `handoff-label.ts`). The
token is case-sensitive uppercase `HANDOFF`, so a prose line such as `Handoff pending` is not one. The malformed one is a final stop flagged `missing` at once, as the pre-160 hook did. Every other
`SendMessage`, including prose that merely mentions the handoff ("waiting on the handoff", "I will send the
HANDOFF line later"), is a mid-run progress note and counts for nothing. There is no
background-task detection: whether work is still pending cannot be read from either source, so the
verdict waits for what happens next.

**The `interim` log marker (read by task 165).** The `kind:"handoff"` log entry gets the field
`interim: true` exactly when the stop is an interim one: its final message carried no `HANDOFF:` line
(`status` is still `unknown`), it is a workflow agent (it maps to a workflow instance; not a meeting or
owner run), the transcript is readable, and no real hand-back call is in the current run. The field is absent otherwise, never `false`. Such an entry has no `handoff_issue`, its `log` text is
`interim stop (no hand-back yet)`, and `status`/`label` stay `unknown`/null. An unreadable or absent
transcript means "cannot tell": that stop is judged at once, as before, and carries no marker.

**Deferred judgement: `pending_interim` in `session.json`.** An interim stop writes
`pending_interim[agent_id] = {ts, agent, agent_id, transcript_path, run_since, cwd, scope}`
(`interim-stop.ts`; the last four are the transcript, the run's dispatch time, and the hook's project dir
and channel scope, kept for the re-read below), no `handoff_issues` entry and no
`systemMessage`, and does not stamp channel files (the stamp refreshes mtimes, which would let a stale
file pass the payload check later). What settles it:

- the agent is resumed: its next `SubagentStart` clears its marker, and every other marker gets
  `moved_on: true` (another WORKFLOW agent was dispatched since; a generic helper such as Explore, a
  meeting or an owner-run agent never counts. Limit: a workflow agent started inside another agent's
  run looks like the orchestrator's own dispatch, so it counts as moving on);
- a repeat interim stop of the same agent id with no resume between rewrites the marker's `ts`, transcript
  and run fields but keeps its `moved_on` and `seen` flags, so a never-resumed agent is still flagged;
- the agent stops again with a judged hand-back (or an immediate judgement): the stop clears the marker
  and judges itself, so an interim stop that is resumed and ends with a valid hand-back leaves nothing;
- `maestro-task-status.cjs handoff-issues` first RE-READS each marker's transcript (`landedHandback`,
  from `run_since`): a hand-back call that was flushed after the stop's 3 s wait settles the marker
  (a valid line leaves nothing; a missing line or a contradiction is recorded as that issue). Only a marker
  whose run still has no hand-back call is promoted: with `moved_on` or `seen` it becomes an ordinary
  `missing` issue (the orchestrator moved on, or this is the second look with no resume between),
  otherwise it prints a "not flagged yet" note, sets `seen: true` and keeps it.

So a plain-text final with no hand-back call, and an agent that stops once and is never resumed, are
still flagged `missing`, on the orchestrator's next handoff check after it moves on or looks twice.

**The settle record (`169`).** `handoff-issues` drops a settled marker from session state, so the
session log gets its own durable line: one `interim_settled` entry per settlement, appended by
`maestro-task-status.cjs handoff-issues` (`logSettlements`) after the `session.json` write that removes
the marker. Built by `interimSettleEntry` (`interim-stop.ts`):

```json
{ "ts": "…", "origin": "main_session", "kind": "interim_settled", "agent": "backend", "agent_id": "…",
  "stop_ts": "…", "settled_as": "missing|late_handback", "label": null, "handoff_issue?": {…}, "log": "…" }
```

- `settled_as: "missing"`: moved on from, or seen twice with no hand-back. `label` is null.
- `settled_as: "late_handback"`: a hand-back landed after the stop, valid or not, so the digest does
  not show it as unsettled forever. `label` is its HANDOFF label; `handoff_issue` is present only when
  the judgement found one.

The SubagentStop hook stamps `settles_in_log: true` next to `interim: true` on every interim handoff
entry logged from `169` on. That stamp says the log is written by a plugin that records settlements.

**How the post-mortem digest reads an interim last stop (`169`).** Checked in this order, per agent run:

| Order | Log holds | Digest outcome |
| --- | --- | --- |
| 1 | an `interim_settled` line for that `agent_id`, logged after the stop (log order, not timestamps) | the record: `missing HANDOFF`, or the late hand-back's label |
| 2 | no such line, but the stop is stamped `settles_in_log: true`, or the log has any `interim_settled` line | `interim stop, not settled yet`: a Pending row, not a Problem (the agent may still be working) |
| 3 | neither (a log written before `169`) | the pre-`169` inference: `missing HANDOFF` (`160`) |

**Still flagged immediately at a judged stop.** A hand-back call with no `HANDOFF:` line (`missing`), a
verdict mismatch (`contradiction`), an unknown route (`unrouted`), and a payload never written in the
whole run (`missing_payload`). A stop with a `HANDOFF:` line in `last_assistant_message` is judged as
before.

**Limits.** The flag for a plain-text final comes later than the stop, at `handoff-issues`, and its log
entry stays `interim: true` with no `handoff_issue`; the settlement is recorded as its own
`interim_settled` line instead (`169`, above). A transcript
flush slower than the 3 s wait reads as interim, but the promotion re-reads the transcript, so a valid
hand-back that landed in the meantime is not flagged falsely. The late hand-back goes through the same
judgement as an on-time one (`judgeLandedHandback`, `maestro-task-status.cjs`: HANDOFF line and verdict,
route against the active workflow, payload from the agent's first dispatch), so a late unknown route
(`unrouted`) or unwritten payload (`missing_payload`) is flagged by `handoff-issues`. A hand-back that
has still not landed at a check is NOT flagged `missing` on the first look: the marker only gets
`seen: true` and a "not flagged yet" note. It is flagged `missing` on the second look, or at the first
look after another workflow agent was dispatched (`moved_on`). An agent that
stops mid-run and is resumed only after the orchestrator has dispatched another agent is flagged in the
meantime and the flag is stale by then (the orchestrator resumes it anyway).

**The payload is measured from the whole run.** `agentRunStartedAt` (`handoff-payload.ts`) is the
agent id's FIRST `dispatch` log entry, which `maestro-subagent-log.js` passes to `payloadWrittenSince`,
so a payload written before a resume counts. A file left from an earlier run of the same agent type
predates that first dispatch and still does not count. The transcript boundary rules keep using the
LAST dispatch (`runStartedAt`). Limit: on a loop-back resume of a finished agent, the first run's
payload would count if it were still in the lane; the receiver's delivery retires it, so in practice
it is gone.

### A payload route must be written (`087`)

The third issue kind, `missing_payload` (`checkPayload` in `handoff-check.ts`): the `HANDOFF:` label
names a route whose pair resolves a protocol (same three-tier resolution as the injector, via
`payloadRoutes` in `core/handoff-payload.ts`, so the two hooks cannot disagree), and the sender's
channel file for that receiver was not written **during this run**. "This run" starts at the agent's
FIRST `kind:"dispatch"` log entry (`agentRunStartedAt`, `160`: a payload written before a resume still counts; the transcript boundary keeps the LAST one, `runStartedAt`), with
1 s mtime slack (`payloadWrittenSince`); no dispatch entry ⇒ the file merely existing counts. It runs only when
`checkHandoff` and `checkRoute` both found nothing, never for an interim stop, and never for a resumed
run that wrote no file (`153`); it travels the same way as the other two, plus
`files[]` on the log entry and `session.json`. The orchestrator **resumes** the sender to write the
named file, never skips it and never dispatches the receiver without it. Prevention side: the
injected block (`payloadRequirement`) states the write as REQUIRED before the `HANDOFF:` line on
every pass — but a resume never sees it, since Claude Code drops a resume's `additionalContext`
(`088`, see `agent-resume.md`). Receiving side (`088`): `maestro-resume-target.cjs` records a
`missing_payload` issue (and prints `missing:`) when a loop-back's expected payload is not in the
target's lane, whether the target is then resumed or cold. `handoff-issues` drops a `missing_payload`
whose files sit in the lane stamped with this run's id (`139`, see `channels.md`) **and** were written at or after the issue's `ts` (`156`, 1 s slack). An earlier run of the same agent shares the run id but predates the warning, so its payload never resolves it. An unreadable mtime or an unparseable `ts` never resolves it. `maestro-resume-target.cjs` applies the same rule.

**It never sees the payload (`036`).** The sender wrote it straight to the receiver's channel file,
and the receiver's own `SubagentStart` inlines it (a resumed receiver is instead handed the path, `088`) — the orchestrator's job is routing only. The one
place the orchestrator still touches a channel file is a **skill step** in the success path: a skill
node has no `SubagentStart` of its own, so if it needs the upstream payload the orchestrator reads
`.claude/channels/<scope>/<downstream receiver>/<upstream sender>.*.md` itself, **without retiring it** —
retiring is `SubagentStart`'s job alone, so a read here starves nobody; the downstream agent still
gets its own delivery.

**A payload restored after a restart is still the sender's (`159`).** When a resumable end cut a run
off, `restoreInterruptedDeliveries` moves its delivered payload back into the receiver's lane (guards
in `channels.md`). The re-run then gets it as usual: inlined on a cold start, printed as `deliver:` on
a resume. A `missing:` line after a restart means the restore skipped that file or the sender never
wrote it.

**Condition edges from a `human review` node are the exception — orchestrator-driven, not
HANDOFF-driven.** A human-review node has no subagent, so nothing emits a `HANDOFF:` line for it.
Instead the orchestrator itself, at the human-review hard stop, summarises the work and asks with
`AskUserQuestion` (`Approve` / `Request changes`, corrections through its free-text option; plain
text when `AskUserQuestion` is unavailable or fails; the review file's path is the FIRST line of both
the Approve preview digest and the printed summary, and a shortened digest ends by saying the full
text is in the review file), then reads the user's answer: on
approval it continues the success path; on a correction request it dispatches the change as a `Task`
to the agent a `condition` edge points at (e.g. `human requested code corrections` → `@backend`),
rather than editing code in its own context. The seeded infra-only `default` workflow wires this edge
automatically (`buildInfraWorkflow` in `seed.ts`); the seeded `default`/`tdd` workflows carry no human
review node, only the manager review loop-backs below.

A `manager review` node (`132`) is orchestrator-driven the same way: the verdict comes from the
epic's manager session (`maestro-epic.cjs review-verdict`), not a `HANDOFF:` line, and a `redirect`
follows its `manager requested direction change` edge to the producing agent. Mechanism: the
**Manager review** section of this skill's `SKILL.md`.

### The Backend workflow's test-fix loop (`167`)

This repository's own `Backend` workflow (`.claude/maestro.json`, not the seed) is tuned to end a
backend-test-fix loop sooner; task 160 took nine rounds because each fix patched one rule and @test
then found its neighbour. Three project-local pieces, none of them in the plugin:

- **`test -> backend` carries the class.** `.claude/handoffs/test/backend.md` adds `defectClass` (short
  name) and `sameClassProbes` (other inputs of that class @test checked or expects to fail); @backend is
  told to fix the whole class in one round.
- **`backend -> test` carries a grammar.** `.claude/handoffs/backend/test.md` adds `grammar` (accepted
  forms, rejected forms, one example of each) when the change classifies free text; @backend writes it
  before coding and @test derives its edge sweep from it.
- **A repeating class escalates.** A `test -> refactor` condition edge fires when the new `defectClass`
  equals the one in each of the previous two backend rounds. The comparison is recorded, not
  impressionistic: `.claude/agents/test.md` has @test keep its own ledger
  `.claude/channels/<scope>/defect-classes.md` (one `round <n> | <defectClass>` line per round) and
  quote the three values in its report. It does not use `.consumed/backend/test.*.md`: every round
  writes `test.1.md` and `retire` renames by file name, so each round overwrites the previous copy
  there, and `SessionEnd` can sweep it. @refactor reports whether the defects come from the design;
  the existing `refactor -> backend` edge sends the fix back. The edge is a condition, so the
  HANDOFFS success-path table is unchanged. The `test -> refactor` pair has no handoff file, so no
  payload is required for it.
- **`runtimeVersion` moved as a side effect.** `.claude/maestro.json` `runtimeVersion` went
  0.13.34 -> 0.13.36 when the runtime was refreshed; it is not a workflow change.

## Things that bite

- **Anything `.md` under `agents/` is discovered as an agent.** A frontmatter-less `.md` inside the
  agents tree gets registered as a phantom agent (e.g. `…:refactor:handoffs:backend`) with **All
  tools**, which is why handoff protocols were never kept there. Since `033` they are not files in
  the plugin at all: `plugins/maestro/templates/handoffs/**` is **deleted** and
  `readHandoffProtocol()` no longer exists. **To add a sender/receiver pair *that Maestro ships*,
  add a key to `SEED_HANDOFFS` in `apps/maestro/src/core/handoff-seeds.ts`** (a pair only *this
  machine* needs is a Create on `/templates`' Handoffs tab instead — a global row, no rebuild), then
  re-run `pnpm --filter maestro build:plugin-libs` — editing the source without rebuilding leaves
  the hook reading the old bundle. Editing an *existing* seed body additionally needs its previous
  text in `PRIOR_SEEDS`, or every machine that has already opened the global store keeps serving the
  old one, silently.
