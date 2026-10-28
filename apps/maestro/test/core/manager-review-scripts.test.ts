// Task 131 through the REAL installed scripts: the TaskCreate validation hook and the
// `maestro-task-status.cjs plan / plan-step` commands accept the `manager review` label, and a
// manager_review node survives a maestro.json save/reload. HOME pinned, CLAUDE_CODE_SESSION_ID set —
// see test-maestro's references/hook-script-tests.md.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { readConfig, writeConfig } from "../../src/core/config.js";
import { handoffRoutes } from "../../src/core/handoff-routes.js";
import { successPathSteps } from "../../src/core/success-path.js";
import { applyWorkflowSpec } from "../../src/core/workflow-spec.js";
import { defaultV3Config } from "../../src/core/seed.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
vi.setConfig({ testTimeout: 30_000 });

const SESS = "sess-131-aaa";
const DIRECTION = "manager requested direction change";

let tmp: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-131-")));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function buildConfig() {
  const base = defaultV3Config(["backend", "reviewer"]);
  const r = applyWorkflowSpec(
    base,
    {
      name: "reviewed",
      steps: ["backend", "manager_review-1", "reviewer"],
      conditions: [{ from: "manager_review-1", to: "backend", label: DIRECTION }],
    },
    "create"
  );
  expect(r.errors).toEqual([]);
  return r.config;
}

async function installed() {
  const root = path.join(tmp, "repo");
  fs.mkdirSync(root, { recursive: true });
  writeConfig(root, buildConfig());
  await installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "report-defaults.sqlite"),
    path.join(tmp, "project-tags.sqlite"),
    path.join(tmp, "handoff-defaults.sqlite")
  );
  const dir = path.join(root, ".claude", "maestro_sessions", SESS);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "session.json"),
    JSON.stringify({ workflow: "reviewed", generated_instances: [], run_id: "run-131" })
  );
  return { root, dir };
}

function env(root: string): NodeJS.ProcessEnv {
  return { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: tmp, CLAUDE_CODE_SESSION_ID: SESS };
}

function run(root: string, name: string, args: string[], input?: unknown) {
  const r = spawnSync("node", [path.join(root, ".claude", "scripts", name), ...args], {
    encoding: "utf8",
    env: env(root),
    ...(input !== undefined ? { input: JSON.stringify(input) } : {}),
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function taskCreate(root: string, subject: string, description = "", metadata?: Record<string, string>) {
  return run(root, "maestro-validate-tasks.cjs", [], {
    cwd: root,
    session_id: SESS,
    hook_event_name: "PostToolUse",
    tool_name: "TaskCreate",
    tool_input: { subject, description, ...(metadata ? { metadata } : {}) },
  });
}

describe("maestro-validate-tasks with a manager_review node", () => {
  it("resolves a 'Manager review' task by heuristic and tracks it as `manager review`", async () => {
    const { root, dir } = await installed();
    expect(taskCreate(root, "@backend: build it").code).toBe(0);
    const r = taskCreate(root, "Manager review of the change");
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(""); // no mismatch, nothing skipped
    const tracked = JSON.parse(fs.readFileSync(path.join(dir, "tasks.json"), "utf8"));
    expect(tracked.steps).toEqual(["@backend", "manager review"]);
  });

  it("does not file a manager review task under `human review`", async () => {
    const { root, dir } = await installed();
    taskCreate(root, "manager_review gate");
    const tracked = JSON.parse(fs.readFileSync(path.join(dir, "tasks.json"), "utf8"));
    expect(tracked.steps).toEqual(["manager review"]);
  });

  it("warns that earlier steps were skipped when manager review is created first", async () => {
    const { root } = await installed();
    const r = taskCreate(root, "x", "", { maestro_step: "manager review" });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("@backend");
    expect(r.stdout).toContain("manager review");
    expect(r.stdout).not.toContain("doesn't match any step");
  });

  it("warns that `human review` is not a step of a workflow with only a manager review", async () => {
    const { root } = await installed();
    const r = taskCreate(root, "x", "", { maestro_step: "human review" });
    expect(r.stdout).toContain("doesn't match any step");
  });
});

describe("maestro-task-status plan with `manager review`", () => {
  it("records the label, steps it done and refuses `done` while it is pending", async () => {
    const { root, dir } = await installed();
    const plan = run(root, "maestro-task-status.cjs", ["plan", "@backend", "manager review", "@reviewer"]);
    expect(plan.code, plan.stderr).toBe(0);
    expect(plan.stdout).toContain("recorded 3 step(s)");

    run(root, "maestro-task-status.cjs", ["plan-step", "@backend", "done"]);
    const step = run(root, "maestro-task-status.cjs", ["plan-step", "manager review", "done"]);
    expect(step.code, step.stderr).toBe(0);
    const state = JSON.parse(fs.readFileSync(path.join(dir, "session.json"), "utf8"));
    expect(state.plan.steps.map((s: { status: string }) => s.status)).toEqual(["done", "done", "pending"]);

    const refused = run(root, "maestro-task-status.cjs", ["done", "001-x.md"]);
    expect(refused.code).toBe(1);
    expect(refused.stdout).toContain('"@reviewer"');
  });

  it("plan-step on `manager review` when the plan lacks it is rejected", async () => {
    const { root } = await installed();
    run(root, "maestro-task-status.cjs", ["plan", "@backend", "human review"]);
    const r = run(root, "maestro-task-status.cjs", ["plan-step", "manager review", "done"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('no pending plan step labelled "manager review"');
  });

  it("plan-step pending on @backend loops back past a done manager review", async () => {
    const { root, dir } = await installed();
    run(root, "maestro-task-status.cjs", ["plan", "@backend", "manager review"]);
    run(root, "maestro-task-status.cjs", ["plan-step", "@backend", "done"]);
    run(root, "maestro-task-status.cjs", ["plan-step", "manager review", "done"]);
    const back = run(root, "maestro-task-status.cjs", ["plan-step", "@backend", "pending"]);
    expect(back.code, back.stderr).toBe(0);
    const state = JSON.parse(fs.readFileSync(path.join(dir, "session.json"), "utf8"));
    expect(state.plan.steps.map((s: { status: string }) => s.status)).toEqual(["pending", "pending"]);
  });
});

describe("manager_review canvas data round trip", () => {
  it("survives writeConfig -> readConfig with type, success path and the direction-change edge", () => {
    const root = path.join(tmp, "proj");
    fs.mkdirSync(root, { recursive: true });
    writeConfig(root, buildConfig());
    const back = readConfig(root)!;
    const wf = back.workflows.find((w) => w.name === "reviewed")!;
    expect(wf.nodes.find((n) => n.id === "manager_review-1")?.type).toBe("manager_review");
    expect(successPathSteps(wf, back.workflow_instances)).toEqual(["@backend", "manager review", "@reviewer"]);
    const edge = wf.edges.find((e) => e.kind === "condition" && e.label === DIRECTION);
    expect(edge).toMatchObject({ from: "manager_review-1", to: "backend" });
  });

  it("keeps the direction-change edge a condition edge into the producing agent, and out of the agent handoff routes", () => {
    const cfg = buildConfig();
    const wf = cfg.workflows.find((w) => w.name === "reviewed")!;
    const edge = wf.edges.find((e) => e.label === DIRECTION)!;
    expect(edge.kind).toBe("condition");
    expect(wf.nodes.find((n) => n.id === edge.to)?.type).toBe("agent");
    // Routes are emitted per AGENT sender; a review node's condition edge is followed by the
    // orchestrator (like `human requested ... corrections`), never a HANDOFF route, and it must not
    // leak into one or disturb the success route through the node.
    const routes = handoffRoutes([wf], cfg.workflow_instances);
    expect(routes.some((r) => r.label === DIRECTION)).toBe(false);
    expect(routes.find((r) => r.sender === "backend" && r.label === "success")?.receiver).toBe("reviewer");
  });
});
