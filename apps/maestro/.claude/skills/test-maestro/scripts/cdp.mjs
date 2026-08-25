// A minimal Chrome DevTools Protocol client for driving the Maestro desktop app.
//
// No dependency, by design: Node 22's global WebSocket speaks the protocol, and adding a
// puppeteer-class dependency to this repo just to press a mouse button would be a poor trade.
// Everything here is the small subset that testing the canvas actually needs.
//
// Usage: see ./probe-template.mjs, and ../SKILL.md for the recipes.

import { spawn } from "node:child_process";

/**
 * Launch the app under an isolated profile with a debugging port open.
 *
 * `appDir` must be the app root (the dir holding package.json + out/), NOT out/main/index.js —
 * electron resolves the entry from package.json `main`.
 */
export function launch({ appDir, electron, port, userDataDir, extraArgs = [], env }) {
  const child = spawn(
    electron,
    [appDir, `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, ...extraArgs],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } },
  );
  // Kept so a failing probe can print what the main process said. Electron is chatty on stderr
  // even in a healthy run, so this is diagnostic output, not a failure signal.
  const logs = [];
  child.stdout.on("data", (d) => logs.push(["out", d.toString()]));
  child.stderr.on("data", (d) => logs.push(["err", d.toString()]));
  return { child, logs };
}

/** Poll the debugging endpoint until the renderer's page target exists. */
export async function waitForTarget(port, { timeoutMs = 30000, match = () => true } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "never responded";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl && match(t));
      if (page) return page;
      lastErr = `no matching page target among ${targets.length}`;
    } catch (e) {
      lastErr = e.message;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for a page target on ${port}: ${lastErr}`);
}

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      } else {
        for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params);
      }
    });
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  /**
   * Evaluate an async function body in the page and return its JSON value.
   *
   * The body is wrapped in `(async () => { ... })()`, so write `return ...` — and `await` works,
   * which is what makes `window.maestro.*` reachable from a probe.
   */
  async eval(body) {
    const r = await this.send("Runtime.evaluate", {
      expression: `(async () => { ${body} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(
        "page threw: " +
          (r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)),
      );
    }
    return r.result.value;
  }

  /** Poll an expression until it is truthy. Returns its value. */
  async waitFor(expr, { timeoutMs = 15000, label = expr } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      last = await this.eval(`return (${expr});`);
      if (last) return last;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`waitFor timed out: ${label} (last=${JSON.stringify(last)})`);
  }

  /** Collect console errors and uncaught exceptions for the life of the session. */
  watchErrors() {
    const errors = [];
    this.on("Runtime.consoleAPICalled", (p) => {
      if (p.type === "error")
        errors.push(p.args.map((a) => a.value ?? a.description).join(" "));
    });
    this.on("Runtime.exceptionThrown", (p) =>
      errors.push(
        "EXCEPTION: " +
          (p.exceptionDetails?.exception?.description ?? JSON.stringify(p.exceptionDetails)),
      ),
    );
    return errors;
  }

  // ── Input ────────────────────────────────────────────────────────────────
  //
  // React Flow tracks pointer state across events; a synthesised `click()` on a node does not
  // move it. Press → several moves → release is the minimum that produces a real drag.

  async drag(from, to, { steps = 12, settleMs = 16 } = {}) {
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed", x: from.x, y: from.y, button: "left", clickCount: 1, buttons: 1,
    });
    for (let i = 1; i <= steps; i++) {
      await this.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: from.x + ((to.x - from.x) * i) / steps,
        y: from.y + ((to.y - from.y) * i) / steps,
        button: "left",
        buttons: 1,
      });
      await new Promise((r) => setTimeout(r, settleMs));
    }
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: to.x, y: to.y, button: "left", clickCount: 1, buttons: 0,
    });
  }

  async click(x, y) {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
    await this.send("Input.dispatchMouseEvent", {
      type: "mousePressed", x, y, button: "left", clickCount: 1, buttons: 1,
    });
    await this.send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x, y, button: "left", clickCount: 1, buttons: 0,
    });
  }

  /**
   * Real click at the centre of whatever `selectorFn` returns (a JS body returning an Element).
   *
   * Verifies the element is on screen and is the topmost thing at those coordinates, and throws
   * loudly if not — a real click into empty space does nothing at all, and without this check the
   * probe fails much later, timing out on a toast that was never coming.
   *
   * **Do not enable `scrollIntoView` for anything inside the React Flow pane.** Measured: calling
   * it on an edge-label button moves the reported rect from (1090,520) to (908,416), and both
   * `getBoundingClientRect` and `elementFromPoint` agree on the new coordinates — while a real
   * mouse click there does nothing, because input hit-testing does not honour the scroll that
   * `scrollIntoView` performed on the pane's `overflow: hidden` container. Everything looks
   * consistent and the click silently misses. For an off-screen button in an ordinary scroll
   * container (the left pane), prefer `jsClick()`.
   */
  async clickElement(selectorFn, { dx = 0, dy = 0, scrollIntoView = false } = {}) {
    const box = await this.eval(`
      const el = (() => { ${selectorFn} })();
      if (!el) return null;
      ${scrollIntoView ? 'el.scrollIntoView({ block: "center", inline: "center" });' : ""}
      const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2 + ${dx}, y = r.y + r.height / 2 + ${dy};
      const top = document.elementFromPoint(x, y);
      return {
        x, y,
        inViewport: r.y >= 0 && r.y + r.height <= window.innerHeight &&
                    r.x >= 0 && r.x + r.width <= window.innerWidth,
        // Deliberately strict: the topmost element must BE the target or sit inside it. Accepting
        // an ancestor instead would happily "click" the wrapper that covers a small button — on
        // the canvas that means starting an edge-label drag instead of opening its editor.
        hit: !!top && (top === el || el.contains(top)),
        topEl: top ? top.tagName + "." + String(top.className).slice(0, 60) : null,
      };
    `);
    if (!box) throw new Error("clickElement: selector matched nothing");
    if (!box.inViewport || !box.hit) {
      throw new Error(
        `clickElement: target is not clickable at (${Math.round(box.x)}, ${Math.round(box.y)}) — ` +
          `inViewport=${box.inViewport}, topElement=${box.topEl}. ` +
          `It is off screen or covered. Use jsClick() if pointer semantics do not matter here.`,
      );
    }
    await this.click(Math.round(box.x), Math.round(box.y));
    return box;
  }

  /**
   * Synthetic `.click()` on the first match of a JS selector body.
   *
   * Correct for plain buttons, where React only listens for `click` — and it works regardless of
   * scroll position or occlusion. NOT a substitute for `drag()`: React Flow tracks pointer state
   * across pointerdown/move/up, so a synthetic click never moves a node.
   */
  async jsClick(selectorFn) {
    const ok = await this.eval(`
      const el = (() => { ${selectorFn} })();
      if (!el) return false;
      el.click();
      return true;
    `);
    if (!ok) throw new Error("jsClick: selector matched nothing");
    return ok;
  }

  async typeText(text) {
    for (const ch of text) {
      await this.send("Input.dispatchKeyEvent", { type: "keyDown", text: ch });
      await this.send("Input.dispatchKeyEvent", { type: "keyUp", text: ch });
    }
  }

  /**
   * Set a controlled React input/textarea's value.
   *
   * Assigning `.value` directly does not notify React — it overwrites the DOM node's value
   * without going through the property setter React patched, so the next render restores the old
   * value. Call the prototype's native setter, then dispatch a bubbling `input` event.
   */
  async setInputValue(selector, value) {
    return this.eval(`
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
      Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    `);
  }

  // ── Measurement ──────────────────────────────────────────────────────────

  /**
   * Install a per-animation-frame sampler that runs BEFORE any page script.
   *
   * This is the tool for first-paint questions — "did React Flow ever measure a zero-size
   * container?" — because it is the only way to observe frames that precede React mounting.
   * Must be followed by a reload (or called before the first load) to take effect.
   * Read the result from `window.__samples`.
   */
  async installFrameSampler({ extra = "" } = {}) {
    await this.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        window.__samples = [];
        (function tick() {
          try {
            const el = document.querySelector(".react-flow");
            const vp = document.querySelector(".react-flow__viewport");
            if (el) {
              const r = el.getBoundingClientRect();
              window.__samples.push({
                t: performance.now(),
                cw: Math.round(r.width), ch: Math.round(r.height),
                vt: vp ? vp.style.transform : null,
                n: [...document.querySelectorAll(".react-flow__node")].map(n => ({
                  id: n.getAttribute("data-id"), t: n.style.transform,
                  w: n.offsetWidth, h: n.offsetHeight,
                })),
                ${extra}
              });
            }
          } catch (e) { /* keep sampling */ }
          requestAnimationFrame(tick);
        })();
      `,
    });
  }

  /**
   * Drag a canvas node by (dx, dy) and confirm it actually moved.
   *
   * Picks the grab point itself rather than taking one on faith: it scans candidate points inside
   * the node and takes the first whose topmost element is neither a React Flow handle nor a
   * button. Grabbing a handle starts an *edge connection* instead of a move, and grabbing one of
   * the node's own `+` / `⋮` buttons does nothing — both leave the node exactly where it was, and
   * a probe that doesn't check will happily report success while testing nothing.
   *
   * Throws if the node did not move. Returns the before/after transforms.
   */
  async dragNode(id, dx, dy, { steps = 12 } = {}) {
    const sel = JSON.stringify(`.react-flow__node[data-id="${id}"]`);
    const found = await this.eval(`
      const n = document.querySelector(${sel});
      if (!n) return null;
      const r = n.getBoundingClientRect();
      const candidates = [
        [r.x + r.width * 0.5,  r.y + r.height * 0.5 ],
        [r.x + r.width * 0.3,  r.y + r.height * 0.35],
        [r.x + r.width * 0.5,  r.y + 8              ],
        [r.x + r.width * 0.7,  r.y + r.height * 0.65],
        [r.x + 14,             r.y + r.height * 0.5 ],
      ];
      for (const [x, y] of candidates) {
        const e = document.elementFromPoint(x, y);
        if (!e || !n.contains(e)) continue;
        if (e.closest(".react-flow__handle") || e.closest("button")) continue;
        return { x, y, transform: n.style.transform };
      }
      return { x: null, y: null, transform: n.style.transform };
    `);
    if (!found) throw new Error(`dragNode: no node with data-id="${id}"`);
    if (found.x === null)
      throw new Error(`dragNode: every candidate grab point on "${id}" was a handle or a button`);

    await this.drag(
      { x: Math.round(found.x), y: Math.round(found.y) },
      { x: Math.round(found.x + dx), y: Math.round(found.y + dy) },
      { steps },
    );
    await new Promise((r) => setTimeout(r, 400));
    const after = await this.eval(`return document.querySelector(${sel}).style.transform;`);
    if (after === found.transform) {
      throw new Error(
        `dragNode: "${id}" did not move (still ${after}). The press landed on something that ` +
          `swallowed it, or React Flow is in a non-interactive state.`,
      );
    }
    return { before: found.transform, after, grabbedAt: { x: found.x, y: found.y } };
  }

  /**
   * Reduce `window.__samples` to a summary **in the page**.
   *
   * Never return the raw array: a few seconds of sampling is hundreds of frames each holding a
   * node list, and `Runtime.evaluate` with `returnByValue` fails to serialise a payload that
   * size — silently, handing back `undefined`. A probe that then writes `window.__samples || []`
   * gets an empty array and every `.every()` assertion over it passes vacuously.
   */
  sampleSummary() {
    return this.eval(`
      const s = window.__samples || [];
      const withNodes = s.filter(f => f.n.length > 0);
      const first = withNodes[0] || null;
      return {
        frames: s.length,
        framesWithNodes: withNodes.length,
        zeroSizeContainerFrames: s.filter(f => f.cw === 0 || f.ch === 0).length,
        zeroSizeNodeFrames: withNodes.filter(f => f.n.some(n => n.w === 0 || n.h === 0)).length,
        stackedFrames: withNodes.filter(f => f.n.length > 1 && new Set(f.n.map(n => n.t)).size === 1).length,
        firstFrameWithNodes: first ? { cw: first.cw, ch: first.ch, nodes: first.n.length, t: first.t } : null,
        distinctViewportTransforms: new Set(s.map(f => f.vt)).size,
        settledViewportTransform: s.length ? s[s.length - 1].vt : null,
      };
    `);
  }

  /** Canvas geometry: node positions in flow space, screen rects, and the viewport transform. */
  geometry() {
    return this.eval(`
      const parse = t => {
        const m = /translate\\(([-\\d.]+)px,\\s*([-\\d.]+)px\\)/.exec(t || "");
        return m ? { x: +m[1], y: +m[2] } : null;
      };
      const c = document.querySelector(".react-flow");
      if (!c) return null;
      const cr = c.getBoundingClientRect();
      return {
        cont: { x: cr.x, y: cr.y, w: cr.width, h: cr.height },
        vt: document.querySelector(".react-flow__viewport")?.style.transform ?? null,
        nodes: [...document.querySelectorAll(".react-flow__node")].map(n => {
          const p = parse(n.style.transform);
          const r = n.getBoundingClientRect();
          return { id: n.getAttribute("data-id"), x: p?.x, y: p?.y,
                   w: n.offsetWidth, h: n.offsetHeight,
                   sx: r.x, sy: r.y, sw: r.width, sh: r.height };
        }),
      };
    `);
  }
}

/** Axis-aligned overlap test, for asserting a layout does not stack nodes. */
export function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Open a project and land on a route, without the native folder dialog.
 *
 * `window.maestro.project.open` is on the preload bridge, so a probe can switch projects freely.
 * Routing is HASH history (a packaged build loads over file://), so navigation is a hash write.
 */
export async function openProjectAt(cdp, projectRoot, route = "#/workflows") {
  await cdp.eval(`return await window.maestro.project.open(${JSON.stringify(projectRoot)});`);
  await cdp.eval(`window.location.hash = ${JSON.stringify(route)}; return true;`);
}

/** Run `fn` against a freshly launched window, always tearing the process down afterwards. */
export async function withApp({ appDir, electron, port, userDataDir, sampler = false }, fn) {
  const { child, logs } = await launch({ appDir, electron, port, userDataDir });
  try {
    const target = await waitForTarget(port);
    const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    const errors = cdp.watchErrors();
    if (sampler) {
      await cdp.installFrameSampler();
      await cdp.send("Page.reload");
    }
    await cdp.waitFor(`document.readyState === "complete"`);
    return await fn(cdp, { errors, logs });
  } finally {
    child.kill("SIGTERM");
    // Give the port time to free up before the next launch in the same run.
    await new Promise((r) => setTimeout(r, 700));
  }
}
