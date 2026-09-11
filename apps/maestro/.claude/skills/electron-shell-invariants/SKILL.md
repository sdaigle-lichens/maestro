---
name: electron-shell-invariants
description: "Explains the invariants of running the Maestro desktop app as an Electron shell over node-side logic, that don't belong to any one view or to the Claude bridge: the renderer's CSP forbidding inline script, the asar/externalizeDepsPlugin packaging trio, the settingSources: [] four-occurrence lockstep rule in agent-sdk.ts, the project-switch invalidation + key={projectRoot} keying pattern shared by every stateful view and tail, the renderer's code-splitting shape and its measurements, and the process-boundary contract test/isolation.test.ts enforces (nodeIntegration/contextIsolation/no src/core barrel outside main). Use when working on apps/maestro's Electron/Vite config, adding state that must survive a project switch, debugging a theme flash or a route that renders blank only in the packaged build, or wondering why an edit silently didn't reach across the renderer/main boundary."
metadata:
  type: concept-skill
  version: "1.0"
  last-update: 0ebccda448b85ccba2da3e292cc874043a19b431
---

# Electron shell invariants

The Maestro desktop app is an Electron shell over the node-side Maestro logic in `src/core/`
(`apps/maestro/CLAUDE.md`'s own opening line). Most of what that means is covered where it's used —
`claude-session-bridge` for the Agent SDK's own packaging traps, `workflow-view`/`rule-view`/
`log-view`/`task-queue` for how each view survives a project switch. This skill is what's left:
invariants of the **shell itself** — the renderer's security policy, how the bundler decides what
ships where, and the one keying pattern every stateful view independently reinvents — that don't
belong to any of those.

## The renderer's CSP forbids inline script

`src/renderer/index.html` declares `script-src 'self'`. Two consequences that read as bugs the first
time:

- **The pre-paint theme bootstrap cannot be inlined.** It lives in
  `src/renderer/public/theme-bootstrap.js`, loaded as a parser-blocking `<script src>`. Inlining it
  back "because it's four lines" silently reintroduces a theme flash — the browser blocks the inline
  script outright, and the theme is then only applied once `ThemeToggle`'s effect runs.
- **A Google Fonts `@import` is blocked the same way.** Fonts are vendored into `packages/styles` and
  served same-origin instead — see `packages/styles/README.md` before changing a weight, and don't
  restore a CDN `@import`. `test/isolation.test.ts` asserts the built renderer CSS references nothing
  off-origin.

`__root.tsx` has no `shellComponent`: the root route owns no `<html>` document. `<head>`, `<body>`
and the theme bootstrap script tag all live in `src/renderer/index.html`, alongside the CSP — which
is why the policy has to be satisfied there and not in a route component.

## Packaging: asar, `externalizeDepsPlugin`, and what actually gets externalized

- **`@repo/claude-fs` must be bundled into main, not externalized.** It's a workspace *source*
  package with no build artifact, so `require` can't resolve it at runtime — hence the
  `externalizeDepsPlugin({ exclude: [...] })` in `electron.vite.config.ts`. `src/core/` is ordinary
  app source that gets bundled without anyone having to ask.
- **`externalizeDepsPlugin` does not externalize anything on its own, and the app's runtime
  `dependencies` are externalized by hand.** The plugin computes its list from `package.json`
  `dependencies` and then assigns `config.build` from inside the `config` hook — a vite/electron-vite
  breakage documented in `electron.vite.config.ts`'s own comment for its `include` option, and it
  costs the whole plugin. This was invisible for as long as the app had **no `dependencies` block at
  all** (every entry was a devDependency), because an empty external list and an ignored one look
  identical. Measured when the first real dependency arrived: `@anthropic-ai/claude-agent-sdk` in
  `dependencies`, and only the plugin to externalize it, put **1.34 MB of SDK into
  `out/main/chunks/`**. `EXTERNAL` in `electron.vite.config.ts` now derives from the manifest and
  goes into `rollupOptions.external` directly, where it actually takes effect — including a regex for
  subpath imports, which a bare package name does not cover. The plugin call stays because it is
  harmless and correct in intent; it is simply not what is doing the work.
- **The Agent SDK's own three packaging failures (must-be-externalized, asar unpacking, the CLI path
  handed over rather than resolved) are `claude-session-bridge`'s subject, not this skill's** — see
  its `agent-sdk.md` sub-concept. This skill only owns the general externalize/bundle mechanics above;
  that one owns what breaks specifically for `@anthropic-ai/claude-agent-sdk`.

## `settingSources: []` appears FOUR times in `agent-sdk.ts`, and they must stay in lockstep

The smoke query, the run's own session, the pane session, and `resolveEffectiveSettings(cwd)` — the
last of which backs the read disclosure. The first three are so nothing on disk can redirect billing
or widen permissions; the fourth is so the confirmation describes **the session that actually
exists**. Configure the run one way and resolve the other and the disclosure silently becomes a lie —
it keeps describing a session that is gone, and **nothing fails**. `test/isolation.test.ts` counts
the four occurrences for exactly that reason; if a fifth call site with an opinion about
`settingSources` is ever added, it needs a fifth count, not an exception. `[]` does not drop the
managed (administrator) policy tier — that is still read from disk and still applies — and it is why
a pane session auto-loads no `CLAUDE.md` (the SDK requires `settingSources` to include `'project'`
for that). See `claude-session-bridge` for what a run or pane session actually gets *instead* of
filesystem settings.

## The project-switch invalidation + `key={projectRoot}` keying pattern

Every route loader reads the *current* project from main-process state, so `ProjectProvider` calls
`router.invalidate()` on the `project:changed` broadcast — without it, a switch leaves stale data on
screen. That re-runs the loader, but **re-running a loader is not enough on its own**: any state
seeded from loader data and then edited in place has to decide whether an incoming payload replaces
it, and "did I already seed?" is the wrong question, because a project switch and a mid-edit
re-render are both invalidations. Guarding on `config !== null` and on `useState(loaderData.…)` never
re-running each produced the identical failure independently: the canvas kept rendering project A
while the window was on B, and Save wrote A's config into B's `maestro.json`.

**The fix is a key, not a flag.** `/workflows` keys `seedWorkflowStore` on `projectRoot` (and resets
`activeWorkflowIdx`, which indexes the outgoing project's list); `/rules` remounts its editor with
`key={projectRoot}`. Prefer the key — it re-initialises every derived piece at once, rather than
requiring every future field to remember its own guard. `test/workflow-store.test.ts` pins the store
half; the failure is otherwise silent.

**A save does not refresh loader data on its own — invalidate after one, and only because of the
keying above.** A save is neither a navigation nor a project switch, so the loader's computed values
(most visibly `seeded`) stay pinned at load time — a successful `/rules` save that *moves rule files*
is the sharpest case, since the tree and rule pool it rendered now describe a layout that no longer
exists. Both `/workflows` and `/rules` call `router.invalidate()` on the save success path, and this
is safe *only* because of the keying pattern above: `seedWorkflowStore` bails on an unchanged
`projectRoot` and `/rules`' `key={projectRoot}` is unchanged, so re-running the loader cannot discard
an in-flight edit. `test/isolation.test.ts` pins both call sites; no render test would catch the
regression on its own.

This one pattern — invalidate the loader, then key or guard derived state by `projectRoot` so the
re-run can't clobber an edit — is what `log-view`'s tail retargeting, `task-queue`'s tail retargeting,
and the Claude bridge's dropped preview tokens on a project switch are each a specific instance of.
Read this skill for the general shape; read those for what each one is protecting.

## Code-splitting

The renderer bundle is code-split (`autoCodeSplitting: true`). Measured 2026-07-31: unsplit was one
2,346 kB chunk; split is 593 kB shared + 772 kB `/workflows` (React Flow + dagre) + 802 kB
`/maestro-tasks` (react-markdown) + ~26 kB for the rest. The landing route is `/`, the project picker,
which needs none of that — so startup parse drops by roughly 75%. Re-measured 2026-08-04, by counting
the chunks the packaged app actually requests (CDP `Network.requestWillBeSent`; `file://` module
loads produce no `PerformanceResourceTiming` entries, so the obvious way to measure this returns an
empty array and reads as "nothing loaded"): the landing route pulls 14 chunks / 1,107 kB; `/tools`
adds 117 kB; `/docs/$slug` adds 558 kB, of which 555 kB is the react-markdown chunk **shared** with
`/maestro-tasks` rather than duplicated into it.

What makes this safe over the packaged `file://` load is that assets resolve relatively
(`base: "./"`); anything that regresses that leaves routes blank in a packaged build while `dev` —
served over `http://localhost:5173` — stays perfectly happy. **`dev` does not exercise the `file://`
path at all**: `main/index.ts` only calls `loadFile()` when `ELECTRON_RENDERER_URL` is unset. Verify
route navigation with `build` + `start` (or the `test-maestro` skill's packaged-build harness), never
with `dev` alone.

## The process-boundary contract (`test/isolation.test.ts`)

One test file guards the shell's own security boundary: `nodeIntegration: false`,
`contextIsolation: true`, one exposed namespace (`window.maestro`), no generic
`invoke(channel, …)` escape hatch, no node builtins in the built renderer bundle, and — outside
`src/main/` — no import of the `src/core/index.ts` barrel, `@repo/claude-fs`, or any `node:` builtin.
These are configuration and convention properties that would all regress silently without an
assertion; there is no runtime error waiting to catch a renderer that quietly gained a node import.

This same file also pins the Claude bridge's own permission-model invariants (no edit
pre-acceptance, the four `settingSources: []` occurrences, the session-pane's single-owner and
token-only-write guarantees, and so on) — those are `claude-session-bridge`'s subject, documented in
its own "invariants are asserted" section. This skill owns the general shell/process-boundary half of
the same file; that one owns the permission-specific half.

## Main-process discipline: `getState()` and `callMain()`

- **`getState()` in `project-store.ts` must not write.** It is called by `currentRoot()` from every
  IPC handler; pruning-and-rewriting there meant an `existsSync` per remembered project on *every*
  handler call, and made merely opening the app mutate `projects.json`. Pruning happens once, when
  the file is first read, and only real mutations persist afterward.
- **Every fallible main-process call goes through `callMain()`**
  (`renderer/src/utils/call-main.ts`). `ipcMain.handle` handlers throw — `config:save` throws when no
  project is open, and every route is reachable in that state. A bare `await` on a rejected channel is
  an unhandled rejection: no toast, and any `setPhase("idle")` after the `await` never runs, so the
  button spins forever. Pair a raw IPC call with `try/finally` around the phase reset, or use
  `callMain()`, which already does.

## Files

| File | Role |
| --- | --- |
| `apps/maestro/src/renderer/index.html` | The CSP, the theme-bootstrap `<script src>`, the document `__root.tsx` doesn't own. |
| `apps/maestro/src/renderer/public/theme-bootstrap.js` | The pre-paint theme script, kept out of the CSP's way. |
| `apps/maestro/electron.vite.config.ts` | `externalizeDepsPlugin`, the hand-derived `EXTERNAL` list, `base: "./"`. |
| `apps/maestro/src/main/project-store.ts` | `getState()`, `currentRoot()`, the read-once pruning rule. |
| `apps/maestro/src/renderer/src/utils/call-main.ts` | `callMain()` — the one place a fallible IPC call is supposed to go through. |
| `apps/maestro/src/renderer/src/utils/session-log-context.tsx`, `.../session-context.tsx` | Single-owner subscribers each retargeted on project switch — a `log-view`/`claude-session-bridge` concern, cited here as an instance of the keying pattern. |
| `apps/maestro/test/isolation.test.ts` | The process-boundary assertions this skill describes, plus the Claude-bridge-specific ones `claude-session-bridge` owns. |
| `apps/maestro/test/workflow-store.test.ts` | Pins the `projectRoot`-keyed store half of the keying pattern. |

## Relationships

- [`claude-session-bridge`](../claude-session-bridge/SKILL.md) — the Agent SDK's own three packaging
  failures, what `settingSources: []` is *for*, and the permission-model half of
  `test/isolation.test.ts`.
- [`workflow-view`](../workflow-view/SKILL.md), [`rule-view`](../rule-view/SKILL.md) — the two
  concrete instances of the invalidate-then-key pattern, one per editor.
- [`log-view`](../log-view/SKILL.md), [`task-queue`](../task-queue/SKILL.md) (repo root
  `.claude/skills`) — the tail-retargeting instance of the same pattern, for a poll-based live view
  instead of a loader.
- [`test-maestro`](../test-maestro/SKILL.md) — how to verify a packaged-build-only claim (code
  splitting, CSP, asset resolution) in a real window rather than under `dev`.
