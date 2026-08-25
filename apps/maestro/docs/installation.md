# Installation (developers)

How to get Maestro running from source. For building a copy to actually use day-to-day, see
[`build-app.md`](./build-app.md).

## Prerequisites

- **Node.js** — a recent LTS (20+).
- **pnpm** — the repo pins `packageManager: pnpm@11.9.0` in the root `package.json`. With Corepack
  enabled (`corepack enable`), running `pnpm` in this repo picks up that version automatically.
- **git**.
- Optional, for the features that talk to Claude — the `claude` CLI, installed and logged into a
  Claude subscription. Without it the app still opens projects, edits `maestro.json` and tails the
  session log; the Claude bridge (the four create-\* forms, `/maestro-tasks`, the session pane)
  degrades to a message naming the tool and saying it wasn't found, rather than failing partway
  through a run.

## Clone and install

Maestro lives inside this repo's pnpm workspace (`apps/*`, `packages/*`), so install from the repo
root, not from `apps/maestro`:

```bash
git clone https://github.com/Lichens-Innovation/ai-dev-tools.git
cd ai-dev-tools/apps/maestro
just install
```

`install` resolves and builds every workspace package Maestro depends on (`@repo/ui`,
`@repo/styles`, `@repo/claude-fs`, `@repo/typescript-config`), and runs Electron's and esbuild's
postinstall steps to fetch their platform binaries (`allowBuilds` in `pnpm-workspace.yaml`
allow-lists both). See the `justfile` if you need to know what it runs under the hood.

## Linux: fix the sandbox helper

`pnpm`'s extraction doesn't preserve the setuid bit on Electron's sandbox helper, so `dev` aborts
on Linux with:

> The SUID sandbox helper binary was found, but is not configured correctly.

Fix the store copy once after any install that re-extracts Electron (both
`node_modules/electron` and `apps/maestro/node_modules/electron` symlink into it):

```bash
sudo chown root:root node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox
```

Don't work around it with `--no-sandbox` — the renderer's OS-level isolation is a property
`test/isolation.test.ts` exists to defend, and disabling the sandbox hides regressions in it rather
than fixing anything.

## Run it

With [`just`](https://github.com/casey/just) installed, run `just` from `apps/maestro` to list
every available command:

```bash
just dev        # electron-vite dev, HMR on the renderer
```

## Run the tests

```bash
just test        # test/ and test/core/ as one vitest suite
just typecheck    # tsconfig.node.json and tsconfig.web.json
just lint         # prettier --check
just format       # prettier --write
just verify       # typecheck + lint + test, the full pre-PR check
```

`test/core/` needs no Electron runtime at all — it's the node-side logic in `src/core/` tested in
isolation, which is what keeps the full suite running in about a second.

See [`build-app.md`](./build-app.md) for producing a build you can actually launch as an app, and
`CLAUDE.md` → "Driving the window" for exercising things a vitest run can't reach (the React Flow
canvas, drag interactions, screenshots).
