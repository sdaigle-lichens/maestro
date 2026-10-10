# Let owning agents apply approved team-meeting changes and auto-apply the low-risk tier

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Today the maestro-team-meeting skill ends with the moderator (the main session) applying every approved proposal by hand, including the low-risk auto tier. Change the apply phase so that:

1. An apply-placement command applies the automatic tier from the meeting tally: skill loaded/referenced moves and handoff-template edits. It reads maestro.json immediately before writing, preserves every other slice, and skips any target that is in conflict.
2. After the user approves the batch and the meeting has been closed (closeMeeting), each approved proposal that has a single owning agent is applied by a fresh, normal run of that agent: normal routing, channel delivery and stamping. Workflow changes, rule moves (sent to /rules) and plugin-agent forks (sent to /agents) stay with the main session.

During the meeting nothing changes: participants still only propose, the write guard still confines them to their own session's meeting directory, and the accepted Bash gap stays (read-only Bash, stated in the meeting notice). Decide how owner runs are dispatched once the meeting has ended (with or without a recorded workflow), and document that decision.

Also give the user two checkpoints during the meeting itself. Today the only point where the skill waits for the user is the final decision sheet.

3. **Agenda confirmation:** before round 1, the moderator shows the participants, a summary of the evidence and the focus areas. The user can add or drop participants, narrow or widen the focus, or cancel the meeting. Cancelling still closes the meeting properly.
4. **Mid-meeting checkpoint:** after round 1, the moderator shows a short summary of each participant's position before finding conflicts and tallying. The user can:
   - continue;
   - redirect a specific participant with extra guidance, which resumes that participant for one more turn under the same meeting rules;
   - stop the meeting. Stopping closes it properly, and nothing is applied.

These checkpoints run in the moderator's own context, so participants stay hub-and-spoke and never talk to the user directly.

## Acceptance criteria

- [ ] apply-placement applies only the auto tier (skill placement, handoff-template edits), reads maestro.json immediately before writing, preserves all other slices, and skips conflicted targets.
- [ ] Owner runs only start after the batch is approved and the meeting has been closed. A guard or test proves an owner run cannot start while the meeting flag is set.
- [ ] All conflicting targets are resolved before any owner run starts.
- [ ] Owner runs behave as normal runs: routing, delivery and stamping as usual, with no meeting notice. How they are dispatched is decided and documented.
- [ ] Workflow changes, rule moves and plugin-agent forks stay with the main session.
- [ ] The write guard and the accepted Bash gap are unchanged during the meeting, and documented.
- [ ] Before round 1, the moderator waits for the user to confirm the agenda (participants, evidence summary, focus areas). The user can edit it or cancel the meeting, and cancelling closes the meeting.
- [ ] After round 1, the moderator shows each participant's position and waits for the user to continue, redirect a participant (one extra turn, still under meeting rules) or stop. Stopping closes the meeting and applies nothing.
- [ ] Tests cover apply-placement (including conflict skipping and preserving the rest of maestro.json) and the owner-run ordering. The existing team-meeting leak suites still pass.
- [ ] The plugin version is bumped (patch), and the maestro-team-meeting SKILL.md and developer concept skills are updated.

## Blocked by

None — can start immediately
