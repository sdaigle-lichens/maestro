# Deliver a loop-back payload to a resumed agent and flag it when missing

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

When a reviewing agent fails a run and routes back to an agent that already ran, the orchestrator resumes that agent instead of spawning it cold. In task 085 the reviewer reported writing its loop-back payload to the backend agent's channel (backend/reviewer.1.md), but when the backend agent was resumed the file did not exist, the backend channel directory was empty, and the handoff-issues check reported no problems. The resumed agent worked only from the orchestrator's summary. Find which of the two causes it was: either the reviewer never wrote the file and the stop-time missing-payload check missed it, or something removed it before or during the resume (a cold start retires a delivered file, but a resume may never inject it). Then make a resumed loop-back target actually receive its channel payload, and make handoff-issues report a missing payload in this case instead of staying silent.

In the same run, the scribe agent ended with no HANDOFF line at all. The stop hook's missing-HANDOFF check (083, fixed for hand-backs in 087) exists to catch this. Verify from the 085 session's log whether that run's entry carried a handoff issue and whether handoff-issues printed it. If it stayed silent, find out why (for example, the scribe instance not counting as a workflow agent, a resumed or skill-step run being skipped, or the issue being cleared before the orchestrator read it) and fix it, since both silences may share a cause.

## Acceptance criteria

- [ ] The root cause of the missing reviewer-to-backend payload on resume is identified and written into this task file.
- [ ] A resumed loop-back target receives the payload its sender wrote, and the file is retired only after it was delivered.
- [ ] handoff-issues reports a loop-back route whose expected payload is missing, whether or not the target is resumed.
- [ ] Whether handoff-issues reported scribe's missing HANDOFF line in 085 is established. If it didn't, the cause is fixed, and a test spawns the real stop hook for a scribe-like workflow agent with no HANDOFF line and proves handoff-issues prints it.
- [ ] Tests cover a payload delivered on resume and a missing payload being flagged; the plugin version is bumped if anything under plugins/ changes.

## Blocked by

None — can start immediately

## Root cause

**Payload: removed during the resume, not never written.** In session `c348348d` the reviewer wrote
`.claude/channels/backend/reviewer.1.md` (log line 128) before its FAIL handoff (line 130), so the
stop-time missing-payload check correctly passed. The orchestrator then resumed the backend with
`SendMessage` (line 132). Claude Code 2.1.296 runs SubagentStart for a resume:
`maestro-inject-agent-context` saw a current-run file in the backend lane, inlined it, retired it to
`.consumed/backend/` and logged `channel_delivery` (line 133, agent `a99b7f8538d71fbe6`). But Claude
Code does not attach a resumed run's `additionalContext` to the agent: the backend transcript has a
`hook_success` attachment carrying that output (line 158) and no `hook_additional_context` entry,
unlike its first run (lines 2-3). The backend's `cat` of the file then failed (lines 160-161) and it
worked from the orchestrator's summary. So the file was retired without being delivered, and nothing
on the receiving side checked. The same drop also silences 087's resume REQUIRED-payload reminder.

**Fix.** A resume's payload now travels by path in the orchestrator's own `SendMessage`:
`maestro-resume-target.cjs` prints `deliver: <file>` for each current-run lane file and records
them in `session.json` `resume_deliveries`; SubagentStart on a resume no longer inlines or retires;
the resumed run's own SubagentStop retires the recorded files and logs `channel_delivery`
(`via: "resume"`). The same CLI prints `missing: <file> (from <sender>)` and records a
`missing_payload` handoff issue when the latest handoff's route to the target expects a payload
that is not in the lane, resumed or cold (`src/core/resume-delivery.ts`).

**Scribe: recorded and printed, no fix needed.** The scribe's run ended with a `SubagentHandback`
that had no HANDOFF line. Its log entry (line 234) carries `handoff_issue {kind: "missing"}`, the
SubagentStop hook emitted "maestro:scribe handoff problem (missing)", and the next `handoff-issues`
run (line 235; main transcript line 294) printed `maestro:scribe: NO HANDOFF line`. The orchestrator
then chose to treat the scribe step as done (main transcript line 300). The check worked, so no
stop-hook test was added; the two silences did not share a cause.
