# Deliver a loop-back payload to a resumed agent and flag it when missing

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

When a reviewing agent fails a run and routes back to an agent that already ran, the orchestrator resumes that agent instead of spawning it cold. In task 085 the reviewer reported writing its loop-back payload to the backend agent's channel (backend/reviewer.1.md), but when the backend agent was resumed the file did not exist, the backend channel directory was empty, and the handoff-issues check reported no problems. The resumed agent worked only from the orchestrator's summary. Find which of the two causes it was: either the reviewer never wrote the file and the stop-time missing-payload check missed it, or something removed it before or during the resume (a cold start retires a delivered file, but a resume may never inject it). Then make a resumed loop-back target actually receive its channel payload, and make handoff-issues report a missing payload in this case instead of staying silent.

## Acceptance criteria

- [ ] The root cause of the missing reviewer-to-backend payload on resume is identified and written into this task file.
- [ ] A resumed loop-back target receives the payload its sender wrote, and the file is retired only after it was delivered.
- [ ] handoff-issues reports a loop-back route whose expected payload is missing, whether or not the target is resumed.
- [ ] Tests cover a payload delivered on resume and a missing payload being flagged; the plugin version is bumped if anything under plugins/ changes.

## Blocked by

None — can start immediately
