// End-to-end byte-identity check for the orchestrator renderer.
//
// This is the load-bearing test for milestone M1: the desktop app's save path replaces a
// `node maestro-render-orchestrator.cjs` shell-out that a Claude session used to run. If the
// two produce different bytes, every project that upgrades gets a spurious diff in its
// committed .claude/skills/maestro/SKILL.md.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { renderOrchestrator, handoffTable, successPath } from "../../src/core/render.js";
import { writeConfig, readConfig, serializeConfig, mergeSlice, blankConfig } from "../../src/core/config.js";
import { allConfigs, defaultish } from "./fixtures/configs.js";
import type { MaestroConfigV3 } from "../../src/core/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const LEGACY_DIR = path.join(here, "fixtures", "legacy");

const SKILL_MD = [
  "---",
  "name: maestro",
  "description: orchestrator",
  "---",
  "",
  "# Maestro",
  "",
  "User prose that must survive.",
  "",
  "<!-- Maestro:STEPS:START -->",
  "Step 0 ...",
  "",
  "<!-- Maestro:HANDOFFS:START -->",
  "| Workflow | Success path |",
  "| --- | --- |",
  "| stale | @nobody |",
  "<!-- Maestro:HANDOFFS:END -->",
  "<!-- Maestro:STEPS:END -->",
  "",
  "<!-- Maestro:PRINCIPLES:START -->",
  "Principles ...",
  "<!-- Maestro:PRINCIPLES:END -->",
  "",
].join("\n");

let tmp: string;

function makeProject(root: string, cfg: MaestroConfigV3, skillMd: string | null = SKILL_MD): void {
  fs.mkdirSync(path.join(root, ".claude", "skills", "maestro"), { recursive: true });
  writeConfig(root, cfg);
  if (skillMd !== null) {
    fs.writeFileSync(path.join(root, ".claude", "skills", "maestro", "SKILL.md"), skillMd);
  }
}

/** Run the snapshotted legacy renderer against a project dir, with its libs alongside it. */
function runLegacyRenderer(projectRoot: string): string {
  const scriptDir = path.join(tmp, "legacy-scripts");
  if (!fs.existsSync(scriptDir)) {
    fs.mkdirSync(path.join(scriptDir, "lib"), { recursive: true });
    fs.copyFileSync(
      path.join(LEGACY_DIR, "maestro-render-orchestrator.cjs"),
      path.join(scriptDir, "maestro-render-orchestrator.cjs")
    );
    for (const lib of ["maestro-session.cjs", "maestro-skill-regions.cjs"]) {
      fs.copyFileSync(path.join(LEGACY_DIR, lib), path.join(scriptDir, "lib", lib));
    }
  }
  execFileSync("node", [path.join(scriptDir, "maestro-render-orchestrator.cjs"), projectRoot], {
    encoding: "utf8",
  });
  return fs.readFileSync(path.join(projectRoot, ".claude", "skills", "maestro", "SKILL.md"), "utf8");
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-core-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("renderOrchestrator", () => {
  for (const [name, cfg] of Object.entries(allConfigs)) {
    it(`produces byte-identical output to the legacy .cjs for "${name}"`, () => {
      const mine = path.join(tmp, "mine");
      const theirs = path.join(tmp, `theirs-${name}`);
      makeProject(mine, cfg);
      makeProject(theirs, cfg);

      const res = renderOrchestrator(mine);
      expect(res.ok).toBe(true);

      const mineText = fs.readFileSync(path.join(mine, ".claude", "skills", "maestro", "SKILL.md"), "utf8");
      expect(mineText).toBe(runLegacyRenderer(theirs));
    });
  }

  it("preserves prose outside the managed regions", () => {
    const root = path.join(tmp, "p");
    makeProject(root, defaultish);
    renderOrchestrator(root);
    const text = fs.readFileSync(path.join(root, ".claude", "skills", "maestro", "SKILL.md"), "utf8");
    expect(text).toContain("User prose that must survive.");
    expect(text).toContain("Principles ...");
    expect(text).not.toContain("| stale | @nobody |");
  });

  it("reports the rendered rows so a caller need not re-read the file", () => {
    const root = path.join(tmp, "p");
    makeProject(root, defaultish);
    expect(renderOrchestrator(root).rows).toEqual([
      { workflow: "default", successPath: "@backend → @test → human review → @scribe" },
    ]);
  });

  it("fails cleanly when maestro.json is absent", () => {
    const root = path.join(tmp, "p");
    fs.mkdirSync(path.join(root, ".claude", "skills", "maestro"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "skills", "maestro", "SKILL.md"), SKILL_MD);
    expect(renderOrchestrator(root)).toMatchObject({ ok: false, reason: "maestro.json not found" });
  });

  it("fails cleanly when the orchestrator skill is absent", () => {
    const root = path.join(tmp, "p");
    makeProject(root, defaultish, null);
    expect(renderOrchestrator(root)).toMatchObject({ ok: false, reason: "maestro/SKILL.md not found" });
  });

  it("renders the empty-workflow placeholder", () => {
    expect(handoffTable({ workflow_instances: [], workflows: [] })).toBe(
      "# No workflows configured yet. Run /maestro-install to set up."
    );
  });

  it("derives the success path through non-agent nodes", () => {
    const wf = defaultish.workflows[0];
    expect(successPath(wf, defaultish.workflow_instances)).toBe("@backend → @test → human review → @scribe");
  });
});

describe("config read/write", () => {
  it("writes the canonical format: 2-space indent, no trailing newline", () => {
    const root = path.join(tmp, "p");
    fs.mkdirSync(root, { recursive: true });
    writeConfig(root, defaultish);
    const raw = fs.readFileSync(path.join(root, ".claude", "maestro.json"), "utf8");
    expect(raw).toBe(serializeConfig(defaultish));
    expect(raw.endsWith("\n")).toBe(false);
    expect(raw.split("\n")[1]).toMatch(/^ {2}"/);
  });

  it("round-trips without changing bytes", () => {
    const root = path.join(tmp, "p");
    fs.mkdirSync(root, { recursive: true });
    writeConfig(root, defaultish);
    const first = fs.readFileSync(path.join(root, ".claude", "maestro.json"), "utf8");
    writeConfig(root, readConfig(root)!);
    expect(fs.readFileSync(path.join(root, ".claude", "maestro.json"), "utf8")).toBe(first);
  });

  it("returns null for a missing file and a blank config for a corrupt one", () => {
    const root = path.join(tmp, "p");
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    expect(readConfig(root)).toBeNull();
    fs.writeFileSync(path.join(root, ".claude", "maestro.json"), "{ not json");
    expect(readConfig(root)).toEqual(blankConfig());
    fs.writeFileSync(path.join(root, ".claude", "maestro.json"), JSON.stringify({ version: 2 }));
    expect(readConfig(root)).toEqual(blankConfig());
  });

  it("a workflows save leaves the rules slice intact", () => {
    const merged = mergeSlice(defaultish, {
      sliceType: "workflows",
      slice: {
        agents_available: ["backend"],
        skills_available: [],
        workflow_instances: [],
        workflows: [],
      },
    });
    expect(merged.rules).toEqual(defaultish.rules);
    expect(merged.workflows).toEqual([]);
  });

  it("a rules save leaves the workflow slice intact", () => {
    const merged = mergeSlice(defaultish, { sliceType: "rules", slice: { rules: [] } });
    expect(merged.rules).toEqual([]);
    expect(merged.workflows).toEqual(defaultish.workflows);
    expect(merged.workflow_instances).toEqual(defaultish.workflow_instances);
  });
});
