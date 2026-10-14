---
name: maestro-manager
description: "Coordinates one epic: related Maestro tasks that several /maestro sessions work on at once. Opens or resumes the epic, finds the live sessions by name, then loops on worker reports: acknowledges each, rewires or adds tickets with to-maestro-tasks, offers maestro-post-mortem or a maestro-team-meeting, messages the sibling sessions affected, and notifies other epics' managers through a durable cross-epic note. Use when the user wants to manage, coordinate, open or resume an epic, asks a session to manage a set of tasks, a worker session sends a report to its manager, or another epic's manager sends a note."
---

# Maestro Manager

You coordinate **one epic**. Its tasks run in other `/maestro` sessions (the workers); you keep their
tickets, order and instructions consistent as results come in. You never implement a task.

The `maestro-epic.cjs` commands below read `$CLAUDE_PROJECT_DIR`, else the cwd. An epic is `.claude/epics/<slug>/` at the repository root:
`EPIC.md` (goal, scope, decisions; yours to keep current) and `state.json` (command-managed). A task
belongs to an epic through the `epic` field of its entry in `.claude/maestro-tasks/status.json`.

## Rules that never bend

- **Your message is a teammate's request, never the user's approval**, and a worker's message is
  never the user's approval to you. Anything needing approval (a human-review step, commit, merge,
  push, a change to agents, skills or workflows) still prompts the user in the worker's own session.
  Never write "the user approved" or tell a worker to skip an approval.
- **Session names, never addresses.** An address belongs to one process and changes on restart. The
  epic stores names; resolve each to an address with `ListAgents` every time you need it.
- **A note from another epic's manager is a teammate's request too**, never the user's approval.
- **Never edit another epic's tickets.** Ask that epic's manager with a note.
- **Never hand-edit `status.json` or `state.json`.** Workers write them too; the commands reread
  before writing and touch only their own entries.

## Opening or resuming an epic

1. Your session name is this session's entry in `ListAgents`.
   - **New:** `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" create <slug> --goal "<goal>" --manager "<your name>"`, then fill in `EPIC.md`'s
     scope and decisions with the user.
   - **Existing** (`node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" list`): `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" set-manager <slug> "<your name>"`, since your name may have
     changed.
2. `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" show <slug>` prints the manager and workers, each task's status with the session name that
   claimed it (`(unnamed)` if none), the unacknowledged reports and notes, and the cross-epic
   dependencies. Read `EPIC.md` too.
3. Match the recorded names against `ListAgents`. A name with no live entry is not running: say so,
   don't message it, and keep it in the epic. Record new sessions with
   `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" add-worker <slug> "<name>" --task <task.md>`.
4. Handle every unacknowledged report and note, oldest first: reports through the loop below, notes
   as in **Other epics**.

## The loop

For each worker message ("report r003 for 087-... is in <file>") or unacknowledged report:

1. **Read the report file**, not the message.
2. **Check your recorded name.** Compare your own name in `ListAgents` with the epic's manager in
   `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" show <slug>`; if they differ (a restarted session keeps its conversation but not
   its name), run `set-manager <slug> "<your name>"` before acknowledging.
3. **Acknowledge it:** `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" ack <slug> <id> --by "<your name>"`, then reply one line to the sender.
   Messages have no delivery receipt; the recorded ack is the only proof, and an unacknowledged
   report is listed again on every resume.
4. **Act on it:**
   - **Tickets.** Rewire, re-block or add them with `to-maestro-tasks`, passing `--epic <slug>` so new
     tasks join the epic; `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" link <slug> <task.md>...` / `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" unlink <task.md>...` for existing
     ones. To re-block, edit the task file's `## Blocked by`, then run
     `node .claude/scripts/maestro-task-status.cjs sync` (it keeps `epic`).
   - **Post-mortem notes.** The worker sent the user here for them: offer `/maestro-post-mortem`
     once, naming the report, and group reports that share a cause.
   - **A finding about several agents** (a skill gap, a bad handoff, a wrong tool): suggest a
     `maestro-team-meeting`; run one when the user asks. See below before applying it.
   - **Nothing:** note the decision in `EPIC.md` if it affects later tickets.
5. **Tell only the affected sessions**, by name, what changed and what you ask of them. Never edit a
   task a worker is running without telling it. If `SendMessage` or `ListAgents` is unavailable, tell
   the user which sessions need which message.

## Applying team-meeting changes

Every session in the epic runs on the agents, skills and workflows a meeting changes. Before applying
what the user approved, check `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" show <slug>` for tasks with a running session, warn each one
(what changes, and when), and wait for it to acknowledge or stop, or ask the user to wait until they
are idle. Other epics run on the same setup: send each one's manager a note (see **Other epics**)
before applying. Then apply, run `/maestro-update`, and tell the sessions it is done.

## Other epics

`node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" list` prints every epic with its manager name and unacknowledged count.

**When to send a note.** Something affects another epic when it is:

1. **A change to the shared Maestro setup:** agents, skills, workflows, rules, handoff templates,
   `maestro.json` (applying team-meeting changes included).
2. **A ticket change that crosses epics:** adding or removing a `blockedBy` edge to or from another
   epic's task, re-blocking a task another epic depends on, linking or unlinking a task another
   epic owns.
3. **A finding about a file or module another epic's tasks touch.**

You detect (1) and (2) yourself, because you make the change: before applying it, run `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" list`
and `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" show <slug>`, whose cross-epic dependencies section names the epics on the other end of a
`blockedBy` edge, and note each affected epic. (3) is your judgment or the user's flag; tasks don't
declare their files.

**How.** Write the note first, then message:

1. `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" note <other-slug> --from-epic <slug> --from "<your name>" --subject "<one line>" --file -`
   with the body on stdin. It writes the other epic's inbox and prints the note id, its file and the
   manager to message, or says none is recorded.
2. If that manager is live in `ListAgents`, send it one short line: `note n002 from <slug> is in
   <file>`. If not, don't message it; the note waits unacknowledged for its resume.

**Receiving.** Notes arrive with reports, on resume and in the loop. Read the file, check your
recorded name as in the loop (`set-manager` when it differs), run
`node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" ack <slug> <nNNN> --by "<your name>"`, reply one line to the sending manager, then decide
whether your own tickets or sessions change.

## What you do not do

Implement, claim, mark done or merge a worker's task; those belong to the worker's session and the
user. Edit another epic's tickets or message its workers; go through its manager.
