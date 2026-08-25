# Maestro (desktop)

Maestro is the authoring half of this repo's multi-agent workflow system: an Electron app that
opens a project folder, edits its `.claude/maestro.json` workflow graph and rule assignments, lives-
tails the session log the Claude Code hooks write, and can run Claude itself — either as a
confirmed one-shot run or as a live session in a right-hand pane.

- **What it is and how it's built** — [`CLAUDE.md`](./CLAUDE.md) is the short reference; the
  long-form architecture docs live under [`.claude/skills/`](./.claude/skills/).
- **Set up a dev environment** — [`docs/installation.md`](./docs/installation.md).
- **Build the app / install the repo's marketplace** — [`docs/build-app.md`](./docs/build-app.md).
- **Common commands** — a [`justfile`](./justfile) covers `dev`, `build`, `test`, `typecheck`,
  `format`, and more. Run `just` from this directory to list them.

Maestro's own runtime — the hooks that fire inside a Claude session — lives in the
`maestro` plugin at [`../../plugins/maestro`](../../plugins/maestro).
The desktop app and the plugin meet at one file: `<project>/.claude/maestro.json`.
