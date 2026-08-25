---
name: test-maestro-desktop
description: "Drive the Maestro desktop app (apps/maestro) in a real Electron window over the Chrome DevTools Protocol to test things no unit test can reach — React Flow canvas layout, node drags, modals, first-paint timing, theme, and save/reopen round trips. Use when verifying UI behaviour in a running window, reproducing a canvas or rendering bug, checking a change actually works in the packaged build, or when a claim about the app can only be settled by looking at a rendered window. Also carries the rules for where fixture projects may live, and the scribe handoff that closes out a task from .claude/maestro-tasks/."
---

# Test the Maestro desktop app in a real window

`apps/maestro` has two test suites (`apps/maestro/test/`, `apps/maestro/test/core/`) and
neither can reach the canvas. React Flow measures the DOM, dagre lays out against real dimensions,
and drag-to-persist only means something with actual pointer events. Anything of the form *"does
it look right / lay out right / respond right"* has to be answered by driving a window.

This skill is the harness for that, plus the traps that have already cost a session each.

## The rule this exists to enforce

**Decide it with evidence, not with reasoning about the code.** The `mounted` flag in
`workflow-canvas.tsx` was carried over from the web app as an SSR guard and argued about twice; it
was settled in ten minutes by sampling the container size on every frame of a cold load, with and
without it, and finding them identical. Three defects found the same way — a data-loss bug on
project switch, a CSP-blocked theme bootstrap, invisible canvas controls in dark mode — were
invisible to every test in the repo and to reading the source.

When you use this skill, end with numbers or a screenshot, not an assurance.

## Prerequisites

1. **Build first — and test the packaged build, not `dev`.**

   ```bash
   pnpm --filter maestro build
   ```

   `main/index.ts` calls `loadURL()` when `ELECTRON_RENDERER_URL` is set and `loadFile()`
   otherwise, so `dev` serves the renderer over `http://localhost:5173` and **never touches the
   `file://` path that ships**. Bugs in asset resolution, CSP, and code-splitting appear only in
   the packaged load. Always launch `electron .` against `out/`, never `pnpm dev`.

2. **The Electron sandbox needs its setuid bit** (once per install that re-extracts Electron).
   pnpm does not preserve it, and the app aborts with *"The SUID sandbox helper binary was found,
   but is not configured correctly."* This needs root, so hand it to the user to run:

   ```bash
   sudo chown root:root node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox
   sudo chmod 4755 node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox
   ```

   Do **not** work around it with `--no-sandbox`: renderer isolation from the OS is the premise
   `test/isolation.test.ts` spends four assertions defending. Check the bit with
   `ls -l node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox` — you want
   `-rwsr-xr-x` and `root root`.

## Quick start

The template creates its own fixture and asserts twelve things about a real window. Run it first —
it is the fastest check that the harness and the app still agree:

```bash
node .claude/skills/test-maestro-desktop/scripts/probe-template.mjs
```

Then copy it into the scratchpad and edit it for whatever you are actually testing:

```bash
cp .claude/skills/test-maestro-desktop/scripts/probe-template.mjs "$SCRATCHPAD/probe.mjs"
```

Import the harness by absolute path from the scratchpad; it has no dependencies (Node 22's global
`WebSocket` speaks CDP, which is why nothing was added to the repo for this).

## The harness

`scripts/cdp.mjs`:

| Export | Purpose |
|---|---|
| `withApp({appDir, electron, port, userDataDir, sampler}, fn)` | Launch, connect, run `fn(cdp, {errors, logs})`, always kill the process. `sampler: true` installs the per-frame sampler before any page script. |
| `openProjectAt(cdp, root, route)` | Open a project **without the native folder dialog**, then navigate. |
| `cdp.eval(body)` | Async function body evaluated in the page; use `return`, and `await` works. |
| `cdp.waitFor(expr, {label})` | Poll until truthy. Always prefer this to a fixed sleep. |
| `cdp.geometry()` | Node positions in flow space, screen rects, container rect, viewport transform. |
| `cdp.dragNode(id, dx, dy)` | Drag a node by a safe grab point; **throws if it didn't move**. |
| `cdp.drag(from, to)` / `cdp.click(x, y)` | Raw pointer input. |
| `cdp.clickElement(selectorFn)` | Real click, with an on-screen + topmost-element check that fails loudly. |
| `cdp.jsClick(selectorFn)` | Synthetic `.click()`. Correct for plain buttons; never for drags. |
| `cdp.setInputValue(sel, v)` | Set a **controlled React** input/textarea properly. |
| `cdp.installFrameSampler()` / `cdp.sampleSummary()` | Per-frame capture, reduced in-page. |
| `cdp.watchErrors()` | Console errors + uncaught exceptions (wired up by `withApp`). |
| `overlaps(a, b)` | Rect overlap, for asserting a layout doesn't stack nodes. |

Use a **fresh `--user-data-dir` per run** and a distinct port. The profile is where the app
remembers open/recent projects, so a stale one silently changes what a probe starts from.

## Recipes

**Open a project and land on the canvas.** Routing is hash history (packaged builds load over
`file://`), so navigation is a hash write. `window.maestro.project.open` is on the preload bridge:

```js
await openProjectAt(cdp, "/tmp/fixture", "#/workflows");
await cdp.waitFor(`!!document.querySelector(".react-flow__node")`, { label: "canvas nodes" });
```

**Answer a first-paint question.** `sampler: true` installs a `requestAnimationFrame` loop via
`Page.addScriptToEvaluateOnNewDocument`, so it runs *before* any page script and can observe
frames that precede React mounting. This is how you prove a claim about what React Flow measured:

```js
const s = await cdp.sampleSummary();
// s.frames, s.zeroSizeContainerFrames, s.zeroSizeNodeFrames, s.stackedFrames,
// s.firstFrameWithNodes, s.distinctViewportTransforms, s.settledViewportTransform
```

**Assert a layout is sane** (no stacking, no overlap, all on screen). If you are *computing* where
something on the canvas should go — an edge label anchor, a handle coordinate, a node's extent —
read `react-flow-canvas-geometry` first; the arithmetic has a trap that a window check will not
catch on its own:

```js
const g = await cdp.geometry();
const pairs = [];
for (let i = 0; i < g.nodes.length; i++)
  for (let j = i + 1; j < g.nodes.length; j++)
    if (overlaps(g.nodes[i], g.nodes[j])) pairs.push([g.nodes[i].id, g.nodes[j].id]);
```

**Detect thrash across a state change** — sample the viewport transform *and* the mounted node set
per frame, then count transform changes that happened while the **outgoing** set was still
mounted. That is how "the debounce doesn't fire against the workflow being replaced" was measured,
and it is a much sharper question than "does it look smooth".

**Verify persistence** by reading `.claude/maestro.json` directly after a save, then relaunching
and re-reading the DOM. Disk is the ground truth; the DOM confirms it round-trips.

**Screenshot.** `Page.captureScreenshot` with a `clip` gives a zoomed crop. Some bugs — the
invisible dark-mode canvas controls — are only visible this way. Read pixels when you need
certainty:

```js
await cdp.eval(`const el = document.querySelector(".react-flow__controls-zoomin");
  const s = getComputedStyle(el);
  return s.color + " on " + s.backgroundColor;`);
// dark: "rgb(248, 248, 248) on rgb(43, 43, 43)"   light: "rgb(28, 25, 23) on rgb(254, 254, 254)"
```

React Flow does **not** inherit the app's theme — it picks between its own `--xy-*` palettes from
its `colorMode` prop, which `workflow-canvas.tsx` drives off the `dark`/`light` class on `<html>`.
Left unset it stayed light while the app was dark, rendering near-white icons on a near-white
button. Contrast regressions here are invisible to everything except reading pixels.

## Traps — all of these were measured, not guessed

- **Never `scrollIntoView` an element inside the React Flow pane.** Measured on an edge-label
  button: the reported rect moves from (1090,520) to (908,416), and `getBoundingClientRect` *and*
  `elementFromPoint` both agree on the new coordinates — while a real mouse click there does
  nothing, because input hit-testing does not honour the scroll `scrollIntoView` performed on the
  pane's `overflow: hidden` container. Everything looks consistent and the click silently misses.
  `clickElement` therefore does not scroll by default.
- **Don't return `window.__samples` raw.** A few seconds of sampling is hundreds of frames;
  `Runtime.evaluate` with `returnByValue` fails to serialise that and hands back `undefined`
  **without throwing**. `window.__samples || []` then yields `[]`, and every `.every()` assertion
  over it passes vacuously. Reduce in the page — that is what `sampleSummary()` is for.
- **A drag needs real pointer events; a button does not.** React Flow tracks pointer state across
  press/move/release, so a synthetic `.click()` never moves a node — but a real click needs the
  target on screen and topmost. Use `dragNode`/`drag` for the canvas and `jsClick` for buttons.
- **Check the node actually moved.** Grabbing a React Flow handle starts an *edge connection*, and
  grabbing a node's own `+`/`⋮` button does nothing; both leave the node where it was. `dragNode`
  picks a safe point and throws if the transform didn't change — do not hand-roll this.
- **"Save workflows" is often below the fold.** The left pane is `overflow-y-auto` and the agent
  list is long in a real project, so the button sits outside the viewport and a real click lands on
  nothing — the probe then times out much later waiting for a toast. Use `jsClick`.
- **Assigning `.value` does not notify React.** It bypasses the setter React patched, and the next
  render restores the old value. Use `setInputValue`, which calls the native prototype setter and
  dispatches a bubbling `input`.
- **Menu rows are `<div onClick>`, not `<button>`.** The workflow switcher's items match neither
  `querySelectorAll("button")` nor a text search over buttons. Open the trigger
  (`button[title="Switch workflow"]`), then click the row.
- **Wait for a toast, not a timer.** `cdp.waitFor` on the toast text is both faster and far more
  reliable than sleeping, and a timeout tells you the save genuinely failed.

## Selector reference

| Thing | How to find it |
|---|---|
| Canvas node | `.react-flow__node[data-id="<id>"]` — `style.transform` is its flow-space position |
| Viewport | `.react-flow__viewport` — `style.transform` is the pan/zoom |
| Edge label + editor | `.react-flow__edgelabel-renderer span`, then `button[title="Edit label"]` beside it |
| Workflow switcher | `button[title="Switch workflow"]`, then a `div[class*="cursor-pointer"]` row |
| Save (workflows / rules) | `button` whose text matches `/Save workflows/` or `/Save rules/` |
| Label modal Save | `button` with text `Save` inside `.absolute.inset-0` |
| Seeded banner | body text `/starter configuration/i` (workflows), `/Assignments start empty/i` (rules) |
| Save confirmation | body text `/Saved to/` (workflows), `/Rules saved to/` (rules) |
| Resolved theme | `document.documentElement.className` — `dark` or `light`, set pre-paint |
| React Flow's own theme | `.react-flow` carries the same `dark`/`light` class, driven by its `colorMode` prop |
| Canvas controls | `.react-flow__controls-zoomin` / `-zoomout` / `-fitview` / `-interactive` |

## Fixtures

**Fixture projects live under `~/gits/<throwaway-name>` and nowhere else.** Two separate reasons,
and the second is the one that matters:

- Never point a probe at a repo you care about — saving rewrites `.claude/maestro.json` and *moves
  rule files*.
- Never point one outside `~/gits` at all. Opening a project **grants its root to a live Claude
  session** with real tools, and any probe that clicks through a permission prompt is deciding, on
  the user's behalf and with nobody watching, what an agent may read. `~/Documents`, the home
  directory itself, `/etc`, `/proc`, `/sys`, `/usr` and anything else the OS owns are out of bounds
  three times over: as a fixture root, as a directory added to a session's scope, and as the target
  of anything a probe answers "allow" to. If a test seems to need one of those, the test is wrong.

The scratchpad is still right for probe *scripts* and `--user-data-dir` profiles; it is the project
roots that belong in `~/gits`. Name them for the slice (`~/gits/maestro-025-pane`), and say in your
report where they were, so the grant is auditable. Two shapes cover most work:

- a project whose workflow nodes carry **no** `position`, which is what forces a dagre layout;
- a project with **no** `.claude/maestro.json` at all, which exercises the seeded starter config
  and its banner.

`probe-template.mjs` writes the first one and is the quickest thing to copy. For rules work, add
`.claude/rules/<id>.md` files with `name`/`description` frontmatter.

## Reporting

Report what you measured — the numbers, the before/after, the frame counts — and say plainly when
something could not be verified. If a probe passes, check it isn't passing vacuously: a summary
with `frames: 0` or an unchanged node position means the assertions never ran against anything.

## Finishing a maestro task

When the work being probed is a slice from `.claude/maestro-tasks/`, the run is not done when the
window is green. **Hand off to the `scribe` agent** (`plugins/maestro/agents/scribe.md`)
before reporting back.

Why it is a step rather than a nicety: those task pages are written *before* the slice is built, and
a slice that diverges silently leaves the next one planned against an app that no longer exists.
`025` was written expecting to filter the session store for terminal-started conversations; the
option that does that was measured to return zero rows for the app's own sessions, so the rule
shipped inverted. A later task reading the unamended page would have planned around a filter that is
not there. The scribe's job is to close that gap while you still remember the measurement.

Tell it, in one handoff message:

- **What was built** — files added, changed, renamed; new channels, modules, exported names.
- **What diverged from the task page, and why** — one entry per divergence, each with the
  measurement or constraint that forced it. This is the part the page cannot reconstruct later.
- **To amend the task page itself** — tick the acceptance criteria with the evidence beside each,
  and record the divergences on the page, so it describes what exists rather than what was planned.
- **To check the *following* task pages for staleness** — anything downstream that assumed the
  planned shape needs correcting now, so the task structure has no gaps.
- **To update `TODO.md`** with the next task to pick up, and **`.claude/maestro-tasks/status.json`**
  with the finished task's state.

Three things learned running this:

- **The scribe cannot run commands** (`disallowedTools: [Bash, Task]`) and its own workflow forbids
  re-discovering changes by scanning code. Your handoff is the only source it has — if a file or a
  divergence is not in the message, it will not be in the docs. Do not send it to "go look".
- **It can fail after writing.** A 529 mid-run reported the whole agent as failed while every edit
  was already on disk. Check `git status` and read the diffs before re-running anything, or you will
  duplicate its work on top of itself.
- **Verify its claims like any other report.** Grep for the exported names and files it says it
  documented; a doc that names something that does not exist is worse than no doc.

Then relay what it changed to the user — its report goes to you, not to them.
