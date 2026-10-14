// `090`: Maestro names no concept skill; the opt-in `concept-skills` plugin supplies them. Pinned here:
//   - the first-install seed with the plugin enabled vs not (design check, scribe loaded_skills);
//   - the pure seed (`defaultV3Config`) given and not given a design check;
//   - a `concept-skills:…` id in `loaded_skills` passing through the real SubagentStart hook, in both
//     the project copy and the plugin's own copy;
//   - the "grep finds nothing left" acceptance criterion, as a test that fails when one comes back.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig, readConfig } from "../../src/core/config.js";
import { defaultV3Config } from "../../src/core/seed.js";
import { SEED_HANDOFFS } from "../../src/core/handoff-seeds.js";
import { readAllAgentReportDefaults } from "../../src/core/report-defaults.js";
import { pinnedEnv } from "../helpers/env.js";
import type { MaestroConfigV3 } from "../../src/core/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const DESIGN = "concept-skills:use-code-architecture-design-check";
const SESSION = "concept-skills-plugin-test";

let tmp: string;
let REPORTS_DB: string;
let PROJECT_TAGS_DB: string;
let HANDOFFS_DB: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-concept-plugin-"));
  REPORTS_DB = path.join(tmp, "report-defaults.sqlite");
  PROJECT_TAGS_DB = path.join(tmp, "project-tags.sqlite");
  HANDOFFS_DB = path.join(tmp, "handoff-defaults.sqlite");
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function makeProject(name: string, enablePlugin: boolean): string {
  const root = path.join(tmp, name);
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  if (enablePlugin) {
    // settings.local.json: installRuntime owns settings.json's hooks, never this file.
    fs.writeFileSync(
      path.join(root, ".claude", "settings.local.json"),
      JSON.stringify({ enabledPlugins: { "concept-skills@maestro": true } })
    );
  }
  return root;
}

const install = (root: string) => installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

const skillNodes = (cfg: MaestroConfigV3) =>
  cfg.workflows.flatMap((w) => w.nodes.filter((n) => n.type === "skill")).map((n) => (n as { skill: string }).skill);

describe("first-install seeding: plugin disabled vs enabled", () => {
  it("disabled: no concept-skill id anywhere in the seeded config", async () => {
    const root = makeProject("off", false);
    await install(root);
    const cfg = readConfig(root)!;
    expect(JSON.stringify(cfg)).not.toContain("concept-skills");
    expect(JSON.stringify(cfg)).not.toContain("architecture-design");
    expect(skillNodes(cfg)).toEqual([]);
    const refactor = cfg.workflows.find((w) => w.name === "Refactor")!;
    expect(refactor.nodes.map((n) => n.id)).toEqual(["human_review-1", "refactor"]);
    expect(cfg.start_skills!.to_maestro_tasks).toEqual(["confidence-check"]);
    expect(cfg.start_skills!.maestro).toEqual([]);
    expect(cfg.end_skills!.maestro).toEqual([]);
  });

  it("enabled: the namespaced design check seeds into skills_available, the Refactor node and to_maestro_tasks", async () => {
    const root = makeProject("on", true);
    await install(root);
    const cfg = readConfig(root)!;
    expect(cfg.skills_available).toContain(DESIGN);
    expect(skillNodes(cfg)).toEqual([DESIGN]);
    const refactor = cfg.workflows.find((w) => w.name === "Refactor")!;
    expect(refactor.nodes.map((n) => n.id)[0]).toBe(DESIGN);
    expect(cfg.start_skills!.to_maestro_tasks).toEqual(["confidence-check", DESIGN]);
    // The orchestrator's own start list stays opt-in: the plugin being on does not turn it on.
    expect(cfg.start_skills!.maestro).toEqual([]);
  });

  it("enabled or not, the scribe instance seeds with no loaded skills and no bare design-check id", async () => {
    for (const enabled of [false, true]) {
      const root = makeProject(`scribe-${enabled}`, enabled);
      await install(root);
      const cfg = readConfig(root)!;
      const scribe = cfg.workflow_instances.find((i) => i.name === "scribe")!;
      expect(scribe.loaded_skills).toEqual([]);
      expect(cfg.skills_available).not.toContain("use-code-architecture-design-check");
      expect(cfg.skills_available).not.toContain("concept-skills:scribe");
    }
  });

  it("an existing maestro.json is never rewritten to add the design check when the plugin is switched on later", async () => {
    const root = makeProject("later", false);
    await install(root);
    const before = readConfig(root)!;
    fs.writeFileSync(
      path.join(root, ".claude", "settings.local.json"),
      JSON.stringify({ enabledPlugins: { "concept-skills@maestro": true } })
    );
    await install(root);
    expect(readConfig(root)!.skills_available).toEqual(before.skills_available);
    expect(skillNodes(readConfig(root)!)).toEqual([]);
  });

  it("the plugin switched off in settings.local.json overrides nothing: still disabled", async () => {
    const root = makeProject("explicit-off", false);
    fs.writeFileSync(
      path.join(root, ".claude", "settings.local.json"),
      JSON.stringify({ enabledPlugins: { "concept-skills@maestro": false } })
    );
    await install(root);
    expect(skillNodes(readConfig(root)!)).toEqual([]);
  });
});

describe("defaultV3Config (the pure seed)", () => {
  it("with no design check names none; with one it names it in all three places", () => {
    const without = defaultV3Config(["backend"], {}, {});
    expect(skillNodes(without)).toEqual([]);
    expect(without.skills_available).not.toContain(DESIGN);
    expect(without.start_skills!.to_maestro_tasks).toEqual(["confidence-check"]);

    const withDesign = defaultV3Config(["backend"], {}, { designCheck: DESIGN });
    expect(skillNodes(withDesign)).toEqual([DESIGN]);
    expect(withDesign.skills_available).toContain(DESIGN);
    expect(withDesign.start_skills!.to_maestro_tasks).toEqual(["confidence-check", DESIGN]);
  });

  it("the infra-only profile has no Refactor workflow but still offers the design check", () => {
    const cfg = defaultV3Config(["infra"], {}, { designCheck: DESIGN });
    expect(cfg.workflows.some((w) => w.name === "Refactor")).toBe(false);
    expect(cfg.skills_available).toContain(DESIGN);
  });

  it("the default (no seedSkills argument) is the disabled seed", () => {
    expect(JSON.stringify(defaultV3Config(["backend"]))).not.toContain("concept-skills");
  });
});

describe("a concept-skills:… id in loaded_skills through the SubagentStart hook", () => {
  const cfg: MaestroConfigV3 = {
    version: 3,
    agents_available: ["scribe"],
    skills_available: ["concept-skills:scribe", "concept-skills:explore-concept-skills"],
    workflow_instances: [
      {
        name: "scribe",
        agent: "scribe",
        loaded_skills: ["concept-skills:scribe"],
        referenced_skills: ["concept-skills:explore-concept-skills"],
      },
    ],
    workflows: [
      {
        name: "Documentation",
        nodes: [{ id: "scribe", type: "agent", instance: "scribe" }],
        edges: [{ from: "main-session", to: "scribe", kind: "success", sourceHandle: "bottom", targetHandle: "top" }],
      },
    ],
    rules: [],
  };

  function contextOf(stdout: string): string {
    return JSON.parse(stdout).hookSpecificOutput.additionalContext as string;
  }

  function hook(script: string, root: string): string {
    return execFileSync("node", [script], {
      input: JSON.stringify({ cwd: root, agent_type: "scribe" }),
      encoding: "utf8",
      env: pinnedEnv(tmp, { CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_SESSION_ID: SESSION }),
    });
  }

  it("project copy: the namespaced id survives unchanged into the injected skill list", async () => {
    const root = makeProject("hook-project", true);
    writeConfig(root, cfg);
    await install(root);
    const ctx = contextOf(hook(path.join(root, ".claude", "scripts", "maestro-inject-agent-context.cjs"), root));
    expect(ctx).toContain("concept-skills:scribe");
    expect(ctx).toContain("concept-skills:explore-concept-skills");
    // It is passed through, not "resolved" into a project path or reported missing.
    expect(ctx).not.toMatch(/concept-skills:scribe[^\n]*(not found|unresolved|missing)/i);
    expect(ctx).not.toMatch(/\.claude\/skills\/concept-skills/);
  });

  it("plugin copy: the same", () => {
    const root = makeProject("hook-plugin", true);
    writeConfig(root, cfg);
    const ctx = contextOf(hook(path.join(PLUGIN_ROOT, "scripts", "maestro-inject-agent-context.js"), root));
    expect(ctx).toContain("concept-skills:scribe");
    expect(ctx).not.toMatch(/\.claude\/skills\/concept-skills/);
  });

  it("a seeded scribe with the plugin disabled gets no concept-skill instructions injected", async () => {
    const root = makeProject("hook-off", false);
    await install(root);
    const ctx = contextOf(hook(path.join(root, ".claude", "scripts", "maestro-inject-agent-context.cjs"), root));
    expect(ctx).not.toMatch(/concept[- ]skill/i);
    expect(ctx).not.toContain("concept-skills");
  });
});

describe("Maestro names no concept skill (acceptance: grep finds nothing left)", () => {
  const PLUGINS_MAESTRO = path.resolve(here, "../../../../plugins/maestro");

  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(p);
      return [p];
    });
  }
  const files = walk(PLUGINS_MAESTRO);

  // The removed skills, script and CLI, by name. `use-code-architecture-design-check` is allowed in
  // exactly one place: the availability lib's namespaced candidate.
  const REMOVED = [
    "create-concept-skills",
    "update-concept-skills",
    "update-single-concept-skill",
    "load-concept-skills",
    "explore-concept-skills",
    "maestro-concept-skills",
  ];

  it("no removed concept-skill skill directory or script ships under plugins/maestro", () => {
    for (const f of files) {
      const rel = path.relative(PLUGINS_MAESTRO, f);
      expect(rel, rel).not.toMatch(/concept-skills\.cjs$/);
      expect(rel, rel).not.toMatch(/skills\/(scribe|code-architecture-design|use-code-architecture-design-check)\//);
      for (const name of REMOVED) expect(rel, rel).not.toContain(name);
    }
  });

  it("no file names a removed skill, script or CLI", () => {
    const hits: string[] = [];
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      for (const name of REMOVED) if (text.includes(name)) hits.push(`${path.relative(PLUGINS_MAESTRO, f)}: ${name}`);
    }
    expect(hits).toEqual([]);
  });

  it("use-code-architecture-design-check appears only as the availability lib's namespaced candidate", () => {
    const hits = files
      .filter((f) => fs.readFileSync(f, "utf8").includes("use-code-architecture-design-check"))
      .map((f) => path.relative(PLUGINS_MAESTRO, f));
    expect(hits).toEqual(["scripts/lib/maestro-skill-availability.cjs"]);
    const lib = fs.readFileSync(path.join(PLUGINS_MAESTRO, hits[0]), "utf8");
    expect(lib).toContain('"concept-skills:use-code-architecture-design-check"');
    expect(lib.replace('"concept-skills:use-code-architecture-design-check"', "")).not.toContain(
      "use-code-architecture-design-check"
    );
  });

  it("prose (skills, agents, templates, hooks, manifest) says nothing about concept skills, bar one named exception", () => {
    const allowed = new Set([
      // Advisory for a project that keeps .claude/concept-skills.json.
      "scripts/maestro-stale-refs.cjs",
    ]);
    const hits = files
      .map((f) => path.relative(PLUGINS_MAESTRO, f))
      .filter((rel) => !rel.startsWith("scripts/lib/")) // generated bundles: checked below
      .filter((rel) => !allowed.has(rel))
      .filter((rel) => /concept[-_ ]?skill/i.test(fs.readFileSync(path.join(PLUGINS_MAESTRO, rel), "utf8")));
    expect(hits).toEqual([]);
  });

  it("the old gap/count fields appear in the generated bundles only inside superseded prior bodies", () => {
    // Bundles keep the old text on purpose (stored defaults upgrade by matching it). Everything the
    // app CURRENTLY seeds or ships must be clean — that is what an agent is actually told.
    for (const body of Object.values(SEED_HANDOFFS)) {
      expect(body).not.toContain("concept_skill_gaps");
      expect(body).not.toMatch(/concept/i);
    }
    const fresh = readAllAgentReportDefaults(path.join(tmp, "fresh-reports.sqlite"));
    for (const [agent, row] of Object.entries(fresh)) {
      expect(row.content, agent).not.toMatch(/concept/i);
      expect(row.content, agent).not.toContain("conceptSkillsUpdated");
      expect(row.content, agent).not.toContain("conceptSkillGaps");
    }
    expect(fresh.scribe.content).toContain("claudeFilesUpdated");
    expect(fresh.backend.content).toContain('"skill_gaps"');

    // The plugin's scribe agent has no Trigger 5 and the orchestrator template no explore line.
    const scribe = fs.readFileSync(path.join(PLUGINS_MAESTRO, "agents", "scribe.md"), "utf8");
    expect(scribe).not.toMatch(/trigger 5/i);
    const tpl = fs.readFileSync(path.join(PLUGINS_MAESTRO, "templates", "maestro", "SKILL.md"), "utf8");
    expect(tpl).not.toMatch(/explore-concept/i);
  });

  it("the sibling plugin is the only place the concept-skill machinery lives", () => {
    const sibling = path.resolve(PLUGINS_MAESTRO, "../concept-skills");
    for (const rel of [
      "scripts/concept-skills.cjs",
      "scripts/lib/concept-skills.cjs",
      "skills/scribe/SKILL.md",
      "skills/use-code-architecture-design-check/SKILL.md",
      "skills/concept-skills-install/SKILL.md",
      "skills/concept-skills-update/SKILL.md",
      "skills/concept-skills-uninstall/SKILL.md",
    ]) {
      expect(fs.existsSync(path.join(sibling, rel)), rel).toBe(true);
    }
  });
});
