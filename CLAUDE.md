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

See `apps/maestro/CLAUDE.md` for the app's own architecture, and `plugins/maestro/` skills for the
runtime's install/uninstall/update flows.
