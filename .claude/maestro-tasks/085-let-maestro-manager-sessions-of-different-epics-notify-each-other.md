# Let maestro-manager sessions of different epics notify each other

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Once epics and maestro-manager are in use, more than one manager can run on the same project at a time, each coordinating its own epic. When one manager finds or does something that affects another epic (a shared file, a changed agent, skill or workflow, a rule move, a re-blocked task), the other epic's manager should hear about it.

Build on the epic state and report inbox from the epics task: a manager can discover the other epics in the project and their manager session names, write a cross-epic note to the other epic's inbox, and notify that manager by session name. The receiver acknowledges the note the same way it acknowledges worker reports, and decides whether its own tickets or sessions need changing. Decide, from how managers are actually used, what counts as affecting another epic and whether the manager detects it or only acts when the user flags it. Document that decision. A note from another manager is a teammate's request, never the user's approval.

## Acceptance criteria

- [ ] A manager can list the other epics in the project with their manager session names, and send a cross-epic note that is written to the other epic's inbox before any message is sent.
- [ ] The receiving manager acknowledges cross-epic notes like worker reports, and a note sent while that manager is down is picked up when it resumes. Tests cover sending, acknowledging and resuming.
- [ ] What counts as affecting another epic, and whether it is detected or user-flagged, is decided and documented.
- [ ] The plugin version is bumped, and the maestro-manager skill and developer concept skills are updated.

## Blocked by

- `084-group-tasks-into-epics-run-by-a-resumable-maestro-manager-session.md`
