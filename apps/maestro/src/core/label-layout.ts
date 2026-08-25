// Where a seeded condition-edge label sits.
//
// A condition edge's label defaults to the midpoint of its bezier. For the condition edges the
// seed generates — every one of them leaves a node's *right* handle and arrives at another node's
// *top* handle — that midpoint is routinely inside a node: the route back up the column from
// @reviewer lands on the implementation node, and @refactor's routes land on @refactor itself.
// Measured on the starter config in a rendered window: 15 label/node overlaps across the three
// seeded workflows that have condition edges.
//
// The canvas already honours a per-edge `label_offset` and lets the user drag a label anywhere,
// so the fix is to seed an offset that puts the label in a node-free vertical lane. A seeded
// offset is only a starting position: it is written to `maestro.json` like any other, and a drag
// overwrites it.
//
// The numbers below are the canvas's real render metrics, measured in a window rather than read
// off the Tailwind classes — see `.claude/skills/test-maestro-desktop`.
//
// One asymmetry shapes the whole design. A node's **x** extent is exact: the cards are fixed
// widths and the seed chooses the columns. Its **height** is not knowable here — skill chips wrap
// by text width, so five nodes carrying 1–4 skills measured 78, 78, 103, 129 and 129px tall
// against a "50 + 30 per skill" model's 80/110/110/170/170. So a label is positioned by *x*, into
// a vertical lane that has no node in it at any height, and the height model only has to be good
// enough to keep two labels off each other. Node clearance never depends on it.

import type { MaestroEdgeV3, MaestroNodeV3, MaestroWorkflowV3 } from "./types.js";

// ── Render metrics ──────────────────────────────────────────────────────────────────────────

/** Agent and skill cards (`w-44`); measured height with no skill chips is 49. */
const NODE_W = 176;
const NODE_H = 50;
/** The human-review card is narrower and taller. */
const HUMAN_W = 120;
const HUMAN_H = 60;
/**
 * Per attached skill chip. `seed.ts` reserves 30px of *vertical rhythm* each, deliberately
 * generous; a chip row actually measured ~25px, and chips often share a row. This is the closer
 * estimate of the two, because here it is a height, not a gap.
 */
const SKILL_CHIP_H = 25;
/** `main-session` is synthesized by the canvas at the origin; it is not in `workflow.nodes`. */
const MAIN_BOX: Box = { x: 0, y: 0, w: 192, h: 38 };

/**
 * The label chip's reserved footprint: a `max-w-[140px]` span, a 4px gap and the 16px ✎ button.
 * Short labels render narrower and sit inside this box, so reserving the maximum is safe.
 */
const LABEL_W = 160;
const LABEL_H = 22;

/** Clear space demanded on each side of a label inside its lane. */
const LANE_MARGIN = 12;
/**
 * Vertical padding added to a node when asking "is this label clear of it?".
 *
 * Covers the height model's error (measured worst case above: 22px) so a label only keeps the
 * canvas's default position when it is clear by a margin the model cannot be wrong about. A
 * label that is merely *nearly* clear moves into a lane, where its height is irrelevant.
 */
const NODE_SLACK_Y = 30;
/** Vertical pitch when two labels want the same spot — 18px of daylight between chips. */
const STACK_STEP = 40;
/** Padding on a label when testing it against another label, for the same reason as NODE_SLACK_Y. */
const LABEL_SLACK_Y = 10;
/** How far up and down the lane to look for a free slot before giving up. */
const STACK_TRIES = 8;
/** Seeded offsets are rounded to this, so `maestro.json` reads as chosen values, not measurements. */
const OFFSET_GRID = 10;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Point {
  x: number;
  y: number;
}

/** Number of skills attached to a seeded instance — nodes grow taller with each one. */
type SkillCount = (instanceName: string) => number;

// ── Geometry ────────────────────────────────────────────────────────────────────────────────

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The same box with `pad` of extra room above and below. */
function padY(b: Box, pad: number): Box {
  return { x: b.x, y: b.y - pad, w: b.w, h: b.h + 2 * pad };
}

function nodeBox(n: MaestroNodeV3, skillCount: SkillCount): Box {
  const { x, y } = n.position ?? { x: 0, y: 0 };
  if (n.type === "human_review") return { x, y, w: HUMAN_W, h: HUMAN_H };
  const skills = n.type === "agent" ? skillCount(n.instance ?? n.id) : 0;
  return { x, y, w: NODE_W, h: NODE_H + skills * SKILL_CHIP_H };
}

/** The point a handle attaches to. Sides match React Flow's `Position`. */
function handlePoint(b: Box, side: string | undefined): Point {
  switch (side) {
    case "left":
      return { x: b.x, y: b.y + b.h / 2 };
    case "top":
      return { x: b.x + b.w / 2, y: b.y };
    case "bottom":
      return { x: b.x + b.w / 2, y: b.y + b.h };
    default: // "right"
      return { x: b.x + b.w, y: b.y + b.h / 2 };
  }
}

/**
 * Where React Flow puts an edge label: the cubic bezier's point at t=0.5.
 *
 * Mirrors `getBezierPath` — control points are pushed out along the handle's own axis by
 * `0.5 × distance` when the target lies that way, and by `curvature × 25 × √distance` when it
 * lies behind (which is what makes a back-route up the column bulge sideways before it turns).
 * Verified against a rendered window: this agrees with the drawn label position to within 2px.
 */
const CURVATURE = 0.25;

function controlOffset(distance: number): number {
  return distance >= 0 ? 0.5 * distance : CURVATURE * 25 * Math.sqrt(-distance);
}

function control(p: Point, side: string | undefined, other: Point): Point {
  switch (side) {
    case "left":
      return { x: p.x - controlOffset(p.x - other.x), y: p.y };
    case "top":
      return { x: p.x, y: p.y - controlOffset(p.y - other.y) };
    case "bottom":
      return { x: p.x, y: p.y + controlOffset(other.y - p.y) };
    default: // "right"
      return { x: p.x + controlOffset(other.x - p.x), y: p.y };
  }
}

function bezierLabelAnchor(source: Box, target: Box, sourceHandle?: string, targetHandle?: string): Point {
  const s = handlePoint(source, sourceHandle ?? "right");
  const t = handlePoint(target, targetHandle ?? "top");
  const sc = control(s, sourceHandle ?? "right", t);
  const tc = control(t, targetHandle ?? "top", s);
  // Cubic bezier at t=0.5: (P0 + 3·C1 + 3·C2 + P3) / 8.
  return {
    x: 0.125 * s.x + 0.375 * sc.x + 0.375 * tc.x + 0.125 * t.x,
    y: 0.125 * s.y + 0.375 * sc.y + 0.375 * tc.y + 0.125 * t.y,
  };
}

// ── Lanes ───────────────────────────────────────────────────────────────────────────────────

/**
 * The node-free vertical corridors of a seeded layout: the gaps between the node columns, plus
 * the open space to the right of the last one and to the left of the first. A lane is described
 * by where it starts, where it ends, and where a label centred in it goes.
 *
 * The left-of-everything lane exists because `seed.ts` no longer routes every condition edge's
 * exit off the right side of its source — a back-route within one column now alternates left and
 * right so it doesn't pile every bulge (and then every label) into the same corridor. A label
 * whose edge exits left needs a lane of its own to land in, on the same side as its curve, rather
 * than being pushed across the node it was trying to clear.
 *
 * `main-session` is deliberately not counted here. It is 16px wider than the agent cards and
 * sits alone above the column, so letting it define the first lane would narrow a 184px gutter
 * for a node no condition label goes near — and every candidate position is still tested against
 * its box, so nothing can land on it.
 */
function freeLanes(boxes: Box[]): { start: number; end: number; center: number }[] {
  const spans = boxes.map((b) => ({ from: b.x, to: b.x + b.w })).sort((a, b) => a.from - b.from);
  const lanes: { start: number; end: number; center: number }[] = [];
  const leftMost = spans.length > 0 ? spans[0].from : 0;
  // The open lane before the leftmost node — the mirror of the one added below for the right.
  lanes.push({
    start: leftMost - LANE_MARGIN - LABEL_W,
    end: leftMost,
    center: leftMost - LANE_MARGIN - LABEL_W / 2,
  });
  let edge = spans.length > 0 ? spans[0].to : 0;
  for (const s of spans) {
    if (s.from - edge >= LABEL_W + 2 * LANE_MARGIN) {
      lanes.push({ start: edge, end: s.from, center: (edge + s.from) / 2 });
    }
    edge = Math.max(edge, s.to);
  }
  // The open lane past the rightmost node — always wide enough.
  lanes.push({ start: edge, end: Infinity, center: edge + LANE_MARGIN + LABEL_W / 2 });
  return lanes;
}

function labelBox(at: Point): Box {
  return { x: at.x - LABEL_W / 2, y: at.y - LABEL_H / 2, w: LABEL_W, h: LABEL_H };
}

function roundToGrid(v: number): number {
  // `+ 0` normalises the -0 that Math.round hands back for a small negative, which would
  // otherwise be written to maestro.json as an odd-looking `-0`.
  return Math.round(v / OFFSET_GRID) * OFFSET_GRID + 0;
}

// ── Placement ───────────────────────────────────────────────────────────────────────────────

/**
 * Give every seeded condition-edge label a position clear of the nodes.
 *
 * A label that already sits well clear of every node keeps the canvas default and is written with
 * no `label_offset` at all. Any other moves into the nearest node-free lane that begins at or
 * after its source node's right edge — the side every condition edge leaves from, so the label
 * stays on the outbound side of its own curve — and stacks vertically against labels already
 * placed there. The resulting offset is rounded to a multiple of 10.
 *
 * "Well clear" is judged with `NODE_SLACK_Y`, so a label whose clearance depends on the height
 * model being right is moved into a lane instead, where the height model cannot matter.
 */
export function placeConditionLabels(workflow: MaestroWorkflowV3, skillCount: SkillCount = () => 0): MaestroWorkflowV3 {
  const boxes = new Map<string, Box>(workflow.nodes.map((n) => [n.id, nodeBox(n, skillCount)]));
  const obstacles = [MAIN_BOX, ...boxes.values()];
  const lanes = freeLanes([...boxes.values()]);
  const placed: Box[] = [];

  const clear = (box: Box): boolean =>
    !obstacles.some((o) => overlaps(box, padY(o, NODE_SLACK_Y))) &&
    !placed.some((p) => overlaps(box, padY(p, LABEL_SLACK_Y)));

  const edges = workflow.edges.map((e): MaestroEdgeV3 => {
    if (e.kind !== "condition" || !e.label) return e;
    const source = boxes.get(e.from);
    const target = boxes.get(e.to);
    if (!source || !target) return e;

    const anchor = bezierLabelAnchor(source, target, e.sourceHandle, e.targetHandle);
    if (clear(labelBox(anchor))) {
      placed.push(labelBox(anchor));
      return e;
    }

    // Land on the same side the edge actually exits from — the whole point of a left lane is
    // that a left-exiting edge's label doesn't have to cross back over its own source node to
    // reach it.
    const exitsLeft = (e.sourceHandle ?? "right") === "left";
    const sourceRight = source.x + source.w;
    const sourceLeft = source.x;
    const candidates = exitsLeft ? lanes.filter((l) => l.end <= sourceLeft) : lanes.filter((l) => l.start >= sourceRight);
    const lane =
      candidates.sort((a, b) => Math.abs(a.center - anchor.x) - Math.abs(b.center - anchor.x))[0] ??
      (exitsLeft ? lanes[0] : lanes[lanes.length - 1]);

    // Walk outwards from the anchor's own height so the label stays beside its curve.
    let offset = { x: roundToGrid(lane.center - anchor.x), y: 0 };
    for (let i = 0; i <= STACK_TRIES; i++) {
      for (const dy of i === 0 ? [0] : [i * STACK_STEP, -i * STACK_STEP]) {
        const candidate = { x: roundToGrid(lane.center - anchor.x), y: roundToGrid(dy) };
        const box = labelBox({ x: anchor.x + candidate.x, y: anchor.y + candidate.y });
        if (clear(box)) {
          placed.push(box);
          return { ...e, label_offset: candidate };
        }
        offset = candidate;
      }
    }
    placed.push(labelBox({ x: anchor.x + offset.x, y: anchor.y + offset.y }));
    return { ...e, label_offset: offset };
  });

  return { ...workflow, edges };
}
