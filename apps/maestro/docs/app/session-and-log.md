# The chat pane and the session log

## The chat pane

A real, live, multi-turn Claude Code session in a resizable right-hand pane, one per open project.
It's a genuine conversation — you type, it responds, it can ask permission before taking an action
it isn't already scoped for.

- **What it can read**, at the start, is the open project plus every local plugin marketplace on
  your machine — shown in the pane's read-scope disclosure, each entry tagged with where it came
  from.
- **What it can write** starts empty. It grows only when you complete one of the Create flows and
  choose "Continue in the pane" — that widens the write scope to exactly the directory or file the
  form just created, nothing more. The pane shows this write scope on screen, next to the chat.
- If the model wants to do something outside its current scope, it doesn't get refused outright —
  it asks. You can allow once, deny with a reason, or grant read access to a file/folder for the
  rest of the session (never write access; that only ever comes from a Create handoff).
- Sessions run under a few ceilings — a hard spend cap, a soft "you're running low, wrap up" budget
  the model is told about, and a turn-count brake — all visible in the pane, and you can pick up an
  ended session again with **Continue**.
- Ending the session or switching to a different project closes it and clears its granted access.

The **Docs** page (this one) opens this same pane and loads a help skill into it, so you can ask
questions about Maestro or about the underlying Claude Code concepts (plugins, skills, subagents,
hooks, marketplaces, rules, MCP, memory) right from here.

## The session log (`/session-log`)

Once you've installed the runtime into a project (see `tools-tasks-runtime.md`) and run the
orchestrator in a normal terminal Claude Code session, its hooks append every tool call, subagent
dispatch, and handoff to `maestro_session.log.jsonl`. `/session-log` live-tails that file in three
panes, turning the raw entries into a readable timeline of which agent ran, what it did, and how it
handed off to the next step. This is a different session from the chat pane — it's watching a
terminal session you started separately, not the one you're talking to in the pane.
