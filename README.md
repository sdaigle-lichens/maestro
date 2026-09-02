# Maestro

Maestro turns a project into a multi-agent workflow: an orchestrator skill that classifies each
request, picks a configured workflow, and dispatches subagents whose skills and handoff rules are
injected at runtime from `.claude/maestro.json`.

It has two halves that meet at that file:

- **Authoring** — the Maestro desktop app ([`apps/maestro`](./apps/maestro)), an Electron app for
  building and visualising a project's workflow graph, rules, and agent handoffs.
- **Runtime** — hook scripts and skills in the `maestro` plugin
  ([`plugins/maestro`](./plugins/maestro)) that fire inside a Claude Code session (`SubagentStart`,
  `PreToolUse`, `SubagentStop`, `PostToolUse`, `SessionEnd`). These need a session to run, but not
  the desktop app to be installed.

Without the desktop app you can still set a project up entirely from a session: `/maestro-install`
scaffolds the orchestrator, seeds `maestro.json` and renders the handoff table; `/maestro-update`
refreshes it; `/maestro-uninstall` removes it.

This repository is also a **plugin marketplace** — a catalog of Claude Code plugins, currently just
`maestro` itself, published for anyone to install.

## Concept skills

The plugin also gives the `@scribe` agent a way to build and maintain a project's **concept
skills** — one `.claude/skills/<id>/SKILL.md` per core concept of the project, written for agents
rather than for humans, so a subagent can get oriented in a concept without rediscovering its shape
every session. `/create-concept-skills` builds the list, `/update-concept-skills` reconciles it
against what the code did since, and `/update-single-concept-skill` takes one of them from skeleton
to something worth loading. `/scribe` is the rule for what belongs in a concept skill versus in
`docs/`. See
[`plugins/maestro/skills/create-concept-skills/README.md`](./plugins/maestro/skills/create-concept-skills/README.md).

## Installing the Maestro plugin

```bash
claude plugin marketplace add sdaigle-lichens/maestro
claude plugin install maestro@maestro
```

Then run `/maestro-install` inside the project you want Maestro to orchestrate.

See [`docs/marketplace.md`](./docs/marketplace.md) for updating, removing, installing from a local
checkout, auto-registering the marketplace for a team, and publishing a change to the plugin.

## Running the desktop app

```bash
pnpm install
pnpm --filter maestro build
pnpm --filter maestro start
```

See [`apps/maestro/docs/installation.md`](./apps/maestro/docs/installation.md) and
[`apps/maestro/docs/build-app.md`](./apps/maestro/docs/build-app.md) for details.

## Repository layout

```
maestro/
├── .claude-plugin/
│   └── marketplace.json      # Marketplace manifest (this catalog)
├── apps/
│   └── maestro/               # Electron desktop app
├── docs/                      # Human-facing docs (see also apps/maestro/docs/)
├── packages/
│   ├── ui/                    # Shared React component library
│   ├── styles/                # Shared CSS
│   ├── claude-fs/             # Filesystem abstraction
│   └── typescript-config/     # Shared tsconfig bases
└── plugins/
    └── maestro/                # The maestro Claude Code plugin (skills, agents, hooks)
```
