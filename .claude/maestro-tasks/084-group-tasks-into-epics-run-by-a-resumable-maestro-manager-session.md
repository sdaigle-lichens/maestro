# Group tasks into epics run by a resumable maestro-manager session

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Start only after task 083 is done. Both change the orchestrator's Step 4 done step, and 083 adds committing in the worktree there.

Today the user runs several /maestro sessions on related tasks and relays their post-mortems by hand to one coordinating session, which rewires and adds tickets and warns sibling sessions. Make this a first-class feature: epics, plus a maestro-manager skill that coordinates one epic.

This introduces new concepts (epics, a report inbox, a manager role), so run the architecture design pass before implementing. The agreed design is:

- Epic. An epic lives in a directory under the repository-root .claude/ (alongside maestro-tasks). It holds a human-readable file (goal, scope, decisions) and a machine-readable state file (the manager session's name, the worker sessions working on it, and a log of reports and acknowledgements). A task belongs to an epic through an `epic` field on its entry in the task status tracker. The epic does not keep its own list of tasks, so the tracker stays the single source of truth. Ship a small runtime command to create an epic, link or unlink tasks, and show an epic with its tasks' statuses. to-maestro-tasks can link the tasks it writes to an epic.
- Durable reports. When a task that belongs to an epic finishes, the orchestrator's done step writes its report (outcome, findings, post-mortem notes, suggested ticket changes) to the epic's inbox as a file, then sends the manager session a short message pointing to it. A report written while the manager is down is never lost. Cross-session messages have no delivery receipt, so the manager acknowledges each report by replying and recording the acknowledgement in the epic's state. A resumed manager can then list unacknowledged reports.
- Addressing. Session addresses are per process and change when a session restarts. The epic stores session names, and a manager or worker finds the live sessions again by name through the agent listing (ListAgents) on resume.
- Which session runs which task. A task claim today records only the session's internal id, while cross-session messages are addressed by session name, and nothing links the two, so a coordinator can't tell which live session is running a given task. When the orchestrator claims a task, it records its own session name in the claim (a session learns its name from the agent listing; hooks don't have it). This applies to every claim, whether or not the task is in an epic. The manager reads the claims to map each running task to a session name and messages that session directly, instead of broadcasting to every peer.
- maestro-manager skill (new, published). It opens or resumes an epic: it reads the goal, the task statuses and unacknowledged reports, and finds the live sessions. It then loops: acknowledge each incoming report; rewire, re-block or add tickets with to-maestro-tasks; run maestro-post-mortem when a run went badly; suggest a maestro-team-meeting when a finding concerns several agents, or run one on request; and send instructions or warnings to the sibling sessions affected. Before applying team-meeting changes to agents, skills or workflows, it checks that no session in the epic is mid-run, or warns those sessions first. A manager's message to a worker is a teammate's request, never the user's approval: anything that needs approval still prompts the user in that session, and the skill and the orchestrator say so.
- Concurrency. The manager and workers all write to the task tracker and the epic state, so every write reads the file immediately before writing and preserves entries it does not own.

Out of scope: desktop-app views for epics, and communication between managers of different epics (a separate task).

## Acceptance criteria

- [ ] The architecture design pass ran, and its decisions are recorded in the developer concept skills.
- [ ] An epic can be created, tasks linked and unlinked, and an epic shown with its tasks' statuses through a runtime command. Tests spawn the real command against temp projects, including linking a task that does not exist and two writers updating the tracker one after the other without losing entries.
- [ ] to-maestro-tasks can link the tasks it writes to an epic.
- [ ] When a task in an epic finishes, the done step writes a report file to the epic's inbox and notifies the manager by session name. A report written while no manager is running survives and is listed as unacknowledged when a manager resumes.
- [ ] A task claim records the claiming session's name next to its id, and the epic show command, or another command, lists each running task with that session name. The manager uses it to message the session running a given task. A claim made without a name (an older runtime) still works and is shown as unnamed. Tests spawn the real claim command with and without a name.
- [ ] The manager records an acknowledgement for each report it receives, and the epic state shows which reports are unacknowledged. Tests cover writing, acknowledging and listing reports.
- [ ] maestro-manager resumes an epic after both it and the worker sessions restart: it rediscovers sessions by name, not by stored address, and picks up unacknowledged reports.
- [ ] maestro-manager can rewire, re-block and add tickets with to-maestro-tasks, run a post-mortem, suggest or run a team meeting, and message sibling sessions. It does not apply team-meeting changes while a session in the epic is mid-run without warning that session first.
- [ ] The skill and the orchestrator state that a manager's message is never the user's approval.
- [ ] A task that belongs to no epic behaves exactly as today.
- [ ] Generated plugin libs are rebuilt, the .claude/scripts mirrors refreshed and parity passes. The plugin version is bumped (minor, for the new skill), and the maestro-architecture docs are updated.

## Blocked by

- `083-make-the-orchestrator-robust-without-taskcreate-and-enforce-verdict-handoff-agreement.md`
