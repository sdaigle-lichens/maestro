// `091`: the report is advisory and re-derived from disk each call, so fixing a reference or
// enabling a plugin outside the app clears the marks on the next ask. Scratch home and project only.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { skillRefReport } from "../../src/core/skill-ref-report.js";

let tmp: string;
let home: string;
let installPath: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-ref-lifecycle-"));
  home = path.join(tmp, "home");
  installPath = path.join(tmp, "cache", "concept-skills");
  fs.mkdirSync(path.join(installPath, "skills", "scribe"), { recursive: true });
  fs.writeFileSync(path.join(installPath, "skills", "scribe", "SKILL.md"), "x");
  fs.mkdirSync(path.join(home, ".claude", "plugins"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".claude", "plugins", "installed_plugins.json"),
    JSON.stringify({ plugins: { "concept-skills@maestro": [{ installPath }] } })
  );
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function makeProject(cfg: object, settings?: object): string {
  const root = fs.mkdtempSync(path.join(tmp, "p-"));
  fs.mkdirSync(path.join(root, ".claude"));
  fs.writeFileSync(path.join(root, ".claude", "maestro.json"), JSON.stringify(cfg));
  fs.writeFileSync(path.join(root, ".claude", "concept-skills.json"), "{}");
  if (settings) fs.writeFileSync(path.join(root, ".claude", "settings.json"), JSON.stringify(settings));
  return root;
}

const cfg = (skills: string[]) => ({
  version: 3,
  agents_available: [],
  skills_available: skills,
  workflow_instances: [],
  workflows: [],
  rules: [],
});

describe("skillRefReport lifecycle", () => {
  it("clears the mark and the hint once the plugin is enabled outside the app", () => {
    const root = makeProject(cfg(["concept-skills:scribe"]));
    const before = skillRefReport(root, home);
    expect(before.dangling.map((d) => [d.id, d.reason])).toEqual([["concept-skills:scribe", "plugin-not-enabled"]]);
    // The legacy state file is hinted toward code-graph (the plugin this skill id names is a separate matter).
    expect(before.suggestions.some((s) => s.includes("/code-graph-install"))).toBe(true);

    fs.writeFileSync(
      path.join(root, ".claude", "settings.json"),
      JSON.stringify({ enabledPlugins: { "concept-skills@maestro": true } })
    );
    // The mark clears; concept-skills still being on leaves only the migrate hint, never a dangling mark.
    const after = skillRefReport(root, home);
    expect(after.dangling).toEqual([]);
    expect(after.suggestions).toHaveLength(1);
    expect(after.suggestions[0]).toContain("/code-graph-install");
  });

  it("clears the mark after the reference is removed from the file", () => {
    const root = makeProject(cfg(["concept-skills:scribe", "nope"]));
    expect(skillRefReport(root, home).dangling.map((d) => d.id)).toContain("nope");
    fs.writeFileSync(path.join(root, ".claude", "maestro.json"), JSON.stringify(cfg(["concept-skills:scribe"])));
    expect(skillRefReport(root, home).dangling.map((d) => d.id)).not.toContain("nope");
  });

  it("is advisory: never rewrites the config", () => {
    const root = makeProject(cfg(["ghost:x", "nope"]));
    const file = path.join(root, ".claude", "maestro.json");
    const bytes = fs.readFileSync(file);
    skillRefReport(root, home);
    expect(fs.readFileSync(file).equals(bytes)).toBe(true);
  });

  it("survives the IPC boundary: plain JSON that round-trips through structured clone", () => {
    const root = makeProject(cfg(["ghost:x"]));
    const report = skillRefReport(root, home);
    expect(report.dangling).toHaveLength(1);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    expect(structuredClone(report)).toEqual(report);
    expect(Object.keys(report.dangling[0]).sort()).toEqual(["id", "reason", "where"]);
  });

  it("collapses an id referenced in several places into one entry listing each place", () => {
    const root = makeProject({
      ...cfg(["ghost:x"]),
      start_skills: { maestro: ["ghost:x"], to_maestro_tasks: ["ghost:x"] },
    });
    const { dangling } = skillRefReport(root, home);
    expect(dangling).toHaveLength(1);
    expect(dangling[0].where.length).toBeGreaterThanOrEqual(3);
  });
});
