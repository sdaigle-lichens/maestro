// The seeded starter config must open with every condition-edge label clear of the nodes.
//
// This is the analytic half of the check — it re-uses the same box model `label-layout.ts` places
// against, so on its own it only proves the placement is self-consistent. The model itself was
// calibrated against a rendered Electron window, and the fix was verified there; see
// `.claude/skills/test-maestro-desktop` and the notes in `label-layout.ts`.

import { describe, it, expect } from "vitest";

import { defaultV3Config, buildWorkflow, buildTestsWorkflow } from "../../src/core/seed.js";
import type { MaestroWorkflowV3 } from "../../src/core/types.js";

// Mirrors the render metrics in label-layout.ts. Kept as a separate copy on purpose: if the two
// drift, that is a real signal about the canvas, not a refactor to DRY away.
const NODE_W = 176;
const HUMAN_W = 120;
const HUMAN_H = 60;
const LABEL_W = 160;
const LABEL_H = 22;
const MAIN_BOX = { x: 0, y: 0, w: 192, h: 38 };

/**
 * How tall an agent card renders for a given skill count. Skill chips wrap by text width, so this
 * is genuinely uncertain — the placement has to hold across the whole plausible range, not just
 * at the value `label-layout.ts` assumes. Measured in a window: 49px bare, and 78 / 78 / 103 /
 * 129 / 129 for nodes carrying 1 / 2 / 2 / 3 / 4 skills.
 */
const HEIGHT_MODELS: Record<string, (skills: number) => number> = {
  "as modelled (50 + 25/skill)": (s) => 50 + 25 * s,
  "one chip row per skill (49 + 29 + 25/extra)": (s) => (s === 0 ? 49 : 49 + 29 + 25 * (s - 1)),
  "all chips on one row (49 + 29)": (s) => (s === 0 ? 49 : 78),
  "seed's own rhythm (50 + 30/skill)": (s) => 50 + 30 * s,
};

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Skills = (name: string) => number;
type Height = (skills: number) => number;

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function nodeBoxes(wf: MaestroWorkflowV3, skills: Skills, height: Height): Map<string, Box> {
  return new Map(
    wf.nodes.map((n) => {
      const { x, y } = n.position ?? { x: 0, y: 0 };
      if (n.type === "human_review") return [n.id, { x, y, w: HUMAN_W, h: HUMAN_H }] as const;
      const s = n.type === "agent" ? skills(n.instance ?? n.id) : 0;
      return [n.id, { x, y, w: NODE_W, h: height(s) }] as const;
    })
  );
}

// The rendered label position: the bezier midpoint plus whatever offset the seed wrote.
// Duplicates the curve maths for the same reason as the metrics above — an independent check.
function labelBoxes(wf: MaestroWorkflowV3, skills: Skills, height: Height): { label: string; box: Box }[] {
  const boxes = nodeBoxes(wf, skills, height);
  const ctrl = (d: number): number => (d >= 0 ? 0.5 * d : 0.25 * 25 * Math.sqrt(-d));
  const out: { label: string; box: Box }[] = [];
  for (const e of wf.edges) {
    if (e.kind !== "condition" || !e.label) continue;
    const s = boxes.get(e.from);
    const t = boxes.get(e.to);
    if (!s || !t) continue;
    // Every seeded condition edge exits left or right and arrives at the top handle. Which side
    // it exits from now varies deliberately — see the `sideTracker` note in seed.ts — so this
    // computes the curve for whichever side this edge actually got, rather than assuming "right".
    const side = e.sourceHandle ?? "right";
    expect(["left", "right"]).toContain(side);
    expect(e.targetHandle).toBe("top");
    const sp = side === "left" ? { x: s.x, y: s.y + s.h / 2 } : { x: s.x + s.w, y: s.y + s.h / 2 };
    const tp = { x: t.x + t.w / 2, y: t.y };
    const sc = side === "left" ? { x: sp.x - ctrl(sp.x - tp.x), y: sp.y } : { x: sp.x + ctrl(tp.x - sp.x), y: sp.y };
    const tc = { x: tp.x, y: tp.y - ctrl(tp.y - sp.y) };
    const cx = 0.125 * sp.x + 0.375 * sc.x + 0.375 * tc.x + 0.125 * tp.x + (e.label_offset?.x ?? 0);
    const cy = 0.125 * sp.y + 0.375 * sc.y + 0.375 * tc.y + 0.125 * tp.y + (e.label_offset?.y ?? 0);
    out.push({ label: e.label, box: { x: cx - LABEL_W / 2, y: cy - LABEL_H / 2, w: LABEL_W, h: LABEL_H } });
  }
  return out;
}

function collisions(wf: MaestroWorkflowV3, skills: Skills, height: Height): string[] {
  const nodes = [...nodeBoxes(wf, skills, height).entries()].map(([id, box]) => ({ id, box }));
  const labels = labelBoxes(wf, skills, height);
  const bad: string[] = [];
  for (const l of labels) {
    if (overlaps(l.box, MAIN_BOX)) bad.push(`"${l.label}" over main-session`);
    for (const n of nodes) if (overlaps(l.box, n.box)) bad.push(`"${l.label}" over node ${n.id}`);
  }
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++)
      if (overlaps(labels[i].box, labels[j].box)) bad.push(`"${labels[i].label}" over "${labels[j].label}"`);
  return bad;
}

const SKILL_HEAVY = {
  backend: ["tdd", "domain-modeling", "codebase-design", "diagnosing-bugs"],
  test: ["tdd", "diagnosing-bugs"],
  reviewer: ["codebase-design", "simplify", "domain-modeling"],
  refactor: ["simplify", "codebase-design"],
  scribe: ["domain-modeling"],
};

// Every variant is checked under every plausible node height, because the placement's whole claim
// is that node clearance does not depend on getting the height right.
function expectAllClear(cfg: { workflows: MaestroWorkflowV3[] }, skills: Skills = () => 0): void {
  for (const [model, height] of Object.entries(HEIGHT_MODELS)) {
    for (const wf of cfg.workflows) {
      expect({ model, workflow: wf.name, bad: collisions(wf, skills, height) }).toEqual({
        model,
        workflow: wf.name,
        bad: [],
      });
    }
  }
}

describe("seeded condition-edge labels", () => {
  it("clear every node in every workflow of the starter config", () => {
    expectAllClear(defaultV3Config(["backend"]));
  });

  it("clear every node for a multi-agent implementation chain", () => {
    expectAllClear(defaultV3Config(["backend", "frontend"]));
  });

  it("clear every node when instances carry enough skills to make the cards tall", () => {
    const skills = (name: string): number => (SKILL_HEAVY[name as keyof typeof SKILL_HEAVY] ?? []).length;
    expectAllClear(defaultV3Config(["backend"], SKILL_HEAVY), skills);
    expectAllClear(defaultV3Config(["backend", "frontend"], SKILL_HEAVY), skills);
  });

  it("write offsets that read as deliberate values, only where one is needed", () => {
    const cfg = defaultV3Config(["backend"]);
    const offsets = cfg.workflows
      .flatMap((w) => w.edges)
      .map((e) => e.label_offset)
      .filter((o): o is { x: number; y: number } => !!o);
    expect(offsets.length).toBeGreaterThan(0);
    for (const o of offsets) {
      expect(Number.isInteger(o.x / 10)).toBe(true);
      expect(Number.isInteger(o.y / 10)).toBe(true);
      expect(Object.is(o.x, -0)).toBe(false);
      expect(Object.is(o.y, -0)).toBe(false);
    }
    // Not every label needs moving; the ones already in open space stay at the canvas default.
    const conditions = cfg.workflows.flatMap((w) => w.edges).filter((e) => e.kind === "condition");
    expect(offsets.length).toBeLessThan(conditions.length);
  });

  it("leave success edges alone", () => {
    const cfg = defaultV3Config(["backend"]);
    const success = cfg.workflows.flatMap((w) => w.edges).filter((e) => e.kind === "success");
    expect(success.every((e) => e.label_offset === undefined)).toBe(true);
  });

  it("are deterministic across builds", () => {
    const a = buildWorkflow("default", "default", ["backend"]);
    const b = buildWorkflow("default", "default", ["backend"]);
    expect(a).toEqual(b);
    expect(buildTestsWorkflow("Tests", ["backend"])).toEqual(buildTestsWorkflow("Tests", ["backend"]));
  });
});
