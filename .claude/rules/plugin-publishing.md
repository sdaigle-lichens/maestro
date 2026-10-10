---
name: plugin-publishing
description: Invariants for everything under plugins/<name>/ — it ships to that plugin's end users, not to developers of this repo.
---

# Publishing invariants

- Everything under `plugins/<name>/` ships to that plugin's **end users**. Never add a `.claude/`
  directory, a developer-facing skill, or architecture notes here — that belongs in this repo's own
  `.claude/skills/`.
- **Every change under `plugins/<name>/` bumps that plugin's `.claude-plugin/plugin.json`
  `version`.** No exceptions, including a change to a single script's behaviour. Bump **minor** only
  when the published surface grows (a new skill, agent, command, or hook event) and **patch** for
  everything else, including behaviour changes and commits labelled `feat:` — nothing reads the
  magnitude, so there is never a reason to inflate one. `.claude/skills/updating-maestro/` has the
  table and the worked examples.
- `plugins/maestro/scripts/lib/*.cjs` (except `maestro-tasks.cjs`) are **generated** from
  `apps/maestro/src/core/plugin-entries/*.ts`. Never hand-edit them — edit the TypeScript source and
  run `pnpm --filter maestro build:plugin-libs`.
- After rebuilding the libs, refresh this repo's tracked mirrors and prove parity before handing off:
  copy each changed lib in `install.ts`'s `STATIC_ASSETS` from `plugins/maestro/scripts/lib/` over
  `.claude/scripts/lib/` (likewise a changed `.js`/`.cjs` plugin script over its `.claude/scripts/`
  copy), then run `pnpm --filter maestro exec vitest run test/core/parity.test.ts`. The mirrors stay
  tracked on purpose; when two branches both rebuild a lib, `maestro-task-status.cjs merge` names the
  resolution (rebuild, copy, parity test) instead of leaving a hand-merge of bundle text.
- A hook script committed as `.js` under `plugins/maestro/scripts/` is copied into a project as
  `.cjs`. Never write `require()` in one assuming it keeps its `.js` extension at runtime.
