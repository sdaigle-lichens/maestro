# Maestro overview

Maestro is a desktop app for setting up and running a multi-agent Claude Code workflow inside a
project, without needing a live Claude session for the setup itself.

## What it does

- Opens a project folder and lets you design a **workflow** (which subagents run, in what order,
  and how they hand off to each other) on a visual canvas.
- Lets you assign **rules** (markdown files with directory-scoped instructions) to parts of the
  project.
- Installs a small **runtime** into the project — hook scripts and an orchestrator skill — so that
  a normal terminal Claude Code session in that project can actually run the workflow you designed.
- Live-tails the **session log** the runtime's hooks write while an orchestrator session runs, so
  you can watch what happened after the fact.
- Runs Claude itself for a few well-defined jobs: scaffolding a new skill/subagent/plugin/marketplace,
  and running the task queue written by `/to-maestro-tasks`.
- Offers a right-hand **chat pane** — a real, live Claude Code session you can talk to from inside
  the app, scoped to the open project.

## Opening a project

The app tracks the project you currently have open (**current**) and a short list of projects
you've opened before (**recent**, up to 10). Switching the current project ends any live chat
session and reloads every page's data for the new project. The hamburger menu (top-left) lists
your recent projects and lets you open a different one without leaving whatever page you're on.

## The four files that make a workflow real

Everything Maestro designs for a project lives in `.claude/`:

| File | What it is |
|---|---|
| `maestro.json` | The **source of truth** — your workflow graph, rule assignments, and agent config. Committed to git. Edited by the canvas, the rules view, or by hand. |
| `maestro_session.json` | Which workflow is active in the *current terminal session*. Ephemeral, gitignored, deleted when the session ends. |
| `maestro_session.log.jsonl` | An append-only log of everything that session's hooks observed — tool calls, subagent dispatches, handoffs. This is what `/session-log` reads live. Ephemeral, gitignored. |
| `maestro_session_tasks.json` | Tracks which workflow steps already got a task created for them this session, so the orchestrator doesn't duplicate work. Ephemeral, gitignored. |

Only `maestro.json` survives between sessions. The other three exist only while a terminal
session using the installed runtime is actually running, and are cleaned up automatically when it ends.

## Top-bar layout

- **Hamburger menu** (top-left): the Maestro (runtime) page, the global Docs page you're reading
  now, the Tools dashboard, and your recent-projects list.
- **Direct links**, shown whenever a project is open: Project Docs, Workflows, Rules, Session Log,
  Maestro Tasks — the things you came to *do* in this specific project.
- **Center**: the workflow selector, for projects with more than one configured workflow.
- **Right side**: the chat pane toggle, the current-project button, and the theme toggle.

See `workflows-and-rules.md`, `session-and-log.md`, and `tools-tasks-runtime.md` for the rest.
