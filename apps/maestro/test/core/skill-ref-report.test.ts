// `091`: the IPC-facing report behind `data:skill-refs`. Scratch home and project throughout —
// never the real ~/.claude.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { skillRefReport } from "../../src/core/skill-ref-report.js";

let tmp: string;
let home: string;
let n = 0;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-ref-report-"));
  home = path.join(tmp, "home");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function project(files: Record<string, string | object>): string {
  const root = path.join(tmp, `p${n++}`);
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, ".claude", rel)), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", rel), typeof body === "string" ? body : JSON.stringify(body));
  }
  return root;
}

function config(extra: object = {}) {
  return {
    version: 3,
    agents_available: [],
    skills_available: [],
    workflow_instances: [],
    workflows: [],
    rules: [],
    ...extra,
  };
}

describe("skillRefReport", () => {
  it("is empty without a project, a config, or with a corrupt one", () => {
    const empty = { dangling: [], suggestions: [] };
    expect(skillRefReport("", home)).toEqual(empty);
    expect(skillRefReport(project({}), home)).toEqual(empty);
    expect(skillRefReport(project({ "maestro.json": "{not json" }), home)).toEqual(empty);
  });

  it("is empty when every reference resolves", () => {
    const root = project({
      "skills/local/SKILL.md": "---\nname: local\n---\n",
      "maestro.json": config({ skills_available: ["local"] }),
    });
    expect(skillRefReport(root, home)).toEqual({ dangling: [], suggestions: [] });
  });

  it("reports plugin-not-installed, skill-not-in-plugin, plugin-not-enabled and not-found with where", () => {
    const installPath = path.join(tmp, "plugin-cache", "shipper");
    fs.mkdirSync(path.join(installPath, "skills", "real"), { recursive: true });
    fs.writeFileSync(path.join(installPath, "skills", "real", "SKILL.md"), "x");
    const otherPath = path.join(tmp, "plugin-cache", "dormant");
    fs.mkdirSync(path.join(otherPath, "skills", "s"), { recursive: true });
    fs.writeFileSync(path.join(otherPath, "skills", "s", "SKILL.md"), "x");
    const h = path.join(tmp, `home-${n++}`);
    fs.mkdirSync(path.join(h, ".claude", "plugins"), { recursive: true });
    fs.writeFileSync(
      path.join(h, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({
        plugins: { "shipper@m": [{ installPath }], "dormant@m": [{ installPath: otherPath }] },
      })
    );
    const root = project({
      "settings.json": { enabledPlugins: { "shipper@m": true } },
      "maestro.json": config({
        skills_available: ["ghost:one", "shipper:missing", "dormant:s", "bare-nothing"],
        workflow_instances: [
          { name: "backend", agent: "backend", loaded_skills: ["ghost:one"], referenced_skills: [] },
        ],
        workflows: [{ name: "Main", nodes: [{ id: "n", type: "skill", skill: "bare-nothing" }], edges: [] }],
        start_skills: { maestro: ["ghost:one"], to_maestro_tasks: [] },
        end_skills: { maestro: ["shipper:real"] },
      }),
    });

    const report = skillRefReport(root, h);
    const byId = Object.fromEntries(report.dangling.map((d) => [d.id, d]));
    expect(byId["ghost:one"].reason).toBe("plugin-not-installed");
    expect(byId["ghost:one"].where).toEqual([
      "skills_available",
      "instance backend loaded_skills",
      "start_skills.maestro",
    ]);
    expect(byId["shipper:missing"].reason).toBe("skill-not-in-plugin");
    expect(byId["dormant:s"].reason).toBe("plugin-not-enabled");
    expect(byId["bare-nothing"].reason).toBe("not-found");
    expect(byId["bare-nothing"].where).toEqual(["skills_available", "workflow Main skill node"]);
    expect(byId["shipper:real"]).toBeUndefined();
    expect(report.dangling).toHaveLength(4);
    expect(report.suggestions).toHaveLength(4);
  });

  it("adds the concept-skills hint only when concept-skills.json exists and the plugin is not enabled", () => {
    const cfg = config();
    const without = project({ "maestro.json": cfg });
    expect(skillRefReport(without, home).suggestions).toEqual([]);

    const hinted = project({ "maestro.json": cfg, "concept-skills.json": {} });
    const report = skillRefReport(hinted, home);
    expect(report.dangling).toEqual([]);
    expect(report.suggestions).toHaveLength(1);
    expect(report.suggestions[0]).toContain("concept-skills plugin is not enabled");

    const enabled = project({
      "maestro.json": cfg,
      "concept-skills.json": {},
      "settings.json": { enabledPlugins: { "concept-skills@maestro": true } },
    });
    expect(skillRefReport(enabled, home).suggestions).toEqual([]);
  });
});
