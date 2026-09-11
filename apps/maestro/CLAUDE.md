# maestro (desktop)

The Maestro desktop app is an Electron shell over the node-side Maestro logic in `src/core/`. It
opens a project folder, edits and saves the full Maestro config with **no Claude session in the
loop** for a save, and live-tails the session log the Claude Code hooks write. It also owns the
`/tools` dashboard and `/docs` documentation reader, and can run Claude itself — either as a
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

## Things that bite

- **Hash history, not browser history.** A packaged build loads the renderer over `file://`,
  where pushState paths don't resolve on reload. See `src/renderer/src/main.tsx`. **Corollary: a
  route cannot also use the URL fragment.** The whole route already lives in `location.hash`, so a
  second `#` in it is not something the router or `querySelector` can be trusted to split — which
  is why the docs reader carries the heading to scroll to as the `at` SEARCH param and scrolls by
  element id. For the same reason `/docs/$slug` intercepts in-page `#anchor` links in rendered
  markdown: left alone, one would rewrite the route and throw the reader out of the app.
- **`components={{ text: … }}` in react-markdown highlights nothing.** `components` is keyed by
  ELEMENT name, and `text` is the **SVG** `<text>` element, not a markdown text node. It
  type-checks (it's a real JSX intrinsic) and renders, but the body highlight silently never
  happens — caught only by a window probe counting zero `<mark>` elements in an article opened from
  a search hit. Text nodes are reachable from a rehype plugin instead, so `utils/highlight.ts` marks
  the hast tree — which also lights up a term inside a link, list item or table cell, unlike the
  per-element approach.
- **A doc slug is renderer input, and the reader treats it as such.** `isValidDocSlug` in
  `src/core/docs.ts` rejects anything containing `/`, `\` or `.` _before_ the path is joined, since
  the slug arrives as a route param and `../../../etc/passwd` is a file `readDoc` would otherwise
  open and render. Keep the check before the `path.join`, not after.
- **Clear the transcript BEFORE a resume round trip, never after.** Main pushes the resumed
  session's notice **during** the `session:resume` call, so `setEntries([])` after the `await`
  deletes the one thing saying what was picked up, what it cost, and that it forked — and the pane
  looks as though it started a session silently. Nothing errors, no test catches it, and it's only
  visible in a real window. The same ordering applies to any channel where main streams an event
  while the handler is still resolving.

## Dev

### Node version — `node:sqlite`

`skill-tags.ts` (the Skills tab's tag store) uses Node's built-in `node:sqlite`, not
`better-sqlite3` — no native module, no Electron-rebuild step. Electron 40 bundles Node 24, where
it loads fine (just the standard experimental-feature warning); the test suite or
`maestro-install.js` under an older system `node` needs at least 22.5 for the module to exist at
all. `maestro-install.js`'s own `require("./lib/maestro-skill-tags.cjs")` is wrapped in try/catch
for that case — an older `node` on the session's PATH degrades to the pre-tags, fully Claude-driven
best-fit flow instead of failing the install.

### Linux sandbox fix (required after any install that re-extracts Electron)

```bash
sudo chown root:root node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox
```

Without it `dev` aborts with _"The SUID sandbox helper binary was found, but is not configured
correctly"_. pnpm doesn't preserve the setuid bit, and both `node_modules/electron` and
`apps/maestro/node_modules/electron` symlink into the store, so fix the store copy, not the links.
Do **not** work around it with `--no-sandbox`: the renderer's OS isolation is the premise
`test/isolation.test.ts` exists to defend. (`gits/farel` documents the same fix for an npm layout.)

```bash
pnpm --filter maestro dev        # electron-vite dev, HMR on the renderer
pnpm --filter maestro build
pnpm --filter maestro typecheck  # both tsconfig projects
pnpm --filter maestro test       # test/ and test/core/ as one suite
pnpm --filter maestro build:plugin-libs   # after ANY edit under src/core/plugin-entries' graph
```

`test/core/` is where the differential tests live: parity against the last hand-written `.cjs`
implementations (snapshotted under `test/core/fixtures/legacy/`, deliberately _not_ read from
`plugins/…/scripts/lib/`, which `build:plugin-libs` overwrites and would make the comparison
tautological), a byte-identity check on the rendered `SKILL.md`, and the import-graph walk proving
`claude-preview.ts` cannot spawn.

### Driving the window (canvas interactions, screenshots)

Nothing in `test/` can reach the canvas: React Flow measures the DOM, dagre lays out against real
dimensions, and drag-to-persist only means something with actual pointer events. The `test-maestro`
skill (`.claude/skills/test-maestro/`) wraps a CDP harness for this — build first, launch the
**packaged** app (`electron .`, never `dev`, which skips the `file://` path that ships), and speak
CDP to it. Prefer it over hand-rolling CDP calls.

Checking the Agent SDK's own packaging failures from a real launch (`MAESTRO_AGENT_SDK_SMOKE`) is
`claude-session-bridge`'s subject, not this file's — see its `agent-sdk.md` sub-concept.
