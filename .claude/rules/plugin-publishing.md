---
name: plugin-publishing
description: Invariants for everything under plugins/<name>/ — it ships to that plugin's end users, not to developers of this repo.
---

# Publishing invariants

- Everything under `plugins/<name>/` ships to that plugin's **end users**. Never add a `.claude/`
  directory, a developer-facing skill, or architecture notes here — that belongs in this repo's own
  `.claude/skills/`.
- **Every change under `plugins/<name>/` bumps that plugin's `.claude-plugin/plugin.json`
  `version`.** No exceptions, including a change to a single script's behaviour.
- `plugins/maestro/scripts/lib/*.cjs` (except `maestro-tasks.cjs`) are **generated** from
  `apps/maestro/src/core/plugin-entries/*.ts`. Never hand-edit them — edit the TypeScript source and
  run `pnpm --filter maestro build:plugin-libs`.
- A hook script committed as `.js` under `plugins/maestro/scripts/` is copied into a project as
  `.cjs`. Never write `require()` in one assuming it keeps its `.js` extension at runtime.
