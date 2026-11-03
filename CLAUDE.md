# maestro (marketplace)

This repository is a Claude Code plugin marketplace catalog. `.claude-plugin/marketplace.json` is
the manifest and the source of truth for what is published — plugins live at `plugins/<name>/`,
each with its own `.claude-plugin/plugin.json`.

It is also a pnpm/Turborepo monorepo: `apps/maestro` is the Electron desktop app that authors a
project's Maestro workflow graph, and `packages/*` are its shared libraries
(`@repo/ui`, `@repo/styles`, `@repo/claude-fs`, `@repo/typescript-config`, `@repo/eslint-config`).
Concept skills are not published here: the opt-in `code-graph` plugin, from its own marketplace, owns
that machinery. The `maestro` plugin
under `plugins/maestro/` is the runtime half — its `scripts/lib/*.cjs` files are generated from
`apps/maestro/src/core/plugin-entries/*.ts` via `apps/maestro/scripts/build-plugin-libs.mjs`. Run
that after editing a `plugin-entries/*.ts` source, or the plugin's hooks silently run stale code.
To refresh everything this repo tracks after a plugin change (libs, `.claude/scripts` mirrors, the
rendered orchestrator's HANDOFFS and STEPS, the settings hooks) run `pnpm refresh:runtime`; a sandboxed
agent cannot write those paths and hands the user exactly `! pnpm refresh:runtime`.
`maestro-render-orchestrator.cjs` alone does not refresh STEPS.

See `apps/maestro/CLAUDE.md` for the app's own architecture, `.claude/skills/maestro-architecture/`
for how the runtime behaves in a session, and `plugins/maestro/skills/maestro-{install,update,uninstall}/`
for the published install flows themselves.

`plugins/` is published to end users and has its own invariants — see
`.claude/rules/plugin-publishing.md` (auto-loaded). Developer documentation belongs in this repo's
own `.claude/skills/`, never under `plugins/`.

Lint: `pnpm lint` runs each package's own `eslint.config.js` (presets from `@repo/eslint-config`:
`react`, `node`, `cjs`) via turbo, then the root `eslint.config.mjs`, which covers only the plugin's
hand-written `plugins/maestro/scripts/*`. `pnpm verify` runs lint first, then check/typecheck/test. The root `check` (and `format`) also runs
Prettier over `plugins/`'s hand-written code, but not its markdown or `scripts/lib/` bundles.
