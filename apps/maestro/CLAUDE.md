# maestro (desktop)

The Maestro desktop app is an Electron shell over the node-side Maestro logic in `src/core/`. It
opens a project folder, edits and saves the full Maestro config with **no Claude session in the
loop** for a save, and live-tails the session log the Claude Code hooks write. It also owns the
`/tools` dashboard and the two documentation readers (`/docs`, `/project-docs`), and can run Claude
itself — either as a
one-shot confirmed run (create-\* forms, `/maestro-tasks`) or as a live, multi-turn session in a
right-hand pane.

## Process layout

```
src/core/      ALL node-side Maestro logic, framework-free. No React, no Electron.
src/main/      electron. Owns the project state, the log tail, the pane session, the IPC handlers.
src/preload/   the contextBridge. The ONLY path from renderer to node.
src/renderer/  a TanStack Router SPA. No node imports at all.
src/shared/    ipc.ts — the typed channel contract, imported by all three.
```

`src/main/ipc.ts` is a list of thin adapters over `src/core/`; the logic is tested under
`test/core/` with no Electron runtime, keeping a 200-test suite running in about a second.

## Commands

```bash
pnpm --filter maestro dev        # electron-vite dev, HMR on the renderer
pnpm --filter maestro build
pnpm --filter maestro typecheck  # both tsconfig projects
pnpm --filter maestro test       # test/ and test/core/ as one suite
pnpm --filter maestro build:plugin-libs   # after ANY edit under src/core/plugin-entries' graph
```
