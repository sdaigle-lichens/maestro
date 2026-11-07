// `162`: the plugin's real maestro-workflow-drift.cjs, spawned against temp projects. Contract: one
// JSON line, exit 0 under every input, read-only, workflows matched by name (not key), positions
// ignored, and the seed comes from `defaultV3Config` so a freshly seeded config is `identical`.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { pinnedEnv } from "../helpers/env.js";
import { defaultV3Config } from "../../src/core/seed.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(here, "../../../../plugins/maestro/scripts/maestro-workflow-drift.cjs");

type Cfg = ReturnType<typeof defaultV3Config> & Record<string, unknown>;
interface WfReport {
  name: string;
  verdict: string;
  nodes: { added: string[]; removed: string[] };
  edges: { added: string[]; removed: string[]; retargeted: string[] };
  skills: { node: string; kind: string; added: string[]; removed: string[] }[];
}
interface Report {
  checked: boolean;
  summary: string;
  workflows: WfReport[];
  report: string[];
  apply: string;
}

let tmp: string;
let home: string;
let n = 0;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-drift-"));
  home = path.join(tmp, "home");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** A project whose maestro.json is the seed with its workflows keyed "0".."n" like a real one. */
function seeded(): Cfg {
  const cfg = defaultV3Config(["backend"]) as unknown as Cfg;
  return JSON.parse(JSON.stringify(cfg));
}

function project(cfg: unknown): { root: string; file: string } {
  const root = path.join(tmp, `p${n++}`);
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  const file = path.join(root, ".claude", "maestro.json");
  fs.writeFileSync(file, typeof cfg === "string" ? cfg : JSON.stringify(cfg, null, 2));
  return { root, file };
}

function run(root: string): Report {
  const res = spawnSync("node", [SCRIPT, root], { encoding: "utf8", env: pinnedEnv(home) });
  expect(res.status).toBe(0);
  expect(res.stderr).toBe("");
  expect(res.stdout.trimEnd().split("\n")).toHaveLength(1);
  return JSON.parse(res.stdout) as Report;
}

const verdicts = (r: Report) => Object.fromEntries(r.workflows.map((w) => [w.name, w.verdict]));
const wf = (r: Report, name: string) => r.workflows.find((w) => w.name === name)!;
// The seed's workflows are an array in the config; mutate the project's copy.
const workflowsOf = (cfg: Cfg) =>
  cfg.workflows as unknown as {
    name: string;
    nodes: { id: string; position?: unknown }[];
    edges: { from: string; to: string; kind: string; label?: string }[];
  }[];

describe("maestro-workflow-drift.cjs", () => {
  it("a seeded config is identical in every workflow, and the report is quiet", () => {
    const { root } = project(seeded());
    const out = run(root);
    expect(out.checked).toBe(true);
    expect(out.workflows.map((w) => w.verdict)).toEqual(Array(6).fill("identical"));
    expect(out.summary).toContain("no differences");
    expect(out.report.at(-1)).toContain("update-workflow");
  });

  it("one edge retargeted is reported as retargeted with its condition label, in agent and node names", () => {
    const cfg = seeded();
    const def = workflowsOf(cfg).find((w) => w.name === "default")!;
    const edge = def.edges.find((e) => e.from === "reviewer" && e.to === "refactor")!;
    edge.to = "scribe";
    const { root } = project(cfg);
    const out = run(root);
    const d = wf(out, "default");
    expect(d.verdict).toBe("differs");
    expect(d.edges.retargeted).toHaveLength(1);
    expect(d.edges.retargeted[0]).toContain("reviewer: refactor -> scribe");
    expect(d.edges.retargeted[0]).toContain(`[${edge.label}]`);
    expect(d.edges.added).toEqual([]);
    expect(d.edges.removed).toEqual([]);
    expect(d.nodes).toEqual({ added: [], removed: [] });
    expect(verdicts(out).tdd).toBe("identical");
    expect(out.report.join("\n")).toContain("default: differs");
  });

  it("an added and a removed edge are reported with their labels", () => {
    const cfg = seeded();
    const def = workflowsOf(cfg).find((w) => w.name === "default")!;
    const removed = def.edges.find((e) => e.kind === "condition" && e.from === "refactor" && e.to === "scribe")!;
    def.edges = def.edges.filter((e) => e !== removed);
    def.edges.push({ from: "scribe", to: "backend", kind: "condition", label: "docs need code" });
    const d = wf(run(project(cfg).root), "default");
    expect(d.edges.removed.join("\n")).toContain(removed.label!);
    expect(d.edges.added).toEqual(["scribe -> backend [docs need code]"]);
    expect(d.edges.retargeted).toEqual([]);
  });

  it("a removed node is reported by node name, with the edges that went with it", () => {
    const cfg = seeded();
    const def = workflowsOf(cfg).find((w) => w.name === "default")!;
    def.nodes = def.nodes.filter((nd) => nd.id !== "scribe");
    def.edges = def.edges.filter((e) => e.from !== "scribe" && e.to !== "scribe");
    const d = wf(run(project(cfg).root), "default");
    expect(d.verdict).toBe("differs");
    expect(d.nodes.removed).toEqual(["scribe"]);
    expect(d.nodes.added).toEqual([]);
    expect(d.edges.removed.length).toBeGreaterThan(0);
  });

  it("an extra workflow is project-only and a dropped seed workflow is missing-in-project, neither a difference", () => {
    const cfg = seeded();
    const list = workflowsOf(cfg);
    const kept = list.filter((w) => w.name !== "Review");
    (cfg as unknown as { workflows: unknown }).workflows = [
      ...kept,
      { name: "Hotfix", nodes: [{ id: "backend", type: "agent", instance: "backend" }], edges: [] },
    ];
    const out = run(project(cfg).root);
    expect(verdicts(out).Hotfix).toBe("project-only");
    expect(verdicts(out).Review).toBe("missing-in-project");
    expect(out.workflows.filter((w) => w.verdict === "differs")).toEqual([]);
    expect(out.summary).toContain("no differences");
  });

  it("matches by name case-insensitively, and the key is not the identity", () => {
    const cfg = seeded();
    const list = workflowsOf(cfg);
    // Real projects key workflows by numeric strings, in any order.
    const keyed: Record<string, unknown> = {};
    [...list].reverse().forEach((w, i) => {
      keyed[String(i * 5)] = w.name === "Review" ? { ...w, name: "review" } : w;
    });
    (cfg as unknown as { workflows: unknown }).workflows = keyed;
    const out = run(project(cfg).root);
    expect(out.workflows.map((w) => w.verdict)).toEqual(Array(6).fill("identical"));
  });

  it("ignores positions and label offsets", () => {
    const cfg = seeded();
    for (const w of workflowsOf(cfg)) {
      for (const nd of w.nodes) nd.position = { x: 9999, y: 9999 };
      for (const e of w.edges as unknown as { label_offset?: unknown }[]) e.label_offset = { x: 1, y: 2 };
    }
    expect(run(project(cfg).root).workflows.map((w) => w.verdict)).toEqual(Array(6).fill("identical"));
  });

  it("reports a change to a node's loaded skills", () => {
    const cfg = seeded();
    const inst = (cfg.workflow_instances as unknown as { name: string; loaded_skills: string[] }[]).find(
      (i) => i.name === "reviewer"
    )!;
    inst.loaded_skills = ["extra-skill"];
    const d = wf(run(project(cfg).root), "default");
    expect(d.verdict).toBe("differs");
    expect(d.skills).toContainEqual({ node: "reviewer", kind: "loaded", added: ["extra-skill"], removed: [] });
  });

  it("writes nothing: maestro.json is byte-identical afterwards and no file appears", () => {
    const cfg = seeded();
    workflowsOf(cfg)[0]!.nodes.pop();
    const { root, file } = project(cfg);
    const before = fs.readFileSync(file, "utf8");
    const listing = () => fs.readdirSync(path.join(root, ".claude"), { recursive: true }).sort();
    const files = listing();
    run(root);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(listing()).toEqual(files);
  });

  it("no maestro.json, a corrupt one, or a non-v3 one: checked false, exit 0", () => {
    const missing = path.join(tmp, `p${n++}`);
    fs.mkdirSync(missing, { recursive: true });
    for (const root of [missing, project("{ not json").root, project({ version: 2 }).root]) {
      const out = run(root);
      expect(out.checked).toBe(false);
      expect(out.workflows).toEqual([]);
    }
  });
});

// Gaps found in QA for `162`: node additions, a skill node that is the same skill under a shorter
// id, and the deliberate omission of referenced skills.
const SKILL_ID = "code-graph:use-code-architecture-design-check";

describe("maestro-workflow-drift.cjs, gap coverage", () => {
  it("a node added to a workflow is reported by agent and node name", () => {
    const cfg = seeded();
    const def = workflowsOf(cfg).find((w) => w.name === "default")!;
    def.nodes.push({ id: "extra-scribe", type: "agent", instance: "scribe" } as unknown as (typeof def.nodes)[number]);
    const d = wf(run(project(cfg).root), "default");
    expect(d.verdict).toBe("differs");
    expect(d.nodes.added).toEqual(["extra-scribe (agent scribe)"]);
    expect(d.nodes.removed).toEqual([]);
  });

  it("the same design-check skill under a shorter node id is not a difference", () => {
    // The seed carries the design-check skill node only when the project can see that skill, so the
    // project gets the skill too. Its node id is then renamed (as a hand edit or the app may do).
    const cfg = defaultV3Config(["backend"], {}, { designCheck: SKILL_ID }) as unknown as Cfg;
    const seeded2: Cfg = JSON.parse(JSON.stringify(cfg));
    // The design-check node lives in Refactor; default has none, so the rename must happen there.
    const def = workflowsOf(seeded2).find((w) => w.name === "Refactor")!;
    expect(def.nodes.some((n) => n.id === SKILL_ID)).toBe(true);
    const short = "use-code-architecture-design-check";
    for (const n of def.nodes) if (n.id === SKILL_ID) n.id = short;
    for (const e of def.edges) {
      if (e.from === SKILL_ID) e.from = short;
      if (e.to === SKILL_ID) e.to = short;
    }
    const { root } = project(seeded2);
    // The seed adds the design-check node only when the skill is visible, and that lookup reads the
    // user's ~/.claude/skills. Give this test its own home so the shared one stays without the skill.
    const home2 = path.join(root, "home");
    const skillDir = path.join(home2, ".claude", "skills", SKILL_ID);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), `---\nname: ${SKILL_ID}\ndescription: test\n---\n`);
    // A namespaced id is available only when its plugin is enabled.
    fs.writeFileSync(
      path.join(home2, ".claude", "settings.json"),
      JSON.stringify({ enabledPlugins: { "code-graph@test-marketplace": true } })
    );
    const res = spawnSync("node", [SCRIPT, root], { encoding: "utf8", env: pinnedEnv(home2) });
    expect(res.status).toBe(0);
    const d = (JSON.parse(res.stdout) as Report).workflows.find((w) => w.name === "Refactor")!;
    expect(d.nodes).toEqual({ added: [], removed: [] });
    expect(d.edges.retargeted.filter((r) => r.includes("skill"))).toEqual([]);
    expect(d.verdict).toBe("identical");
  });

  it("a fresh install is not drift whether or not the design-check skill was visible at install time", () => {
    // Seeded where the skill was visible (Refactor has the skill node), checked where it is not.
    const withSkill = JSON.parse(JSON.stringify(defaultV3Config(["backend"], {}, { designCheck: SKILL_ID }))) as Cfg;
    expect(run(project(withSkill).root).workflows.map((w) => w.verdict)).toEqual(Array(6).fill("identical"));
    // Seeded where it was not visible (no skill node), checked where it now is: home2 can see it.
    const without = JSON.parse(JSON.stringify(defaultV3Config(["backend"]))) as Cfg;
    const { root } = project(without);
    const skillDir = path.join(root, ".claude", "skills", "use-code-architecture-design-check");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: use-code-architecture-design-check\ndescription: t\n---\n"
    );
    expect(run(root).workflows.map((w) => w.verdict)).toEqual(Array(6).fill("identical"));
  });

  it("a changed referenced_skills list is deliberately not compared, since the seed takes the project's own", () => {
    const cfg = seeded();
    const inst = (cfg.workflow_instances as unknown as { name: string; referenced_skills?: string[] }[]).find(
      (i) => i.name === "reviewer"
    )!;
    inst.referenced_skills = [...(inst.referenced_skills ?? []), "extra-referenced-skill"];
    const out = run(project(cfg).root);
    expect(out.workflows.filter((w) => w.verdict === "differs")).toEqual([]);
    expect(out.workflows.flatMap((w) => w.skills).filter((s) => s.kind === "referenced")).toEqual([]);
  });
});

// Round-2 QA gaps for `162`. Each one spawns the real plugin script against a temp project.
type LooseNode = { id: string; type: string };
type LooseEdge = { from: string; to: string; kind: string; label?: string };

describe("maestro-workflow-drift.cjs, round-2 gap coverage", () => {
  it("a skill node added to a workflow is reported as a node added, named by its skill", () => {
    const cfg = seeded();
    const def = workflowsOf(cfg).find((w) => w.name === "default")!;
    def.nodes.push({
      id: "use-other",
      type: "skill",
      skill: "code-graph:use-other",
      position: { x: 0, y: 0 },
    } as unknown as (typeof def.nodes)[number]);
    const d = wf(run(project(cfg).root), "default");
    expect(d.verdict).toBe("differs");
    expect(d.nodes.added).toEqual(["skill code-graph:use-other"]);
    expect(d.nodes.removed).toEqual([]);
  });

  it("an edited condition label is an edge removed and an edge added, not a retarget", () => {
    const cfg = seeded();
    const def = workflowsOf(cfg).find((w) => w.name === "default")!;
    const edge = def.edges.find((e) => e.kind === "condition" && e.from === "refactor" && e.to === "scribe")!;
    const oldLabel = edge.label!;
    edge.label = "reworded condition";
    const d = wf(run(project(cfg).root), "default");
    expect(d.verdict).toBe("differs");
    expect(d.edges.retargeted).toEqual([]);
    expect(d.edges.removed.join("\n")).toContain(oldLabel);
    expect(d.edges.added).toEqual(["refactor -> scribe [reworded condition]"]);
  });

  it("a design-check skill visible at install time is not a difference when the project's Refactor lacks the node", () => {
    // The drift report never consults the home directory: it compares against the project's own Refactor.
    const { root } = project(seeded());
    const visibleHome = path.join(tmp, "home-visible");
    const skillDir = path.join(visibleHome, ".claude", "skills", SKILL_ID);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), `---\nname: ${SKILL_ID}\ndescription: test\n---\n`);
    fs.writeFileSync(
      path.join(visibleHome, ".claude", "settings.json"),
      JSON.stringify({ enabledPlugins: { "code-graph@test-marketplace": true } })
    );
    const res = spawnSync("node", [SCRIPT, root], { encoding: "utf8", env: pinnedEnv(visibleHome) });
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout) as Report;
    expect(out.workflows.map((w) => w.verdict)).toEqual(Array(6).fill("identical"));
  });

  it("a design-check node deleted from Refactor with its edges rewired is identical, as the doc says", () => {
    const c: Cfg = JSON.parse(JSON.stringify(defaultV3Config(["backend"], {}, { designCheck: SKILL_ID })));
    const r = workflowsOf(c).find((w) => w.name === "Refactor")! as unknown as {
      nodes: LooseNode[];
      edges: LooseEdge[];
    };
    const skill = r.nodes.find((n) => n.type === "skill")!;
    const into = r.edges.find((e) => e.to === skill.id)!;
    const out = r.edges.find((e) => e.from === skill.id)!;
    r.edges = [...r.edges.filter((e) => e.from !== skill.id && e.to !== skill.id), { ...into, to: out.to }];
    r.nodes = r.nodes.filter((n) => n.id !== skill.id);
    const res = run(project(c).root);
    expect(wf(res, "Refactor").verdict).toBe("identical");
  });

  it("an edge pointing at a node the config does not have is reported as an added edge, and nothing crashes", () => {
    const cfg = seeded();
    const def = workflowsOf(cfg).find((w) => w.name === "default")!;
    def.edges.push({ from: "ghost", to: "scribe", kind: "success" });
    const out = run(project(cfg).root);
    expect(out.checked).toBe(true);
    const d = wf(out, "default");
    expect(d.verdict).toBe("differs");
    expect(d.edges.added).toEqual(["ghost -> scribe"]);
  });

  it("a v3 config with no workflows is checked, exits 0, and every seed workflow is missing-in-project", () => {
    const bare = { ...seeded() } as Record<string, unknown>;
    delete bare.workflows;
    const out = run(project(bare).root);
    expect(out.checked).toBe(true);
    expect(out.workflows.map((w) => w.verdict)).toEqual(Array(6).fill("missing-in-project"));
    expect(out.summary).toContain("6 missing in project");
  });
});
