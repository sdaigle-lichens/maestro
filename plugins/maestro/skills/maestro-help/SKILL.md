---
name: maestro-help
description: "Answer questions about the Maestro desktop app itself (opening a project, the workflows canvas, rules, the session pane and log, the tools dashboard, the Create flows, runtime install). For general Claude Code questions (plugins, skills, subagents, hooks, marketplaces, rules, MCP, memory, CLI commands) fetch the official Anthropic docs instead of reading a local folder — this repo doesn't ship its own copy. Use when the user asks how something works, wants to understand a concept, or needs guidance on any Maestro or Claude Code tooling topic."
---

# Maestro Help

Answer from what you actually read or fetched, never from memory. A question spanning both
halves ("how does Maestro decide which skills a subagent gets") gets both sources and one answer
connecting them.

## Maestro, the app

Read only the doc(s) the question needs:

| Topic | Doc |
|---|---|
| What Maestro is, opening a project, the config/state files, top-bar layout | `${CLAUDE_SKILL_DIR}/../../docs/app/overview.md` |
| Workflows canvas, the rules view | `${CLAUDE_SKILL_DIR}/../../docs/app/workflows-and-rules.md` |
| Chat/session pane, the session log | `${CLAUDE_SKILL_DIR}/../../docs/app/session-and-log.md` |
| Tools dashboard, Maestro Tasks, install/runtime, the Create flows | `${CLAUDE_SKILL_DIR}/../../docs/app/tools-tasks-runtime.md` |

**Concept skills** ("how do I document this project for my agents?") are answered by
`${CLAUDE_SKILL_DIR}/../create-concept-skills/README.md` — the marker, the version arithmetic, the
script, and the `/create-concept-skills`, `/update-concept-skills`, `/update-single-concept-skill`
and `/scribe` flows.

## Claude Code concepts

`WebFetch` the official docs — there is no local copy:

| Topic | Fetch |
|---|---|
| Plugins (structure, manifest, enabling, updating) | `https://code.claude.com/docs/en/plugins` |
| Skills (format, creating, installing) | `https://code.claude.com/docs/en/skills` |
| Subagents (AGENTS.md, coordination, delegation) | `https://code.claude.com/docs/en/sub-agents` |
| Hooks (PreToolUse, PostToolUse, lifecycle, scripts) | `https://code.claude.com/docs/en/hooks` |
| Plugin marketplaces (registering, publishing, versioning, auto-updates) | `https://code.claude.com/docs/en/plugin-marketplaces` |
| MCP servers (configuration, tools) | `https://code.claude.com/docs/en/mcp` |
| Memory | `https://code.claude.com/docs/en/memory` |
| Settings, slash commands, IDE integrations | `https://code.claude.com/docs/en/settings` |

If a page 404s, search `code.claude.com`; if you still can't reach it, say so rather than guess.

## Answer style

Lead with the direct answer; add a concrete example (snippet, command, what a route shows) when it
helps. If the user wants to *do* something, point to the matching place: the app's `/maestro` page
(runtime), `/tools` dashboard or Create route, or `/create-skill`, `/create-plugin`,
`/create-subagent`, `/manage-marketplace`.
