# Close the remaining resumed-run gaps in the handoff checks

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Task 151 made the SubagentStop hook read only a hand-back from a resumed agent's current run. It treats the last user entry that is not purely `tool_result` blocks as the run boundary. That left two kinds of gap, both reported by task 151's worker and the post-mortem of task 150. This is a code change with tests, plus a rebuild of the generated plugin libs, a patch plugin version bump and the repo's runtime refresh.

Gap 1, a wrong result can still be recorded:
- If the resume prompt has not reached the transcript when the hook reads it, the hook can still return the earlier run's hand-back. This is the same bug as task 151, just rarer.
- A user entry with text after the hand-back makes the hook discard that hand-back.
- The resume-prompt transcript shape was assumed in task 151, never checked against a real log. Check it against a real resumed agent's transcript first and adjust if it differs. Task 151's user chose the transcript boundary over a baseline taken at SubagentStart; if the transcript alone cannot close the race, report that and bring the choice back to the user rather than switching on your own.

Gap 2, false missing-payload warnings on a resumed run:
- A resumed agent that writes its next-numbered payload (`test.2.md`) is warned about `test.1.md`.
- A resumed run that only re-verifies a commit has no payload to write, yet is warned on its `success` route (seen at line 260 of task 150's session log). Decide from the run itself whether a payload was expected, so a real missing payload is still caught.

Desired behaviour: on a resumed run the hook records that run's own result or none, never an older one, and warns about a missing payload only when one really is missing. First-run behaviour does not change.

## Acceptance criteria

- [ ] The transcript shape of a resumed agent is checked against a real log, and the result is recorded in the task's report
- [ ] When the resume prompt has not reached the transcript yet, no earlier run's hand-back is used, or the task reports to the user why the transcript alone cannot guarantee that
- [ ] A user entry with text after a hand-back no longer discards that hand-back
- [ ] A resumed agent that writes a next-numbered payload raises no missing-payload warning
- [ ] A resumed run that only re-verifies raises no missing-payload warning, and a resumed run that really skips a required payload still does
- [ ] First-run hand-back and payload checks behave as before
- [ ] The plugin version is bumped and the parity test passes after the runtime refresh

## Touched surfaces

- apps/maestro/src/core/handoff-label.ts
- apps/maestro/src/core/handoff-payload.ts and resume-delivery.ts
- plugins/maestro/scripts/maestro-subagent-log.js and its .claude/scripts mirror
- plugins/maestro/scripts/lib/*.cjs (generated: rebuild, never hand-edit) and .claude/scripts/lib mirrors
- plugins/maestro/.claude-plugin/plugin.json (version)
- apps/maestro/test/core/handoff-run-boundary-151.test.ts and runtime-version-and-payload.test.ts
- .claude/skills/maestro-architecture/sub-concepts/handoff-contract.md and hooks.md
- Overlaps task 152 in maestro-subagent-log.js, the generated libs and the version file: run them one at a time, and whichever merges second rebases and runs the runtime refresh

## Blocked by

None — can start immediately

## Post-Mortem

- **Problem:** The @backend worker could not read `~/.claude/projects`, so it could not check a real resumed transcript. It reported Gap 1 as undecided, and the user had to be asked and steered to a way to produce one. The orchestrator then resumed the finished worker as a dummy and read its own `agent-*.jsonl` with the Read tool.
  **Fix:** none
- **Problem:** The first @backend pass let an earlier run's file writes count toward `wroteFiles` when the resume prompt had not flushed. @test caught it and the work looped back to @backend.
  **Fix:** none
- **Problem:** @backend and @test each left a runtime mirror stale or a test file unformatted (prettier), so `pnpm refresh:runtime` had to be run twice by the user.
  **Fix:** none
