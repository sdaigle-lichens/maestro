// `041` — `plugins/maestro/scripts/maestro-render-orchestrator.cjs` must REPORT a duplicate-
// agent-type collision (never auto-repair it) and still re-render the orchestrator regardless —
// refusing to render would leave the project with a stale orchestrator, which is worse. This runs
// the real plugin script (not app-side render.ts, and not the legacy snapshot render.test.ts
// compares against), since the reporting behaviour lives only in the .cjs entry point.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { writeConfig } from "../../src/core/config.js";
import type { MaestroConfigV3 } from "../../src/core/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_SCRIPT = path.join(here, "../../../../plugins/maestro/scripts/maestro-render-orchestrator.cjs");

const SKILL_MD = [
  "---",
  "name: maestro",
  "description: orchestrator",
  "---",
  "",
  "<!-- Maestro:STEPS:START -->",
  "<!-- Maestro:HANDOFFS:START -->",
  "| Workflow | Success path |",
  "| --- | --- |",
  "| stale | @nobody |",
  "<!-- Maestro:HANDOFFS:END -->",
  "<!-- Maestro:STEPS:END -->",
  "",
].join("\n");

const duplicateConfig: MaestroConfigV3 = {
  version: 3,
  agents_available: ["backend"],
  skills_available: [],
  workflow_instances: [
    { name: "backend-api", agent: "backend", loaded_skills: [], referenced_skills: [] },
    { name: "backend-worker", agent: "backend", loaded_skills: [], referenced_skills: [] },
  ],
  workflows: [
    {
      name: "default",
      nodes: [
        { id: "api", type: "agent", instance: "backend-api" },
        { id: "worker", type: "agent", instance: "backend-worker" },
      ],
      edges: [
        { from: "main-session", to: "api", kind: "success" },
        { from: "api", to: "worker", kind: "success" },
      ],
    },
  ],
  rules: [],
};

let tmp: string;

function makeProject(cfg: MaestroConfigV3): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-render-cli-"));
  fs.mkdirSync(path.join(root, ".claude", "skills", "maestro"), { recursive: true });
  writeConfig(root, cfg);
  fs.writeFileSync(path.join(root, ".claude", "skills", "maestro", "SKILL.md"), SKILL_MD);
  return root;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-render-cli-parent-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("maestro-render-orchestrator.cjs — duplicate-agent-type reporting (041)", () => {
  it("reports the collision on stderr and still re-renders the orchestrator", () => {
    const root = makeProject(duplicateConfig);
    const result = spawnSync("node", [PLUGIN_SCRIPT, root], { encoding: "utf8" });
    // Never blocks — a stale orchestrator is worse than a rendered one plus a warning.
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("backend-api");
    expect(result.stderr).toContain("backend-worker");

    const rendered = fs.readFileSync(path.join(root, ".claude", "skills", "maestro", "SKILL.md"), "utf8");
    expect(rendered).not.toContain("| stale | @nobody |");
    expect(rendered).toContain("@backend-api");
  });

  it("reports nothing on stderr for a healthy config", () => {
    const healthy: MaestroConfigV3 = {
      ...duplicateConfig,
      workflow_instances: [{ name: "backend", agent: "backend", loaded_skills: [], referenced_skills: [] }],
      workflows: [
        {
          name: "default",
          nodes: [{ id: "api", type: "agent", instance: "backend" }],
          edges: [],
        },
      ],
    };
    const root = makeProject(healthy);
    const result = spawnSync("node", [PLUGIN_SCRIPT, root], { encoding: "utf8" });
    expect(result.status).toBe(0);
    // The point of this case: a clean config must produce a CLEAN stderr. Asserting only that
    // stdout says "re-rendered" would pass just as happily while every render warned.
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("re-rendered");
  });
});
