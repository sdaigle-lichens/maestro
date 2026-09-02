# maestro (marketplace)

This repository is a Claude Code plugin marketplace catalog. `.claude-plugin/marketplace.json` is
the manifest and the source of truth for what is published — plugins live at `plugins/<name>/`,
each with its own `.claude-plugin/plugin.json`.

It is also a pnpm/Turborepo monorepo: `apps/maestro` is the Electron desktop app that authors a
project's Maestro workflow graph, and `packages/*` are shared libraries it consumes
(`@repo/ui`, `@repo/styles`, `@repo/claude-fs`, `@repo/typescript-config`). The `maestro` plugin
under `plugins/maestro/` is the runtime half — its `scripts/lib/*.cjs` files are generated from
`apps/maestro/src/core/plugin-entries/*.ts` via `apps/maestro/scripts/build-plugin-libs.mjs`; run
that after editing a `plugin-entries/*.ts` source or the plugin's hooks silently run stale code.

See `apps/maestro/CLAUDE.md` for the app's own architecture, `.claude/skills/maestro-architecture/`
for how the runtime behaves in a session, and `plugins/maestro/skills/maestro-{install,update,uninstall}/`
for the published install flows themselves.

## `plugins/` is published, not developer documentation

Everything under `plugins/<name>/` ships to that plugin's **end users**. Nothing that exists to help
someone develop *this repo* belongs there — no `.claude/` directory, no developer-facing skills, no
architecture notes.

Documentation written for agents working on this codebase — **concept skills** in particular — goes
in the `.claude/skills/` **nearest the code it describes**, choosing only between:

- `apps/<app>/.claude/skills/` — for a concept that lives inside that app.
- `.claude/skills/` at the repo root — for anything else, including concepts whose code lives under
  `plugins/maestro/` (the runtime, the install/update paths, the task queue, the concept-skill
  machinery). These have no app to belong to, and root skills load repo-wide.

The distinction is by **audience**, not by which directory the code sits in.
`.claude/skills/maestro-architecture/` documents `plugins/maestro/` for developers and therefore
lives at the root; `plugins/maestro/skills/maestro-install/` is a skill the plugin publishes and
therefore lives in the plugin.

## Concept skills

A concept skill is a `SKILL.md` whose frontmatter carries `metadata.type: concept-skill`, plus a
`version` and the `last-update` commit. The list is discovered across every `.claude` in the tree:

```bash
node plugins/maestro/scripts/maestro-concept-skills.cjs list
```

Never hand-edit `metadata.version` or `metadata.last-update` — that script owns them. Repo-level
state lives in `.claude/concept-skills.json` (not `maestro.json`). See
`.claude/skills/concept-skills-system/` for the full mechanism, and `/scribe` for the rule on what
belongs in a concept skill versus in `docs/`.
