// `142`: a skill the project switched off is left out of every list and flagged in the
// dangling-reference report. One decision (`skillDisabledReason`) behind both; `homeDir` is always a
// scratch directory so nothing reads the developer's real ~/.claude.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  readSkillSources,
  readDisableRules,
  isSkillListed,
  skillDisabledReason,
  whyUnavailable,
  findStaleSkillRefs,
} from "../../src/core/skill-availability.js";
import { discoverSkills } from "../../src/core/discovery.js";
import { previewClaudeRun } from "../../src/core/claude-preview.js";

let tmp: string;
let home: string;
let project: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-disable-"));
  home = path.join(tmp, "home");
  project = path.join(tmp, "project");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(project, ".claude"), { recursive: true });
});

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function write(file: string, body: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
}

const userSettings = (body: unknown) => write(path.join(home, ".claude", "settings.json"), body);
const projectSettings = (body: unknown) => write(path.join(project, ".claude", "settings.json"), body);
const localSettings = (body: unknown) => write(path.join(project, ".claude", "settings.local.json"), body);

function projectSkill(name: string): void {
  write(path.join(project, ".claude", "skills", name, "SKILL.md"), `---\nname: ${name}\ndescription: d\n---\n`);
}

function installPlugin(name: string, skills: string[]): void {
  const installPath = path.join(home, ".claude", "plugins", "cache", name);
  for (const s of skills) write(path.join(installPath, "skills", s, "SKILL.md"), `---\nname: ${s}\n---\n`);
  const file = path.join(home, ".claude", "plugins", "installed_plugins.json");
  let existing: { plugins: Record<string, unknown[]> } = { plugins: {} };
  try {
    existing = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // first plugin
  }
  existing.plugins[`${name}@mkt`] = [{ installPath }];
  write(file, existing);
}

const reason = (id: string) => whyUnavailable(readSkillSources(project, home), id);
const listed = (name: string, plugin?: string) => isSkillListed(readDisableRules(project, home), name, plugin);

describe("skillOverrides: off", () => {
  it("hides a project skill set to off in the project settings, and reports it", () => {
    projectSkill("mine");
    expect(reason("mine")).toBeNull();
    expect(listed("mine")).toBe(true);
    projectSettings({ skillOverrides: { mine: "off" } });
    expect(reason("mine")).toBe("skill-disabled");
    expect(listed("mine")).toBe(false);
  });

  it("only the value 'off' disables", () => {
    projectSkill("mine");
    projectSettings({ skillOverrides: { mine: "on" } });
    expect(listed("mine")).toBe(true);
    projectSettings({ skillOverrides: { mine: "name-only" } });
    expect(listed("mine")).toBe(true);
  });

  it("applies to a plugin skill by bare name or by plugin:skill", () => {
    installPlugin("design", ["sketch"]);
    projectSettings({ skillOverrides: { "design:sketch": "off" } });
    expect(listed("sketch", "design")).toBe(false);
    expect(reason("design:sketch")).toBe("skill-disabled");
    expect(reason("sketch")).toBe("skill-disabled");
    projectSettings({ skillOverrides: { sketch: "off" } });
    expect(listed("sketch", "design")).toBe(false);
  });

  it("an explicit plugin:skill 'on' beats a bare-name 'off'", () => {
    installPlugin("design", ["sketch"]);
    projectSettings({ skillOverrides: { sketch: "off", "design:sketch": "on" } });
    expect(listed("sketch", "design")).toBe(true);
  });

  it("settings.local.json beats settings.json, which beats the user's file (both directions)", () => {
    projectSkill("mine");
    userSettings({ skillOverrides: { mine: "off" } });
    expect(listed("mine")).toBe(false);
    projectSettings({ skillOverrides: { mine: "on" } });
    expect(listed("mine")).toBe(true);
    localSettings({ skillOverrides: { mine: "off" } });
    expect(listed("mine")).toBe(false);

    userSettings({ skillOverrides: { mine: "on" } });
    projectSettings({ skillOverrides: { mine: "off" } });
    localSettings({});
    expect(listed("mine")).toBe(false);
  });
});

describe("disableBundledSkills", () => {
  it("flags a built-in skill reference only when true", () => {
    expect(reason("simplify")).toBeNull();
    userSettings({ disableBundledSkills: false });
    expect(reason("simplify")).toBeNull();
    userSettings({ disableBundledSkills: true });
    expect(reason("simplify")).toBe("bundled-skills-disabled");
  });

  it("a project value overrides the user's, in both directions", () => {
    userSettings({ disableBundledSkills: true });
    projectSettings({ disableBundledSkills: false });
    expect(reason("simplify")).toBeNull();
    userSettings({ disableBundledSkills: false });
    localSettings({ disableBundledSkills: true });
    expect(reason("simplify")).toBe("bundled-skills-disabled");
  });

  it("does not hide a project skill that happens to share no built-in name", () => {
    projectSkill("mine");
    userSettings({ disableBundledSkills: true });
    expect(reason("mine")).toBeNull();
    expect(listed("mine")).toBe(true);
  });
});

describe("enabledPlugins: false", () => {
  it("hides the plugin's skills from lists and reports a bare and a qualified reference", () => {
    installPlugin("design", ["sketch"]);
    expect(listed("sketch", "design")).toBe(true);
    projectSettings({ enabledPlugins: { "design@mkt": false } });
    expect(listed("sketch", "design")).toBe(false);
    expect(reason("design:sketch")).toBe("plugin-not-enabled");
    expect(reason("sketch")).toBe("plugin-not-enabled");
  });

  it("a plugin never mentioned is not hidden", () => {
    installPlugin("design", ["sketch"]);
    expect(listed("sketch", "design")).toBe(true);
    expect(reason("sketch")).toBeNull();
  });

  it("project false overrides user true", () => {
    installPlugin("design", ["sketch"]);
    userSettings({ enabledPlugins: { "design@mkt": true } });
    expect(listed("sketch", "design")).toBe(true);
    projectSettings({ enabledPlugins: { "design@mkt": false } });
    expect(listed("sketch", "design")).toBe(false);
  });

  it("project true overrides user false", () => {
    installPlugin("design", ["sketch"]);
    userSettings({ enabledPlugins: { "design@mkt": false } });
    expect(listed("sketch", "design")).toBe(false);
    projectSettings({ enabledPlugins: { "design@mkt": true } });
    expect(listed("sketch", "design")).toBe(true);
    localSettings({ enabledPlugins: { "design@mkt": false } });
    expect(listed("sketch", "design")).toBe(false);
  });

  it("a bare skill two plugins ship stays available while one of them is enabled", () => {
    installPlugin("a", ["shared"]);
    installPlugin("b", ["shared"]);
    projectSettings({ enabledPlugins: { "a@mkt": false } });
    expect(reason("shared")).toBeNull();
    projectSettings({ enabledPlugins: { "a@mkt": false, "b@mkt": false } });
    expect(reason("shared")).toBe("plugin-not-enabled");
  });
});

describe("unreadable or malformed settings", () => {
  it("never throws and falls back to listing the skill", () => {
    projectSkill("mine");
    userSettings("{ not json");
    projectSettings("[1, 2");
    localSettings({ skillOverrides: ["mine"], enabledPlugins: 7, disableBundledSkills: "yes" });
    expect(() => readSkillSources(project, home)).not.toThrow();
    expect(listed("mine")).toBe(true);
    expect(reason("mine")).toBeNull();
    expect(reason("simplify")).toBeNull();
  });

  it("ignores wrongly typed values but keeps the valid ones in the same file", () => {
    projectSkill("mine");
    projectSettings({ skillOverrides: { mine: "off", other: 3 }, enabledPlugins: { "x@mkt": "no" } });
    expect(listed("mine")).toBe(false);
    expect(listed("other")).toBe(true);
    expect(readDisableRules(project, home).disabledPlugins).toEqual([]);
  });

  it("a settings path that is a directory does not throw", () => {
    fs.mkdirSync(path.join(project, ".claude", "settings.json"));
    expect(() => readDisableRules(project, home)).not.toThrow();
    expect(skillDisabledReason(readDisableRules(project, home), "mine")).toBeNull();
  });
});

describe("one decision, two callers", () => {
  it("discoverSkills leaves a disabled project skill out while the config reference is flagged with a reason", async () => {
    projectSkill("keep-me");
    projectSkill("drop-me");
    projectSettings({ skillOverrides: { "drop-me": "off" } });

    const ids = (await discoverSkills(project, home)).map((s) => s.id);
    expect(ids).toContain("keep-me");
    expect(ids).not.toContain("drop-me");

    const cfg = { skills_available: ["keep-me", "drop-me"] };
    const report = findStaleSkillRefs(project, cfg, home);
    expect(report.dangling).toEqual([{ id: "drop-me", reason: "skill-disabled", where: ["skills_available"] }]);
    expect(report.suggestions.join("\n")).toContain("skillOverrides");
  });

  it("flags a disabled-bundled reference with its own suggestion", () => {
    userSettings({ disableBundledSkills: true });
    const report = findStaleSkillRefs(project, { skills_available: ["simplify"] }, home);
    expect(report.dangling[0]).toMatchObject({ id: "simplify", reason: "bundled-skills-disabled" });
    expect(report.suggestions.join("\n")).toContain("disableBundledSkills");
  });
});

describe("built-in id collisions", () => {
  it("a project, user or plugin skill that shares a built-in id is never flagged as bundled-disabled", () => {
    userSettings({ disableBundledSkills: true });
    expect(reason("simplify")).toBe("bundled-skills-disabled");
    projectSkill("simplify");
    expect(reason("simplify")).toBeNull();
    fs.rmSync(path.join(project, ".claude", "skills"), { recursive: true });
    write(path.join(home, ".claude", "skills", "loop", "SKILL.md"), "x");
    expect(reason("loop")).toBeNull();
    installPlugin("mine", ["debug"]);
    expect(reason("debug")).toBeNull();
  });

  it("a plugin-qualified id is never a built-in", () => {
    userSettings({ disableBundledSkills: true });
    expect(reason("code-graph:simplify")).not.toBe("bundled-skills-disabled");
  });

  it("a name that is not a built-in is not-found, never bundled-disabled", () => {
    userSettings({ disableBundledSkills: true });
    expect(reason("definitely-not-builtin")).toBe("not-found");
  });
});

describe("update-skill-tags table", () => {
  it("leaves out a project skill the project switched off", async () => {
    projectSkill("tag-keep");
    projectSkill("tag-drop");
    projectSettings({ skillOverrides: { "tag-drop": "off" } });
    const bin = path.join(tmp, "bin");
    write(path.join(bin, "claude"), "#!/bin/sh\ntrue\n");
    fs.chmodSync(path.join(bin, "claude"), 0o755);
    const preview = await previewClaudeRun(
      project,
      { kind: "update-skill-tags" },
      { env: { PATH: bin }, home, platform: "linux" as const }
    );
    expect(preview.prompt).toContain("| tag-keep |");
    expect(preview.prompt).not.toContain("tag-drop");
  });
});
