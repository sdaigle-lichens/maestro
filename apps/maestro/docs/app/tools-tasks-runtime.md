# Tools, tasks, and the runtime

## The Tools dashboard (`/tools`)

A tabbed dashboard, most of it one read-only round trip, plus a project selector so you can browse
another project's data without switching the app's current project (and without ending your live
chat session in the current one):

- **Plugins** — every Claude Code plugin installed on this machine, and the CLI command reference.
- **Marketplace** — the plugin marketplaces you've actually registered with Claude Code globally
  (`~/.claude`), plus, as a secondary section, the selected project's own marketplace if it
  publishes one.
- **Usage Stats** — token/cost usage via `ccusage`, previewed before it's run.
- **Curated Tools** — a curated set of plugins from well-known marketplaces, with one-click install.
- **Rules / Skills / Agents** — what's available to the selected project: local (project-only),
  global (installed on this machine for every project), and anything contributed by an installed
  plugin. Rules have no global tier yet, so that tab is local-only.

Each of the Marketplace/Plugins/Agents/Skills tabs has a **Create** button at the bottom that opens
the matching creation form.

## The four Create flows

Reached from the bottom of the matching Tools tab: create a skill, subagent, plugin, or
marketplace. Each submit is two steps — first everything deterministic gets written to disk
(directories, frontmatter, manifests, and for a new marketplace, a git repo and first commit), then
whatever's left (the actual prose of a `SKILL.md` or a subagent's system prompt) is handed to
Claude, shown to you as a full preview before anything runs. Declining the Claude step still leaves
you with a complete, usable skeleton.

## Maestro Tasks (`/maestro-tasks`)

The task queue written by the `/to-maestro-tasks` skill from a terminal session — a list of
`NNN-*.md` prompt files plus a status tracker. **Run with Claude** previews exactly what will be
sent, lets you confirm, then streams the run.

## The Maestro page (runtime)

Install, update, or remove the project's Maestro runtime (the hook scripts and orchestrator skill
that make the workflow you designed in `/workflows` actually runnable from a terminal session), and
see whether it's up to date. Like the Tools dashboard, it has a project selector so you can check
another project's runtime status without switching away from the one you're currently working in.
