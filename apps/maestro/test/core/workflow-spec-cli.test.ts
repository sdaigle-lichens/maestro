// CLI-level coverage for `plugins/maestro/scripts/maestro-workflow-spec.cjs` — the only part of
// the create-workflow/update-workflow mechanism that touches the filesystem. Spawned as a REAL
// child process against a scratch fixture directory (never a copy inside `apps/maestro`'s own
// tree, and never mocking `applyWorkflowSpec` or stubbing `fs`), per task 063's write-discipline
// acceptance criteria (8 and 9 in
// `.claude/maestro-tasks/063-create-workflow-and-update-workflow-skills-over-a-workflow-spec-module.md`).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, "../../../../");
const CLI = path.join(REPO_ROOT, "plugins", "maestro", "scripts", "maestro-workflow-spec.cjs");

const HANDOFFS_MARKER_SKILL_MD = [
  "---",
  "name: maestro",
  "description: orchestrator",
  "---",
  "",
  "# Maestro",
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

// A config with every OTHER field populated, so a write-discipline test has something to lose if
// the CLI clobbers it.
function seedConfig() {
  return {
    version: 3,
    agents_available: ["backend", "reviewer"],
    skills_available: [],
    workflow_instances: [
      { name: "backend", agent: "backend", loaded_skills: [], referenced_skills: [] },
      { name: "reviewer", agent: "reviewer", loaded_skills: [], referenced_skills: [] },
    ],
    workflows: [
      {
        name: "existing",
        nodes: [{ id: "backend", type: "agent", instance: "backend", position: { x: 0, y: 140 } }],
        edges: [{ from: "main-session", to: "backend", kind: "success", sourceHandle: "bottom", targetHandle: "top" }],
      },
    ],
    rules: [{ id: "some-rule", scope: "project", paths: ["src/**"], origin: "project" }],
    reports: { backend: { kind: "seeded-fixture" } },
    handoffs: { "backend/reviewer": { kind: "seeded-fixture" } },
    runtimeVersion: "0.7.2",
    project_tags: ["fixture-tag"],
    gates: { confidence_check: true, use_code_architecture_design_check: false },
    use_maestro_tasks: true,
  };
}

let tmp: string;
let maestroJsonPath: string;
let skillMdPath: string;

function makeProject(cfg: unknown, skillMd: string | null = HANDOFFS_MARKER_SKILL_MD): void {
  fs.mkdirSync(path.dirname(maestroJsonPath), { recursive: true });
  fs.writeFileSync(maestroJsonPath, JSON.stringify(cfg, null, 2));
  if (skillMd !== null) {
    fs.mkdirSync(path.dirname(skillMdPath), { recursive: true });
    fs.writeFileSync(skillMdPath, skillMd);
  }
}

function writeSpecFile(spec: unknown): string {
  const p = path.join(tmp, "spec.json");
  fs.writeFileSync(p, JSON.stringify(spec));
  return p;
}

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("node", [CLI, ...args, tmp], { encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-workflow-spec-cli-"));
  maestroJsonPath = path.join(tmp, ".claude", "maestro.json");
  skillMdPath = path.join(tmp, ".claude", "skills", "maestro", "SKILL.md");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("maestro-workflow-spec.cjs write discipline (acceptance criterion 8)", () => {
  it("leaves every field other than the workflow slice byte-identical after a successful create", () => {
    const seeded = seedConfig();
    makeProject(seeded);
    const specPath = writeSpecFile({ name: "brand-new", steps: ["backend"] });

    const result = runCli(["create", "--spec-file", specPath]);
    expect(result.status).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary.ok).toBe(true);

    const after = JSON.parse(fs.readFileSync(maestroJsonPath, "utf8"));
    // The workflow slice IS expected to change.
    expect(after.workflows.some((w: { name: string }) => w.name === "brand-new")).toBe(true);
    // Everything else must be untouched — rules, gates, reports, handoffs, runtimeVersion,
    // project_tags, use_maestro_tasks.
    expect(after.rules).toEqual(seeded.rules);
    expect(after.gates).toEqual(seeded.gates);
    expect(after.reports).toEqual(seeded.reports);
    expect(after.handoffs).toEqual(seeded.handoffs);
    expect(after.runtimeVersion).toEqual(seeded.runtimeVersion);
    expect(after.project_tags).toEqual(seeded.project_tags);
    expect(after.use_maestro_tasks).toEqual(seeded.use_maestro_tasks);
  });

  it("re-reads the config fresh on every invocation — a change made by another writer between two CLI calls survives", () => {
    makeProject(seedConfig());
    const spec1 = writeSpecFile({ name: "first", steps: ["backend"] });
    expect(runCli(["create", "--spec-file", spec1]).status).toBe(0);

    // Simulate a second, concurrent writer (the app's /rules route, say) touching a field this
    // CLI must never revert.
    const midway = JSON.parse(fs.readFileSync(maestroJsonPath, "utf8"));
    midway.rules = [{ id: "injected-by-another-writer", scope: "project", paths: ["mid/**"], origin: "project" }];
    fs.writeFileSync(maestroJsonPath, JSON.stringify(midway, null, 2));

    const spec2 = writeSpecFile({ name: "second", steps: ["reviewer"] });
    expect(runCli(["create", "--spec-file", spec2]).status).toBe(0);

    const final = JSON.parse(fs.readFileSync(maestroJsonPath, "utf8"));
    expect(final.rules).toEqual(midway.rules);
    expect(final.workflows.map((w: { name: string }) => w.name)).toEqual(
      expect.arrayContaining(["existing", "first", "second"])
    );
  });

  it("writes nothing at all when applyWorkflowSpec returns errors, and exits non-zero", () => {
    makeProject(seedConfig());
    const before = fs.readFileSync(maestroJsonPath, "utf8");
    const beforeMtime = fs.statSync(maestroJsonPath).mtimeMs;

    // "existing" already exists — a `create` on it must be rejected outright.
    const specPath = writeSpecFile({ name: "existing", steps: ["backend"] });
    const result = runCli(["create", "--spec-file", specPath]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/already exists/i);

    const after = fs.readFileSync(maestroJsonPath, "utf8");
    const afterMtime = fs.statSync(maestroJsonPath).mtimeMs;
    expect(after).toBe(before);
    expect(afterMtime).toBe(beforeMtime);
  });

  it("writes nothing when the spec names an unavailable agent, and exits non-zero", () => {
    makeProject(seedConfig());
    const before = fs.readFileSync(maestroJsonPath, "utf8");

    const specPath = writeSpecFile({ name: "brand-new-2", steps: ["nope-not-offered"] });
    const result = runCli(["create", "--spec-file", specPath]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/available/i);
    expect(fs.readFileSync(maestroJsonPath, "utf8")).toBe(before);
  });
});

describe("maestro-workflow-spec.cjs post-write consequences (acceptance criterion 9)", () => {
  it("updates the orchestrator's Maestro:HANDOFFS table with a row for the new workflow", () => {
    makeProject(seedConfig());
    const specPath = writeSpecFile({ name: "documented-flow", steps: ["backend", "reviewer"] });
    const result = runCli(["create", "--spec-file", specPath]);
    expect(result.status).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary.render.ok).toBe(true);

    const skillMd = fs.readFileSync(skillMdPath, "utf8");
    expect(skillMd).toMatch(/\| documented-flow \|/);
    expect(skillMd).not.toMatch(/\| stale \| @nobody \|/);

    // Independently confirm the re-rendered table matches what the renderer itself would produce
    // right now (i.e. the same check the readiness hook's check-5 makes) — the table is not
    // merely present, it AGREES with the config on disk.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { handoffTable } = require(path.join(REPO_ROOT, "plugins/maestro/scripts/maestro-render-orchestrator.cjs"));
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { extractRegion } = require(path.join(REPO_ROOT, "plugins/maestro/scripts/lib/maestro-skill-regions.cjs"));
    const cfgAfter = JSON.parse(fs.readFileSync(maestroJsonPath, "utf8"));
    const rendered = extractRegion(skillMd, "HANDOFFS");
    expect(rendered?.trim()).toBe(handoffTable(cfgAfter).trim());
  });

  it("updates the row for a changed (not just new) workflow on update", () => {
    makeProject(seedConfig());
    const specPath = writeSpecFile({ name: "existing", steps: ["backend", "reviewer"] });
    const result = runCli(["update", "--spec-file", specPath]);
    expect(result.status).toBe(0);

    const skillMd = fs.readFileSync(skillMdPath, "utf8");
    expect(skillMd).toMatch(/\| existing \| @backend → @reviewer \|/);
  });

  it("does NOT touch runtimeVersion — a workflow write is not a runtime install/update", () => {
    // Documented judgment call (see final report): `runtimeVersion` is the one machine-owned
    // field, stamped only by installRuntime()/maestro-install.js. A workflow-spec write
    // correctly leaves it alone; check 6 of maestro-check-runtime.cjs (runtimeVersion vs the
    // installed plugin version) is orthogonal to what this CLI does and is not something this
    // write should ever cause to change.
    const seeded = seedConfig();
    makeProject(seeded);
    const specPath = writeSpecFile({ name: "brand-new-3", steps: ["backend"] });
    expect(runCli(["create", "--spec-file", specPath]).status).toBe(0);
    const after = JSON.parse(fs.readFileSync(maestroJsonPath, "utf8"));
    expect(after.runtimeVersion).toBe(seeded.runtimeVersion);
  });
});

describe("maestro-workflow-spec.cjs to-spec (read-only)", () => {
  it("prints the current spec for an existing workflow without writing anything", () => {
    makeProject(seedConfig());
    const before = fs.readFileSync(maestroJsonPath, "utf8");
    const result = execFileSync("node", [CLI, "to-spec", "--name", "existing", tmp], { encoding: "utf8" });
    const spec = JSON.parse(result);
    expect(spec).toEqual({ name: "existing", steps: ["backend"] });
    expect(fs.readFileSync(maestroJsonPath, "utf8")).toBe(before);
  });
});
