// Differential harness: check a reimplementation of React Flow's edge-label anchor against the
// real `getBezierPath`, over a grid of geometries and every handle-side combination.
//
//   node .claude/skills/react-flow-canvas-geometry/scripts/check-bezier-model.mjs
//
// Run it as-is to see the reference model pass. To check YOUR model, replace `model()` below with
// a call into your own code and re-run.
//
// The second half of the report is the point of the exercise: it counts how many grid cases a
// DELIBERATELY WRONG model still agrees with the library on. Bezier control offsets have two
// branches — `0.5 · d` and `0.25 · 25 · √d` — which cross near d ≈ 156 and stay within a few px of
// each other over a wide band around it. A wrong model is therefore *correct* on a typical
// node-to-node spacing, and a couple of spot checks will not tell you apart from it.

import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = new URL("../../../..", import.meta.url).pathname.replace(/\/$/, "");

// ── Locate the real implementation ──────────────────────────────────────────────────────────
// @xyflow/system is a transitive dep of @xyflow/react, so it is not linked into any app's
// node_modules under pnpm's strict layout. Find it in the store instead.
function findSystemDist() {
  const store = join(REPO, "node_modules/.pnpm");
  if (!existsSync(store)) throw new Error(`no pnpm store at ${store}`);
  const dir = readdirSync(store).find((d) => d.startsWith("@xyflow+system@"));
  if (!dir) throw new Error("@xyflow/system not found in the pnpm store");
  const dist = join(store, dir, "node_modules/@xyflow/system/dist/esm/index.js");
  if (!existsSync(dist)) throw new Error(`found ${dir} but no esm build at ${dist}`);
  return dist;
}

const dist = findSystemDist();
const { getBezierPath, Position } = await import(pathToFileURL(dist).href);
console.log(`checking against ${dist.replace(REPO + "/", "")}\n`);

// ── The model under test ────────────────────────────────────────────────────────────────────
// This mirrors apps/maestro/src/core/label-layout.ts. Swap in your own to check it.

const CURVATURE = 0.25;

// `flip: true` is the classic mistake — passing the distance the other way round, which silently
// swaps which branch runs. Used below to show how often the mistake goes unnoticed.
function controlOffset(distance, curvature = CURVATURE) {
  return distance >= 0 ? 0.5 * distance : curvature * 25 * Math.sqrt(-distance);
}

function control(p, side, other, flip) {
  // Note the argument order: the distance is always measured from the point that OWNS the handle
  // to the other endpoint (`getControlWithCurvature` is called with x1/y1 = own, x2/y2 = other).
  const d = (own, o) => (flip ? own - o : o - own);
  switch (side) {
    case "left":
      return { x: p.x - controlOffset(-d(p.x, other.x)), y: p.y };
    case "right":
      return { x: p.x + controlOffset(d(p.x, other.x)), y: p.y };
    case "top":
      return { x: p.x, y: p.y - controlOffset(-d(p.y, other.y)) };
    case "bottom":
      return { x: p.x, y: p.y + controlOffset(d(p.y, other.y)) };
  }
}

function model({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition }, flip = false) {
  const s = { x: sourceX, y: sourceY };
  const t = { x: targetX, y: targetY };
  const sc = control(s, sourcePosition, t, flip);
  const tc = control(t, targetPosition, s, flip);
  // Cubic bezier at t=0.5: (P0 + 3·C1 + 3·C2 + P3) / 8 — this is what getBezierEdgeCenter returns.
  return {
    x: 0.125 * s.x + 0.375 * sc.x + 0.375 * tc.x + 0.125 * t.x,
    y: 0.125 * s.y + 0.375 * sc.y + 0.375 * tc.y + 0.125 * t.y,
  };
}

// ── The grid ────────────────────────────────────────────────────────────────────────────────

const SIDES = ["left", "right", "top", "bottom"];
const POS = { left: Position.Left, right: Position.Right, top: Position.Top, bottom: Position.Bottom };
const SPREAD = [-900, -600, -400, -260, -180, -120, -60, -20, 0, 20, 60, 120, 180, 260, 400, 600, 900];

const cases = [];
for (const sourcePosition of SIDES)
  for (const targetPosition of SIDES)
    for (const dx of SPREAD)
      for (const dy of SPREAD)
        cases.push({ sourceX: 0, sourceY: 0, targetX: dx, targetY: dy, sourcePosition, targetPosition });

// ── Compare ─────────────────────────────────────────────────────────────────────────────────

const TOLERANCE = 0.001; // a reimplementation should be exact, not close
const SPOT_CHECK_EYE = 3; // px — what "it matched when I checked it by hand" actually means

let worst = { err: -1 };
let failures = 0;
let flipAgrees = 0;

for (const c of cases) {
  const [, labelX, labelY] = getBezierPath({ ...c, sourcePosition: POS[c.sourcePosition], targetPosition: POS[c.targetPosition] });
  const m = model(c);
  const err = Math.max(Math.abs(m.x - labelX), Math.abs(m.y - labelY));
  if (err > TOLERANCE) failures++;
  if (err > worst.err) worst = { err, c, expected: { x: labelX, y: labelY }, got: m };

  const f = model(c, true);
  if (Math.max(Math.abs(f.x - labelX), Math.abs(f.y - labelY)) <= SPOT_CHECK_EYE) flipAgrees++;
}

console.log(`grid: ${cases.length} cases (${SIDES.length}² handle pairs × ${SPREAD.length}² offsets)`);
console.log(`model disagreements over ${TOLERANCE}px: ${failures}`);
console.log(
  `worst error: ${worst.err.toExponential(2)}px` +
    (worst.err > TOLERANCE
      ? `\n  at ${JSON.stringify(worst.c)}\n  expected ${JSON.stringify(worst.expected)}\n  got      ${JSON.stringify(worst.got)}`
      : ""),
);

const pct = ((flipAgrees / cases.length) * 100).toFixed(1);
console.log(
  `\nHOW A WRONG MODEL HIDES:\n` +
    `  a sign-flipped model still lands within ${SPOT_CHECK_EYE}px of the library in ` +
    `${flipAgrees}/${cases.length} cases (${pct}%).\n` +
    `  Spot-checking two or three labels in a window cannot distinguish the two. Run the grid.`,
);

process.exitCode = failures ? 1 : 0;
