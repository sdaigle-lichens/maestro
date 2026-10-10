# Stop false runtime-behind warnings and flag a missing handoff payload

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Two runtime findings from the task 083 run.

1. Readiness check reports any version difference as 'behind'. The runtime readiness check (the Step 0 hook's runtime check) compares the project's stamped runtimeVersion against the installed plugin's version with plain inequality, and words every mismatch as 'project runtime X is behind plugin Y'. In this repository the project's runtime is often newer than the installed plugin cache: during task 083 the project was on 0.10.2 and the installed plugin on 0.9.8. Following the advice and running /maestro-update would have copied the older runtime over the newer one. Compare versions semantically:
- the project is older than the installed plugin: as today, suggest /maestro-update;
- the project is newer: don't suggest /maestro-update. Say the installed plugin is older than this project's runtime and should be updated, and let the session continue;
- an unstamped or unparseable version: keep today's behaviour.

The desktop app's equivalent check, which shares the same question, must reach the same verdict. /maestro-update itself refuses to downgrade a project's runtime unless the user explicitly asks for it.

2. No check that a handoff wrote its payload. In task 083, @reviewer reported a clean pass and ended 'HANDOFF: success', but wrote no payload to the scribe channel, so the next step started without one. The stop hook's handoff check (added in 083) catches a missing HANDOFF line and a FAIL verdict paired with HANDOFF: success, but not a missing payload. Add a third issue type: the HANDOFF line names a route whose receiver expects a payload (per the route's handoff protocol), and the sender wrote no channel file for that receiver during this run. Log it and surface it to the orchestrator the same way as the other two, with the instruction to resume the sender and ask it to write the payload rather than dispatching the receiver without one. Meeting-mode turns and runs whose route needs no payload are never flagged.

## Acceptance criteria

- [ ] The readiness check distinguishes project-older from project-newer. Only project-older suggests /maestro-update; project-newer tells the user to update the plugin and lets the session continue. The app's equivalent check agrees. Tests spawn the real check against a temp project and a temp HOME with an installed plugin older, equal and newer than the stamped runtime.
- [ ] /maestro-update refuses to downgrade a project's runtime unless the user explicitly asks, and says why.
- [ ] The stop hook flags a run that ended with a HANDOFF route expecting a payload but wrote no channel file for that receiver during the run. It is logged and shown to the orchestrator with the resume-and-write instruction. Tests spawn the real hooks for a payload written, a payload missing, a route needing no payload, and a meeting-mode turn.
- [ ] The orchestrator template and the injected handoff instructions say that a missing payload is resumed, not skipped.
- [ ] Generated plugin libs are rebuilt, the .claude/scripts mirrors refreshed and parity passes. The plugin version is bumped (patch), and the maestro-architecture docs are updated.

## Blocked by

None — can start immediately
