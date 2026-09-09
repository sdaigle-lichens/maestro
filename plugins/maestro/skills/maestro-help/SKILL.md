---
name: maestro-help
description: "Answer questions about the Maestro desktop app itself (opening a project, the workflows canvas, rules, the session pane and log, the tools dashboard, the Create flows, runtime install). For general Claude Code questions (plugins, skills, subagents, hooks, marketplaces, rules, MCP, memory, CLI commands) fetch the official Anthropic docs instead of reading a local folder — this repo doesn't ship its own copy. Use when the user asks how something works, wants to understand a concept, or needs guidance on any Maestro or Claude Code tooling topic."
---

# Maestro Help

Answer any question about the Maestro desktop app by consulting its reference docs. For anything
about Claude Code itself, fetch the official documentation instead — this repo has no local copy
to fall back to.

## Maestro, the app

Pick only the doc(s) relevant to the user's question — do not read all of them.

| Topic | Doc |
|---|---|
| What Maestro is, opening a project, the config/state files, top-bar layout | `${CLAUDE_SKILL_DIR}/../../../../apps/maestro/docs/app/overview.md` |
| Workflows canvas, the rules view | `${CLAUDE_SKILL_DIR}/../../../../apps/maestro/docs/app/workflows-and-rules.md` |
| Chat/session pane, the session log | `${CLAUDE_SKILL_DIR}/../../../../apps/maestro/docs/app/session-and-log.md` |
| Tools dashboard, Maestro Tasks, install/runtime, the Create flows | `${CLAUDE_SKILL_DIR}/../../../../apps/maestro/docs/app/tools-tasks-runtime.md` |

## Concept skills

"How do I document this project for my agents?" is answered by the plugin's three concept-skill
flows rather than by a doc. A **concept skill** is a `.claude/skills/<id>/SKILL.md` explaining one
core concept of the project, marked in its frontmatter `metadata:` map and written for Claude and its
subagents rather than for humans. `/create-concept-skills` builds the list, `/update-concept-skills`
reconciles it after the code moves, `/update-single-concept-skill` takes one from skeleton to
useful, and `/scribe` is the rule for what belongs in a concept skill versus in `docs/`. The whole
scheme — the marker, the version arithmetic, the script — is documented in
`${CLAUDE_SKILL_DIR}/../create-concept-skills/README.md`; read that before answering from memory.

## Claude Code concepts

There is no local `docs/` folder for these in this repo — **`WebFetch`** the official docs instead
of guessing from memory or training data, which goes stale. Start from
`https://code.claude.com/docs/en/` and its plugin-marketplace pages, e.g.:

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

If a fetch 404s or the docs have moved, search `code.claude.com` rather than answering from
memory — say so if you can't reach it, instead of guessing.

## Workflow

1. **Identify the topic** — is it about the Maestro app itself, a Claude Code concept, or both?
2. **Maestro-app questions**: read the relevant doc(s) from the table above — only the sections
   needed.
3. **Claude Code questions**: `WebFetch` the relevant official doc page(s) above, then answer from
   what was actually fetched.
4. **Questions spanning both** — e.g. "how does Maestro decide which skills a subagent gets" —
   read the Maestro-app doc AND fetch the relevant Claude Code doc, then synthesize a single
   answer that connects them, rather than answering only one half.

## Answer Style

- Lead with the direct answer, then add supporting context.
- Include concrete examples (file snippets, CLI commands, or what a Maestro route/tab shows) when
  they help.
- If the user's question implies they want to *do* something (not just understand it), suggest
  the matching route or skill: for the app, the `/maestro` page (runtime), the `/tools` dashboard,
  or the relevant Create route; for scaffolding, `/create-skill`, `/create-plugin`,
  `/create-subagent`, `/manage-marketplace`.
