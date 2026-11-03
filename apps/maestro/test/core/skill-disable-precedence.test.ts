// `142` gap probes: real settings files in a scratch HOME and project, no spawned process (so no
// CLAUDE_CODE_SESSION_ID or real HOME is read: every call takes an explicit `homeDir`).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  readDisableRules,
  isSkillListed,
  whyUnavailable,
  readSkillSources,
  findStaleSkillRefs,
} from "../../src/core/skill-availability.js";
import { discoverSkills } from "../../src/core/discovery.js";

let tmp: string;
let home: string;
let project: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-disable-prec-"));
  home = path.join(tmp, "home");
  project = path.join(tmp, "project");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(project, ".claude"), { recursive: true });
});
afterEach(() => {
  try {
    fs.chmodSync(path.join(project, ".claude", "settings.json"), 0o644);
  } catch {
    // not created
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

function write(file: string, body: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
}
const userS = (b: unknown) => write(path.join(home, ".claude", "settings.json"), b);
const projS = (b: unknown) => write(path.join(project, ".claude", "settings.json"), b);
const localS = (b: unknown) => write(path.join(project, ".claude", "settings.local.json"), b);
const projectSkill = (n: string) =>
  write(path.join(project, ".claude", "skills", n, "SKILL.md"), `---\nname: ${n}\ndescription: d\n---\n`);
function plugin(name: string, skills: string[]): void {
  const installPath = path.join(home, ".claude", "plugins", "cache", name);
  for (const s of skills)
    write(path.join(installPath, "skills", s, "SKILL.md"), `---\nname: ${s}\ndescription: d\n---\n`);
  const file = path.join(home, ".claude", "plugins", "installed_plugins.json");
  let cur: { plugins: Record<string, unknown[]> } = { plugins: {} };
  try {
    cur = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // first
  }
  cur.plugins[`${name}@mkt`] = [{ installPath }];
  write(file, cur);
}
const ids = async () => (await discoverSkills(project, home)).map((s) => s.id);

describe("discoverSkills through real settings files", () => {
  it("a skill off in user settings, on in project, off again in local: each step decides the list", async () => {
    projectSkill("flip");
    userS({ skillOverrides: { flip: "off" } });
    expect(await ids()).not.toContain("flip");
    projS({ skillOverrides: { flip: "on" } });
    expect(await ids()).toContain("flip");
    localS({ skillOverrides: { flip: "off" } });
    expect(await ids()).not.toContain("flip");
    localS({ skillOverrides: { flip: "on" } });
    expect(await ids()).toContain("flip");
  });

  it("a later file that does not mention the skill does not undo an earlier off", async () => {
    projectSkill("sticky");
    userS({ skillOverrides: { sticky: "off" } });
    projS({ skillOverrides: { other: "off" } });
    localS({});
    expect(await ids()).not.toContain("sticky");
  });

  // discoverSkills reads user and plugin skills from the real ~/.claude (claude-fs fixes CLAUDE_DIR at
  // import time), so plugin skills are checked through the same filter it applies: isSkillListed over
  // readDisableRules read from real scratch settings files.
  const pluginListed = (name: string, p: string) => isSkillListed(readDisableRules(project, home), name, p);

  it("enabledPlugins false hides a plugin's skills, both directions across files", () => {
    expect(pluginListed("sketch", "design")).toBe(true);
    userS({ enabledPlugins: { "design@mkt": true } });
    projS({ enabledPlugins: { "design@mkt": false } });
    expect(pluginListed("sketch", "design")).toBe(false);
    userS({ enabledPlugins: { "design@mkt": false } });
    projS({});
    localS({ enabledPlugins: { "design@mkt": true } });
    expect(pluginListed("sketch", "design")).toBe(true);
    localS({ enabledPlugins: { "design@mkt": false } });
    expect(pluginListed("sketch", "design")).toBe(false);
  });

  it("a plugin skill set off by plugin:skill is hidden, its sibling stays", () => {
    projS({ skillOverrides: { "design:sketch": "off" } });
    expect(pluginListed("sketch", "design")).toBe(false);
    expect(pluginListed("paint", "design")).toBe(true);
  });

  it("disableBundledSkills true hides no project skill from the list", async () => {
    projectSkill("mine");
    userS({ disableBundledSkills: true });
    expect(await ids()).toContain("mine");
  });

  it("invalid JSON in every settings file lists everything", async () => {
    projectSkill("mine");
    userS("{{");
    projS("");
    localS("null");
    expect(await ids()).toContain("mine");
    expect(isSkillListed(readDisableRules(project, home), "sketch", "design")).toBe(true);
  });

  it("settings paths that are directories list everything", async () => {
    projectSkill("mine");
    fs.mkdirSync(path.join(project, ".claude", "settings.json"));
    fs.mkdirSync(path.join(project, ".claude", "settings.local.json"));
    fs.mkdirSync(path.join(home, ".claude", "settings.json"));
    expect(await ids()).toContain("mine");
  });

  it("an unreadable settings file never throws and lists the skill", async () => {
    projectSkill("mine");
    projS({ skillOverrides: { mine: "off" } });
    fs.chmodSync(path.join(project, ".claude", "settings.json"), 0o000);
    let readable = true;
    try {
      fs.readFileSync(path.join(project, ".claude", "settings.json"));
    } catch {
      readable = false;
    }
    await expect(discoverSkills(project, home)).resolves.toBeDefined();
    // Running as root can still read a 0o000 file; then the override legitimately applies.
    expect((await ids()).includes("mine")).toBe(!readable);
  });

  it("wrong top-level types (array, number, string) are ignored", async () => {
    projectSkill("mine");
    userS([1, 2]);
    projS(42);
    localS('"off"');
    expect(await ids()).toContain("mine");
  });

  it("prototype-ish override keys do not disable or throw", async () => {
    projectSkill("mine");
    projectSkill("constructor");
    projS('{"skillOverrides":{"__proto__":"off","toString":"off"}}');
    expect(await ids()).toContain("mine");
    expect(() => readDisableRules(project, home)).not.toThrow();
    // an unlisted, inherited property name must not read as an override
    expect(await ids()).toContain("constructor");
  });

  it("override value is case-sensitive: 'OFF' does not disable", async () => {
    projectSkill("mine");
    projS({ skillOverrides: { mine: "OFF" } });
    expect(await ids()).toContain("mine");
  });
});

describe("whyUnavailable precedence and ids", () => {
  it("qualified id: explicit 'on' in a later file beats an earlier 'off'", () => {
    plugin("design", ["sketch"]);
    userS({ skillOverrides: { "design:sketch": "off" }, enabledPlugins: { "design@mkt": true } });
    expect(whyUnavailable(readSkillSources(project, home), "design:sketch")).toBe("skill-disabled");
    projS({ skillOverrides: { "design:sketch": "on" } });
    expect(whyUnavailable(readSkillSources(project, home), "design:sketch")).toBeNull();
  });

  it("plugin disabled beats a skill 'on' override", () => {
    plugin("design", ["sketch"]);
    projS({ skillOverrides: { "design:sketch": "on" }, enabledPlugins: { "design@mkt": false } });
    expect(whyUnavailable(readSkillSources(project, home), "design:sketch")).toBe("plugin-not-enabled");
  });

  it("an enabledPlugins key without a marketplace suffix still matches", () => {
    plugin("design", ["sketch"]);
    projS({ enabledPlugins: { design: false } });
    expect(whyUnavailable(readSkillSources(project, home), "design:sketch")).toBe("plugin-not-enabled");
  });

  it("a project skill that is off stays off even when the plugin ships the same bare name", () => {
    projectSkill("sketch");
    plugin("design", ["sketch"]);
    projS({ skillOverrides: { sketch: "off" } });
    expect(whyUnavailable(readSkillSources(project, home), "sketch")).toBe("skill-disabled");
  });
});

describe("a disabled skill named in maestro.json", () => {
  it("is reported with a reason per location and the config file is left byte-identical", async () => {
    projectSkill("gone");
    projectSkill("kept");
    projS({ skillOverrides: { gone: "off" } });
    const cfg = {
      skills_available: ["gone", "kept"],
      start_skills: { maestro: ["gone"], to_maestro_tasks: [] },
      workflow_instances: [{ name: "backend-1", loaded_skills: ["gone"], referenced_skills: ["kept"] }],
    };
    const file = path.join(project, ".claude", "maestro.json");
    write(file, cfg);
    const before = fs.readFileSync(file, "utf8");

    const report = findStaleSkillRefs(project, JSON.parse(before), home);
    expect(report.dangling).toHaveLength(1);
    expect(report.dangling[0]).toMatchObject({ id: "gone", reason: "skill-disabled" });
    expect(report.dangling[0].where).toEqual([
      "skills_available",
      "instance backend-1 loaded_skills",
      "start_skills.maestro",
    ]);
    expect(report.suggestions.join("\n")).toMatch(/"gone".*skillOverrides/);

    await discoverSkills(project, home);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(JSON.parse(before).skills_available).toContain("gone");
  });

  it("a disabled plugin skill reference is flagged plugin-not-enabled, bare or qualified", () => {
    plugin("design", ["sketch"]);
    projS({ enabledPlugins: { "design@mkt": false } });
    const r = findStaleSkillRefs(project, { skills_available: ["design:sketch", "sketch"] }, home);
    expect(r.dangling.map((d) => [d.id, d.reason])).toEqual([
      ["design:sketch", "plugin-not-enabled"],
      ["sketch", "plugin-not-enabled"],
    ]);
  });

  it("settings that are malformed never make a reference dangle", () => {
    projectSkill("gone");
    projS("{ nope");
    expect(findStaleSkillRefs(project, { skills_available: ["gone"] }, home).dangling).toEqual([]);
  });
});
