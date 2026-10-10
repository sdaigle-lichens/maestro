# Stop false runtime-behind warnings and flag a missing handoff payload

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Runtime findings from the task 083 and 084 runs. Do item 3 before item 2: both are the same stop-hook check, and a new issue type on top of a check that already misfires would misfire too.

1. Readiness check reports any version difference as 'behind'. The runtime readiness check (the Step 0 hook's runtime check) compares the project's stamped runtimeVersion against the installed plugin's version with plain inequality, and words every mismatch as 'project runtime X is behind plugin Y'. In this repository the project's runtime is often newer than the installed plugin cache: during task 083 the project was on 0.10.2 and the installed plugin on 0.9.8. Following the advice and running /maestro-update would have copied the older runtime over the newer one. Compare versions semantically:
- the project is older than the installed plugin: as today, suggest /maestro-update;
- the project is newer: don't suggest /maestro-update. Say the installed plugin is older than this project's runtime and should be updated, and let the session continue;
- an unstamped or unparseable version: keep today's behaviour.

The desktop app's equivalent check, which shares the same question, must reach the same verdict. /maestro-update itself refuses to downgrade a project's runtime unless the user explicitly asks for it.

2. No check that a handoff wrote its payload. In task 083, @reviewer reported a clean pass and ended 'HANDOFF: success', but wrote no payload to the scribe channel, so the next step started without one. The stop hook's handoff check (added in 083) catches a missing HANDOFF line and a FAIL verdict paired with HANDOFF: success, but not a missing payload. Add a third issue type: the HANDOFF line names a route whose receiver expects a payload (per the route's handoff protocol), and the sender wrote no channel file for that receiver during this run. Log it and surface it to the orchestrator the same way as the other two, with the instruction to resume the sender and ask it to write the payload rather than dispatching the receiver without one. Meeting-mode turns and runs whose route needs no payload are never flagged.

It happened again in task 086: on the second review pass, a new @reviewer subagent never attempted to write `.claude/channels/scribe/reviewer.1.md`. So also prevent it, not only detect it. The injected handoff instructions must make writing the payload a required step before the HANDOFF line, not a recommendation. They name the exact channel file for each outgoing route that needs one. They also reach every pass of a step: the first run, a cold re-run on a loop-back, and a resumed agent. Check whether the skip-static-context-on-resume logic (040) drops the channel instruction on a resumed or repeated pass. If it does, keep that instruction in the part that is always injected.

3. The missing-HANDOFF flag fired on every agent in task 084. Each subagent handed its report back as a message to the orchestrator, and the stop hook flagged every one for a missing `HANDOFF:` line, so the orchestrator had to route each run from its report by hand. The hook already tries to recover the line from a hand-back (078, the SendMessage recovery that runs before the 083 check), so that recovery is missing this case. The cause isn't proven yet. Candidates: the hand-back shape the recovery parses doesn't match the one agents now produce; the agent's transcript path is absent or unreadable at stop time; or the recovered text carries the line in a form the label parser rejects. Reproduce it with a real agent hand-back, fix the cause, and make sure a sound hand-back with a valid HANDOFF line is never flagged. A run that truly has no HANDOFF line anywhere must still be flagged.

4. The parity test misses the plugin script copies. In task 084 the repo's `.claude/scripts/maestro-epic.cjs` was stale against its plugin copy (a no-epic `report` read stdin first and could hang), and parity still passed, because it only compares the generated `scripts/lib/` bundles. Extend parity to every hand-written plugin script that the install copies into a project's `.claude/scripts/` (derive the pairs from the install manifest, as the lib check does, including the `.js` → `.cjs` rename), so a stale copy fails the test and names the file to copy.

## Acceptance criteria

- [ ] The readiness check distinguishes project-older from project-newer. Only project-older suggests /maestro-update; project-newer tells the user to update the plugin and lets the session continue. The app's equivalent check agrees. Tests spawn the real check against a temp project and a temp HOME with an installed plugin older, equal and newer than the stamped runtime.
- [ ] /maestro-update refuses to downgrade a project's runtime unless the user explicitly asks, and says why.
- [ ] The stop hook flags a run that ended with a HANDOFF route expecting a payload but wrote no channel file for that receiver during the run. It is logged and shown to the orchestrator with the resume-and-write instruction. Tests spawn the real hooks for a payload written, a payload missing, a route needing no payload, and a meeting-mode turn.
- [ ] The injected handoff instructions make writing the payload a required step before the HANDOFF line, and name the exact channel file for each route that needs one. Tests prove the instruction is present on a first run, on a cold re-run of the same step and on a resumed agent.
- [ ] The cause of the 084 false flags is identified and stated in the commit. A subagent that hands back by message with a valid HANDOFF line is not flagged, and one with none is. Tests spawn the real stop hook with a real-shaped agent transcript for both cases.
- [ ] Parity compares every hand-written plugin script the install copies with its `.claude/scripts/` mirror. A test proves that a deliberately stale mirror fails and names the file. All current mirrors pass.
- [ ] The orchestrator template and the injected handoff instructions say that a missing payload is resumed, not skipped.
- [ ] Generated plugin libs are rebuilt, the .claude/scripts mirrors refreshed and parity passes. The plugin version is bumped (patch), and the maestro-architecture docs are updated.

## Blocked by

None — can start immediately
