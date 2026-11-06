# Warn when a resumed agent edits files and skips its required payload

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Task 155's live check found a silent miss. A resumed agent on a route that requires a payload edited a file, wrote no payload and handed back success, and `handoff-issues` printed "no problems recorded". Task 153's acceptance criteria say this run must be warned, and its fixture tests pass, so the live behaviour and the tests disagree. The evidence is in reports r020 and r021 and in the Task 155 run part of the maestro-architecture skill's Live check section. This is a code change with tests, plus a rebuild of the generated plugin libs, a patch plugin version bump, the repo's runtime refresh and an update to the developer docs.

The cause is not proven. First run the live case again with enough recorded to tell where the warning is lost: never raised by the stop hook, or raised and then dropped. Two suspects to separate: the recorded warning is dropped because an earlier-numbered payload from the same session makes the missing file look present, or a misread run boundary resets what the run wrote so it counts as re-verify-only. Any debug output is temporary and must not stay in the commit.

Then fix the cause that was found. Desired behaviour: a resumed run that edits files and skips its required payload raises a missing-payload warning that `handoff-issues` shows. A resumed run that writes its next-numbered payload and a resumed re-verify-only run still raise none. First-run behaviour does not change.

Add a regression test built from the real failing shape: an earlier-numbered payload from the same session already in the lane, and a resumed run that edits a file and writes no payload. Then repeat the live case and record the result. If the live case still fails, or the cause means the fix would change a decision from tasks 151 or 153, report that to the user rather than choosing on your own.

## Acceptance criteria

- [ ] The report names the confirmed cause and the evidence for it, not a hypothesis
- [ ] A regression test covers a resumed run that edits a file and skips its payload with an earlier-numbered payload already in the lane, and it fails without the fix
- [ ] Repeated live, a resumed run that edits a file and skips its payload is warned, and `handoff-issues` shows it; the report quotes the log lines
- [ ] A resumed agent that writes a next-numbered payload still raises no missing-payload warning
- [ ] A resumed run that only re-verifies still raises no missing-payload warning
- [ ] First-run hand-back and payload checks behave as before
- [ ] No debug output or throwaway edit remains in the commit
- [ ] The Live check section of the maestro-architecture developer skill and the handoff docs match the new behaviour
- [ ] The plugin version is bumped and the parity test passes after the runtime refresh

## Touched surfaces

- apps/maestro/src/core/handoff-label.ts, handoff-payload.ts and resume-delivery.ts, as the cause requires
- plugins/maestro/scripts/maestro-subagent-log.js and its .claude/scripts mirror, if the cause is there
- plugins/maestro/scripts/lib/*.cjs (generated: rebuild, never hand-edit) and .claude/scripts/lib mirrors
- plugins/maestro/.claude-plugin/plugin.json (version)
- apps/maestro/test/core/handoff-run-boundary-151.test.ts and runtime-version-and-payload.test.ts
- .claude/skills/maestro-architecture/SKILL.md (Live check section) and sub-concepts/handoff-contract.md
- Overlaps standalone task 152 in maestro-subagent-log.js, the generated libs and the version file: 152 starts after this epic's PR merges, then rebases and runs the runtime refresh

## Blocked by

None — can start immediately
