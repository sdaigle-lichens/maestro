// `090`: which skills a project can invoke. `seedSkillsFor` decides whether the seed names the
// design check; `findStaleSkillRefs` reports ids already dangling in an existing config. Both read
// the same sources, so they are tested against the same scratch home + project.
//
// `homeDir` is always passed explicitly: nothing here reads the developer's real ~/.claude.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  seedSkillsFor,
  findStaleSkillRefs,
  whyUnavailable,
  collectSkillRefs,
  readEnabledPlugins,
  readSkillSources,
  firstAvailableSkill,
} from "../../src/core/skill-availability.js";

const DESIGN = "code-graph:use-code-architecture-design-check";

let tmp: string;
let home: string;
let project: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-availability-"));
  home = path.join(tmp, "home");
  project = path.join(tmp, "project");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(project, ".claude"), { recursive: true });
});

afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function writeJson(file: string, body: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof body === "string" ? body : JSON.stringify(body));
}

/** An installed plugin on disk, listed in installed_plugins.json, shipping `skills`. */
function installPlugin(name: string, skills: string[]): void {
  const installPath = path.join(home, ".claude", "plugins", "cache", name);
  for (const s of skills) writeJson(path.join(installPath, "skills", s, "SKILL.md"), `---\nname: ${s}\n---\n`);
  const file = path.join(home, ".claude", "plugins", "installed_plugins.json");
  let existing: { plugins: Record<string, unknown[]> } = { plugins: {} };
  try {
    existing = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // first plugin
  }
  existing.plugins[`${name}@maestro`] = [{ installPath }];
  writeJson(file, existing);
}

const enableInProject = (name: string, on = true, file = "settings.json") =>
  writeJson(path.join(project, ".claude", file), { enabledPlugins: { [`${name}@maestro`]: on } });

describe("readEnabledPlugins", () => {
  it("is empty with no settings files", () => {
    expect(readEnabledPlugins(project, home)).toEqual([]);
  });

  it("strips the @marketplace and keeps only true values", () => {
    writeJson(path.join(project, ".claude", "settings.json"), {
      enabledPlugins: { "code-graph@maestro": true, "other@maestro": false, bare: true },
    });
    expect(readEnabledPlugins(project, home).sort()).toEqual(["bare", "code-graph"]);
  });

  it("a later file overrides an earlier one: project can switch off what the user switched on", () => {
    writeJson(path.join(home, ".claude", "settings.json"), { enabledPlugins: { "code-graph@maestro": true } });
    expect(readEnabledPlugins(project, home)).toEqual(["code-graph"]);
    enableInProject("code-graph", false);
    expect(readEnabledPlugins(project, home)).toEqual([]);
    enableInProject("code-graph", true, "settings.local.json");
    expect(readEnabledPlugins(project, home)).toEqual(["code-graph"]);
  });

  it("tolerates a corrupt or wrongly-shaped settings file", () => {
    writeJson(path.join(project, ".claude", "settings.json"), "{ not json");
    writeJson(path.join(project, ".claude", "settings.local.json"), { enabledPlugins: ["x"] });
    expect(readEnabledPlugins(project, home)).toEqual([]);
  });
});

describe("whyUnavailable", () => {
  it("namespaced id: not installed, not enabled, wrong skill, ok", () => {
    const base = () => readSkillSources(project, home);
    expect(whyUnavailable(base(), DESIGN)).toBe("plugin-not-installed");

    installPlugin("code-graph", ["use-code-architecture-design-check", "scribe"]);
    expect(whyUnavailable(base(), DESIGN)).toBe("plugin-not-enabled");

    enableInProject("code-graph");
    expect(whyUnavailable(base(), DESIGN)).toBeNull();
    expect(whyUnavailable(base(), "code-graph:nope")).toBe("skill-not-in-plugin");
  });

  it("enabled but the installed list is unreadable: enabled is taken as enough", () => {
    enableInProject("code-graph");
    expect(whyUnavailable(readSkillSources(project, home), "code-graph:anything")).toBeNull();
  });

  it("bare id resolves from a project skill, a user skill, or any installed plugin (enabled or not)", () => {
    writeJson(path.join(project, ".claude", "skills", "mine", "SKILL.md"), "---\nname: mine\n---\n");
    writeJson(path.join(home, ".claude", "skills", "yours", "SKILL.md"), "x");
    installPlugin("design", ["design-sketch"]);
    const s = readSkillSources(project, home);
    expect(whyUnavailable(s, "mine")).toBeNull();
    expect(whyUnavailable(s, "yours")).toBeNull();
    expect(whyUnavailable(s, "design-sketch")).toBeNull();
    expect(whyUnavailable(s, "ghost")).toBe("not-found");
  });

  it("firstAvailableSkill takes the first candidate that resolves", () => {
    installPlugin("code-graph", ["b"]);
    enableInProject("code-graph");
    const s = readSkillSources(project, home);
    expect(firstAvailableSkill(s, ["code-graph:a", "code-graph:b"])).toBe("code-graph:b");
    expect(firstAvailableSkill(s, ["x:y"])).toBeNull();
  });
});

describe("seedSkillsFor", () => {
  it("plugin not installed: no design check", () => {
    expect(seedSkillsFor(project, home)).toEqual({});
  });

  it("plugin installed but not enabled for this project: no design check", () => {
    installPlugin("code-graph", ["use-code-architecture-design-check"]);
    expect(seedSkillsFor(project, home)).toEqual({});
  });

  it("plugin enabled in the project: the namespaced design check seeds", () => {
    installPlugin("code-graph", ["use-code-architecture-design-check"]);
    enableInProject("code-graph");
    expect(seedSkillsFor(project, home)).toEqual({ designCheck: DESIGN });
  });

  it("plugin enabled by the user's settings only: seeds too", () => {
    installPlugin("code-graph", ["use-code-architecture-design-check"]);
    writeJson(path.join(home, ".claude", "settings.json"), { enabledPlugins: { "code-graph@maestro": true } });
    expect(seedSkillsFor(project, home)).toEqual({ designCheck: DESIGN });
  });

  it("plugin enabled but shipping no such skill: no design check", () => {
    installPlugin("code-graph", ["scribe"]);
    enableInProject("code-graph");
    expect(seedSkillsFor(project, home)).toEqual({});
  });

  it("the removed concept-skills plugin enabled: no design check", () => {
    installPlugin("concept-skills", ["use-code-architecture-design-check"]);
    enableInProject("concept-skills");
    expect(seedSkillsFor(project, home)).toEqual({});
  });

  it("no plugin: no design check and no error", () => {
    expect(seedSkillsFor(project, home)).toEqual({});
  });

  it("a bare project skill of the same name does not count: only the namespaced id seeds", () => {
    writeJson(
      path.join(project, ".claude", "skills", "use-code-architecture-design-check", "SKILL.md"),
      "---\nname: use-code-architecture-design-check\n---\n"
    );
    expect(seedSkillsFor(project, home)).toEqual({});
  });

  it("an empty project root yields nothing and does not throw", () => {
    expect(seedSkillsFor("", home)).toEqual({});
    expect(seedSkillsFor(path.join(tmp, "missing"), home)).toEqual({});
  });
});

describe("collectSkillRefs", () => {
  it("collects every place a config names a skill, with where", () => {
    const refs = collectSkillRefs({
      skills_available: ["a", " b "],
      workflow_instances: [{ name: "backend", loaded_skills: ["a"], referenced_skills: ["c"] }, "junk"],
      start_skills: { maestro: ["s1"], to_maestro_tasks: ["s2"] },
      end_skills: { maestro: ["e1"] },
      workflows: [
        { name: "Refactor", nodes: [{ type: "skill", skill: "d" }, { type: "agent" }, { type: "skill", skill: "" }] },
      ],
    });
    expect(refs.get("a")).toEqual(["skills_available", "instance backend loaded_skills"]);
    expect(refs.get("b")).toEqual(["skills_available"]);
    expect(refs.get("c")).toEqual(["instance backend referenced_skills"]);
    expect(refs.get("s1")).toEqual(["start_skills.maestro"]);
    expect(refs.get("s2")).toEqual(["start_skills.to_maestro_tasks"]);
    expect(refs.get("e1")).toEqual(["end_skills.maestro"]);
    expect(refs.get("d")).toEqual(["workflow Refactor skill node"]);
    expect(refs.size).toBe(7);
  });

  it.each([null, undefined, 3, "x", [], {}])("tolerates a non-config input %j", (input) => {
    expect(collectSkillRefs(input).size).toBe(0);
  });
});

describe("findStaleSkillRefs", () => {
  const cfg = {
    skills_available: [DESIGN, "ghost"],
    workflow_instances: [{ name: "scribe", loaded_skills: ["code-graph:scribe"], referenced_skills: [] }],
    start_skills: { maestro: [], to_maestro_tasks: [DESIGN] },
    workflows: [{ name: "Refactor", nodes: [{ type: "skill", skill: DESIGN }] }],
  };

  it("plugin not installed: namespaced ids dangle, with every location, and a bare unknown id too", () => {
    const report = findStaleSkillRefs(project, cfg, home);
    const byId = Object.fromEntries(report.dangling.map((d) => [d.id, d]));
    expect(byId[DESIGN].reason).toBe("plugin-not-installed");
    expect(byId[DESIGN].where).toEqual([
      "skills_available",
      "start_skills.to_maestro_tasks",
      "workflow Refactor skill node",
    ]);
    expect(byId["code-graph:scribe"].reason).toBe("plugin-not-installed");
    expect(byId["ghost"].reason).toBe("not-found");
    expect(report.suggestions.some((s) => s.includes("not installed"))).toBe(true);
  });

  it("plugin installed but disabled: reason plugin-not-enabled, suggestion says enable", () => {
    installPlugin("code-graph", ["use-code-architecture-design-check", "scribe"]);
    const report = findStaleSkillRefs(project, cfg, home);
    expect(report.dangling.find((d) => d.id === DESIGN)!.reason).toBe("plugin-not-enabled");
    expect(report.suggestions.join("\n")).toContain("installed but not enabled");
  });

  it("plugin enabled: only the genuinely missing id is left", () => {
    installPlugin("code-graph", ["use-code-architecture-design-check", "scribe"]);
    enableInProject("code-graph");
    const report = findStaleSkillRefs(project, cfg, home);
    expect(report.dangling.map((d) => d.id)).toEqual(["ghost"]);
  });

  it("enabled plugin that lacks a skill: skill-not-in-plugin", () => {
    installPlugin("code-graph", ["scribe"]);
    enableInProject("code-graph");
    const report = findStaleSkillRefs(project, cfg, home);
    expect(report.dangling.find((d) => d.id === DESIGN)!.reason).toBe("skill-not-in-plugin");
  });

  it("a bare skill from an installed-but-disabled plugin is NOT called dangling", () => {
    installPlugin("design", ["design-sketch"]);
    expect(findStaleSkillRefs(project, { skills_available: ["design-sketch"] }, home).dangling).toEqual([]);
  });

  it("legacy concept-skills.json with code-graph off: suggests migrating to code-graph", () => {
    writeJson(path.join(project, ".claude", "concept-skills.json"), { version: "1.0", last_update: "x" });
    const report = findStaleSkillRefs(project, {}, home);
    expect(report.dangling).toEqual([]);
    expect(report.suggestions).toHaveLength(1);
    expect(report.suggestions[0]).toContain("/code-graph-install");
    expect(report.suggestions[0]).toContain("code-graph");
    // code-graph is not in Maestro's marketplace: the hint must not tell anyone to install it from there.
    expect(report.suggestions[0]).not.toContain("@maestro");
    expect(report.suggestions[0]).toMatch(/not in Maestro's|its own marketplace/);
  });

  it("legacy concept-skills.json with code-graph enabled: no hint", () => {
    writeJson(path.join(project, ".claude", "concept-skills.json"), { version: "1.0", last_update: "x" });
    enableInProject("code-graph");
    expect(findStaleSkillRefs(project, {}, home).suggestions).toEqual([]);
  });

  it("scribe.config.json without code-graph enabled: suggests enabling code-graph, no migrate hint", () => {
    writeJson(path.join(project, "scribe.config.json"), {});
    const report = findStaleSkillRefs(project, {}, home);
    expect(report.dangling).toEqual([]);
    expect(report.suggestions).toHaveLength(1);
    expect(report.suggestions[0]).toContain("scribe.config.json");
    expect(report.suggestions[0]).toContain("code-graph");
    expect(report.suggestions[0]).not.toContain("/code-graph-install");
    expect(report.suggestions[0]).not.toContain("@maestro");
  });

  it("both missing-plugin hints name the exact marketplace-add and install commands (115)", () => {
    const add = "claude plugin marketplace add sdaigle-lichens/code-graph";
    const install = "claude plugin install code-graph@code-graph";
    writeJson(path.join(project, "scribe.config.json"), {});
    writeJson(path.join(project, ".claude", "concept-skills.json"), { version: "1.0", last_update: "x" });
    const { suggestions } = findStaleSkillRefs(project, {}, home);
    expect(suggestions).toHaveLength(2);
    for (const s of suggestions) {
      expect(s).toContain(add);
      expect(s).toContain(install);
      expect(s.indexOf(add)).toBeLessThan(s.indexOf(install));
    }
    expect(suggestions[0]).toBe(
      "This project has a scribe.config.json (a code-graph project) but the code-graph plugin is not enabled. " +
        `Install it from the code-graph marketplace (${add}, then ${install}) and enable it for this project.`
    );
  });

  it("scribe.config.json with code-graph enabled: the hint is absent", () => {
    writeJson(path.join(project, "scribe.config.json"), {});
    enableInProject("code-graph");
    expect(findStaleSkillRefs(project, {}, home).suggestions).toEqual([]);
  });

  it("scribe.config.json that is not a JSON object is ignored", () => {
    writeJson(path.join(project, "scribe.config.json"), "{ not json");
    expect(findStaleSkillRefs(project, {}, home).suggestions).toEqual([]);
  });

  it("scribe.config.json plus legacy concept-skills.json, code-graph off: both suggestions, neither claiming maestro's marketplace", () => {
    writeJson(path.join(project, "scribe.config.json"), {});
    writeJson(path.join(project, ".claude", "concept-skills.json"), { version: "1.0", last_update: "x" });
    const { suggestions } = findStaleSkillRefs(project, {}, home);
    expect(suggestions).toHaveLength(2);
    expect(suggestions.some((s) => s.includes("scribe.config.json"))).toBe(true);
    expect(suggestions.some((s) => s.includes("/code-graph-install"))).toBe(true);
    for (const s of suggestions) expect(s).not.toContain("@maestro");

    enableInProject("code-graph");
    expect(findStaleSkillRefs(project, {}, home).suggestions).toEqual([]);
  });

  it("no concept-skills.json and nothing dangling: clean", () => {
    expect(findStaleSkillRefs(project, { skills_available: [] }, home)).toEqual({ dangling: [], suggestions: [] });
  });

  it("never throws on a garbage config", () => {
    for (const bad of [null, undefined, 7, "x", [], { workflows: "x", workflow_instances: [null, 1] }]) {
      expect(() => findStaleSkillRefs(project, bad, home)).not.toThrow();
    }
  });
});
