// Tests for the save path that replaces Steps 2–4 of the /maestro-app skill, plus the rule
// applier it calls. The rule-move behaviour is checked differentially against the snapshotted
// legacy script; the vibe-rules branch is not exercised because that CLI isn't available in CI
// (its absence is itself a tested outcome — it surfaces as a warning, not a crash).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { saveConfig } from "../../src/core/save.js";
import { applyRules, targetDirFor } from "../../src/core/rules.js";
import { readConfig, writeConfig } from "../../src/core/config.js";
import { discoverProjectRules, discoverProjectTree } from "../../src/core/discovery.js";
import { defaultish } from "./fixtures/configs.js";
import type { MaestroConfigV3 } from "../../src/core/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// Snapshotted as .cjs, not .js: this package is "type": "module", so node would otherwise
// refuse to run the legacy script's `require`. The plugin copy keeps its .js name because the
// plugin directory has no package.json declaring module type.
const LEGACY_APPLY = path.join(here, "fixtures", "legacy", "maestro-apply-rules.cjs");

const SKILL_MD = [
  "<!-- Maestro:STEPS:START -->",
  "steps",
  "",
  "<!-- Maestro:HANDOFFS:START -->",
  "STALE",
  "<!-- Maestro:HANDOFFS:END -->",
  "<!-- Maestro:STEPS:END -->",
  "",
  "<!-- Maestro:PRINCIPLES:START -->",
  "principles",
  "<!-- Maestro:PRINCIPLES:END -->",
].join("\n");

let tmp: string;

function rule(id: string, description = ""): string {
  return `---\nname: ${id}\ndescription: ${description}\n---\n\nBody of ${id}.\n`;
}

/** A project with two root rules and a nested src/backend directory. */
function makeProject(root: string, opts: { withSkill?: boolean } = {}): void {
  fs.mkdirSync(path.join(root, ".claude", "rules"), { recursive: true });
  fs.mkdirSync(path.join(root, "src", "backend"), { recursive: true });
  fs.mkdirSync(path.join(root, "node_modules", "junk"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude", "rules", "python.md"), rule("python", "py style"));
  fs.writeFileSync(path.join(root, ".claude", "rules", "sql.md"), rule("sql", "sql style"));
  if (opts.withSkill) {
    fs.mkdirSync(path.join(root, ".claude", "skills", "maestro"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "skills", "maestro", "SKILL.md"), SKILL_MD);
  }
}

const rulesCfg: MaestroConfigV3 = {
  ...defaultish,
  rules: [
    { id: "python", scope: "project", source: "project" },
    { id: "sql", paths: ["src/backend/**"], source: "project" },
    { id: "ghost", paths: ["src/**"], source: "project" },
  ],
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-save-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("applyRules", () => {
  it("matches the legacy script's on-disk outcome", async () => {
    const mine = path.join(tmp, "mine");
    const theirs = path.join(tmp, "theirs");
    for (const root of [mine, theirs]) {
      makeProject(root);
      writeConfig(root, rulesCfg);
    }

    const summary = await applyRules(mine, rulesCfg);
    execFileSync("node", [LEGACY_APPLY, theirs], { encoding: "utf8" });

    const listing = (root: string) =>
      [
        fs.existsSync(path.join(root, ".claude", "rules", "python.md")),
        fs.existsSync(path.join(root, "src", "backend", ".claude", "rules", "sql.md")),
        fs.existsSync(path.join(root, ".claude", "rules", "sql.md")),
      ].join(",");

    expect(listing(mine)).toBe(listing(theirs));
    expect(summary.moved).toEqual([
      {
        id: "sql",
        from: path.join(".claude", "rules", "sql.md"),
        to: path.join("src", "backend", ".claude", "rules", "sql.md"),
      },
    ]);
    expect(summary.unchanged).toEqual([{ id: "python", dir: "" }]);
    expect(summary.missing).toEqual(["ghost"]);
  });

  it("is idempotent — a second run moves nothing", async () => {
    const root = path.join(tmp, "p");
    makeProject(root);
    await applyRules(root, rulesCfg);
    const second = await applyRules(root, rulesCfg);
    expect(second.moved).toEqual([]);
    expect(second.unchanged).toEqual([
      { id: "python", dir: "" },
      { id: "sql", dir: "src/backend" },
    ]);
  });

  it("never deletes a rule dropped from the config", async () => {
    const root = path.join(tmp, "p");
    makeProject(root);
    await applyRules(root, { rules: [] });
    expect(fs.existsSync(path.join(root, ".claude", "rules", "python.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".claude", "rules", "sql.md"))).toBe(true);
  });

  it("derives the target directory from a glob path", () => {
    expect(targetDirFor({ id: "a", paths: ["src/backend/**"] })).toBe("src/backend");
    expect(targetDirFor({ id: "a", paths: ["src/backend/"] })).toBe("src/backend");
    expect(targetDirFor({ id: "a", scope: "project" })).toBe("");
    expect(targetDirFor({ id: "a" })).toBe("");
  });
});

describe("discovery", () => {
  it("finds rules that a previous save moved into a subdirectory", async () => {
    const root = path.join(tmp, "p");
    makeProject(root);
    await applyRules(root, rulesCfg);
    const found = discoverProjectRules(root);
    expect(found.map((r) => [r.id, r.dir])).toEqual([
      ["python", ""],
      ["sql", path.join("src", "backend")],
    ]);
    expect(found[0].description).toBe("py style");
    expect(found[0].body.trim()).toBe("Body of python.");
  });

  it("skips ignored directories when walking the tree", () => {
    const root = path.join(tmp, "p");
    makeProject(root);
    const tree = discoverProjectTree(root).map((n) => n.path);
    expect(tree).toContain("src");
    expect(tree).toContain(path.join("src", "backend"));
    expect(tree.some((p) => p.includes("node_modules"))).toBe(false);
  });
});

describe("saveConfig", () => {
  it("writes the config, renders the orchestrator, and applies rules in one call", async () => {
    const root = path.join(tmp, "p");
    makeProject(root, { withSkill: true });

    const res = await saveConfig(root, {
      sliceType: "workflows",
      slice: {
        agents_available: defaultish.agents_available,
        skills_available: defaultish.skills_available,
        workflow_instances: defaultish.workflow_instances,
        workflows: defaultish.workflows,
      },
    });

    expect(res.render.ok).toBe(true);
    expect(res.render.rows).toEqual([
      { workflow: "default", successPath: "@backend → @test → human review → @scribe" },
    ]);
    const skill = fs.readFileSync(path.join(root, ".claude", "skills", "maestro", "SKILL.md"), "utf8");
    expect(skill).toContain("| default | @backend → @test → human review → @scribe |");
    expect(skill).not.toContain("STALE");
    expect(readConfig(root)!.workflows).toEqual(defaultish.workflows);
    expect(res.warnings).toEqual([]);
  });

  it("saves the config and warns rather than failing when Maestro is not installed", async () => {
    const root = path.join(tmp, "p");
    makeProject(root); // no orchestrator skill

    const res = await saveConfig(root, { sliceType: "rules", slice: { rules: rulesCfg.rules } });

    expect(res.render.ok).toBe(false);
    expect(res.render.reason).toBe("maestro/SKILL.md not found");
    expect(readConfig(root)!.rules).toEqual(rulesCfg.rules); // still persisted
    expect(res.warnings[0]).toContain("not installed");
    expect(res.warnings).toContain("Rule file not found for: ghost");
  });

  it("a workflows save preserves rules written by an earlier rules save", async () => {
    const root = path.join(tmp, "p");
    makeProject(root, { withSkill: true });

    await saveConfig(root, {
      sliceType: "rules",
      slice: { rules: [{ id: "python", scope: "project", source: "project" }] },
    });
    await saveConfig(root, {
      sliceType: "workflows",
      slice: {
        agents_available: ["backend"],
        skills_available: [],
        workflow_instances: defaultish.workflow_instances,
        workflows: defaultish.workflows,
      },
    });

    const after = readConfig(root)!;
    expect(after.rules).toEqual([{ id: "python", scope: "project", source: "project" }]);
    expect(after.agents_available).toEqual(["backend"]);
  });
});
