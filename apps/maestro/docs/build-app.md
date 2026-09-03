# Building the desktop app

For setting up a dev environment first, see [`installation.md`](./installation.md).

## Build

```bash
cd apps/maestro
just build       # electron-vite build → out/
```

This bundles `src/main`, `src/preload` and `src/renderer` into `out/main`, `out/preload` and
`out/renderer`. Assets resolve relatively (`base: "./"`) because the renderer is loaded over
`file://` in a real launch, not over `http://localhost` the way `dev` serves it — see
`CLAUDE.md` → "`dev` does not exercise the `file://` path at all" if a route works under `dev` but
renders blank in a build.

## Run the build

There's no installer yet (see below), so "using the app on the desktop" today means launching the
built output directly:

```bash
cd apps/maestro
just start       # builds, then runs electron-vite's own preview command
```

This loads `out/main/index.js`, which in turn loads the renderer from `out/renderer` over
`file://`. Use `just start` rather than `just dev` whenever you need to verify the packaged
behaviour — window interactions, canvas drags, the CDP probes `CLAUDE.md` describes under "Driving
the window" — since `dev` never touches this path.

## No installer (electron-builder) yet

This repo has no `electron-builder` (or equivalent) configuration, so there's no `.dmg`/`.exe`/
`.AppImage` to hand someone — building means producing `out/`, not a signed, double-clickable
installer. If you're adding that:

- The Agent SDK resolves the `claude` CLI and its own runtime **on disk**, so
  `@anthropic-ai/claude-agent-sdk` must be **externalized**, not bundled, or its own
  `require.resolve` runs against `out/main/` and throws `Native CLI binary for <platform> not
  found`. `electron.vite.config.ts`'s `EXTERNAL` list (derived from `package.json`
  `dependencies`) already does this for the dev/preview build; a packager needs the same
  exclusion.
- A packaged app additionally needs `asar: { unpack: "**/node_modules/@anthropic-ai/**" }`, plus
  rewriting the resolved path from `app.asar` to `app.asar.unpacked` — the single most commonly
  reported Agent-SDK-in-Electron failure. `CLAUDE.md` → "Things that bite" has the full note; the
  `MAESTRO_AGENT_SDK_SMOKE` receipt's `sdkVersion: null` is what that failure looks like if it
  regresses.

## Installing the repo's marketplace

Maestro bundles the `maestro` plugin with the app itself (for the create-\* forms and the
session pane), so those features work with no separate install. But using this repo's skills,
subagents, hooks from a regular Claude Code session — including outside any project Maestro has
touched — means registering this repo as a plugin marketplace once:

```bash
git clone https://github.com/sdaigle-lichens/maestro.git
claude plugin marketplace add ./maestro
claude plugin install maestro@maestro
```

See the root [`README.md`](../../../README.md) → "Installing the Maestro plugin". General Claude
Code plugin/marketplace concepts (not specific to this repo) live in the `ai-dev-tools` repo's
`docs/plugins.md` and `docs/marketplace.md`.
