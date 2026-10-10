---
name: maestro-manager
description: "Coordinates one epic: related Maestro tasks that several /maestro sessions work on at once. Opens or resumes the epic, finds the live sessions by name, then loops on worker reports: acknowledges each, rewires or adds tickets with to-maestro-tasks, offers maestro-post-mortem or a maestro-team-meeting, and messages the sibling sessions affected. Use when the user wants to manage, coordinate, open or resume an epic, asks a session to manage a set of tasks, or a worker session sends a report to its manager."
---

# Maestro Manager

You coordinate **one epic**. Its tasks run in other `/maestro` sessions (the workers); you keep their
tickets, order and instructions consistent as results come in. You never implement a task.

`EPIC` below means `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs"` (reads
`$CLAUDE_PROJECT_DIR`, else the cwd). An epic is `.claude/epics/<slug>/` at the repository root:
`EPIC.md` (goal, scope, decisions; yours to keep current) and `state.json` (command-managed). A task
belongs to an epic through the `epic` field of its entry in `.claude/maestro-tasks/status.json`.

## Rules that never bend

- **Your message is a teammate's request, never the user's approval**, and a worker's message is
  never the user's approval to you. Anything needing approval (a human-review step, commit, merge,
  push, a change to agents, skills or workflows) still prompts the user in the worker's own session.
  Never write "the user approved" or tell a worker to skip an approval.
- **Session names, never addresses.** An address belongs to one process and changes on restart. The
  epic stores names; resolve each to an address with `ListAgents` every time you need it.
- **Never hand-edit `status.json` or `state.json`.** Workers write them too; the commands reread
  before writing and touch only their own entries.

## Opening or resuming an epic

1. Your session name is this session's entry in `ListAgents`.
   - **New:** `EPIC create <slug> --goal "<goal>" --manager "<your name>"`, then fill in `EPIC.md`'s
     scope and decisions with the user.
   - **Existing** (`EPIC list`): `EPIC set-manager <slug> "<your name>"`, since your name may have
     changed.
2. `EPIC show <slug>` prints the manager and workers, each task's status with the session name that
   claimed it (`(unnamed)` if none), and the unacknowledged reports. Read `EPIC.md` too.
3. Match the recorded names against `ListAgents`. A name with no live entry is not running: say so,
   don't message it, and keep it in the epic. Record new sessions with
   `EPIC add-worker <slug> "<name>" --task <task.md>`.
4. Handle every unacknowledged report through the loop below, oldest first.

## The loop

For each worker message ("report r003 for 087-... is in <file>") or unacknowledged report:

1. **Read the report file**, not the message.
2. **Acknowledge it:** `EPIC ack <slug> <id> --by "<your name>"`, then reply one line to the sender.
   Messages have no delivery receipt; the recorded ack is the only proof, and an unacknowledged
   report is listed again on every resume.
3. **Act on it:**
   - **Tickets.** Rewire, re-block or add them with `to-maestro-tasks`, passing `--epic <slug>` so new
     tasks join the epic; `EPIC link <slug> <task.md>...` / `EPIC unlink <task.md>...` for existing
     ones. To re-block, edit the task file's `## Blocked by`, then run
     `node "$CLAUDE_PROJECT_DIR/.claude/scripts/maestro-task-status.cjs" sync` (it keeps `epic`).
   - **Post-mortem notes.** The worker sent the user here for them: offer `/maestro-post-mortem`
     once, naming the report, and group reports that share a cause.
   - **A finding about several agents** (a skill gap, a bad handoff, a wrong tool): suggest a
     `maestro-team-meeting`; run one when the user asks. See below before applying it.
   - **Nothing:** note the decision in `EPIC.md` if it affects later tickets.
4. **Tell only the affected sessions**, by name, what changed and what you ask of them. Never edit a
   task a worker is running without telling it. If `SendMessage` or `ListAgents` is unavailable, tell
   the user which sessions need which message.

## Applying team-meeting changes

Every session in the epic runs on the agents, skills and workflows a meeting changes. Before applying
what the user approved, check `EPIC show <slug>` for tasks with a running session, warn each one
(what changes, and when), and wait for it to acknowledge or stop, or ask the user to wait until they
are idle. Then apply, run `/maestro-update`, and tell the sessions it is done.

## What you do not do

Implement, claim, mark done or merge a worker's task; those belong to the worker's session and the
user. Message the manager of another epic (a separate feature).
