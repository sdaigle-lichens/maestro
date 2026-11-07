// `155`: an implementer's test hints reach a later @test step that none of its own edges route to,
// as hints only. `testHintRoutes` finds those senders; `testHintRequirement` is what the
// SubagentStart hook injects for them; the seeds carry the hints-only shape.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { pinnedEnv } from "../helpers/env.js";

import { handoffRoutes, routesFrom, testHintRoutes } from "../../src/core/handoff-routes.js";
import { testHintRequirement, type PayloadRoute } from "../../src/core/handoff-payload.js";
import { PRIOR_SEEDS, SEED_HANDOFFS } from "../../src/core/handoff-seeds.js";
import { applyWorkflowSpec } from "../../src/core/workflow-spec.js";
import { defaultV3Config } from "../../src/core/seed.js";

function workflow(steps: string[], conditions: { from: string; to: string; label: string }[] = []) {
  const cfg = defaultV3Config(["backend", "frontend"]);
  const r = applyWorkflowSpec(cfg, { name: "w", steps, conditions }, "create");
  expect(r.errors).toEqual([]);
  return { wf: r.workflow, instances: r.config.workflow_instances };
}

describe("testHintRoutes", () => {
  it("gives backend a hints route when @test comes after @frontend and a manager review", () => {
    const { wf, instances } = workflow(["backend", "frontend", "manager_review-1", "test", "reviewer"]);
    expect(routesFrom(testHintRoutes([wf], instances), "backend")).toEqual([
      { sender: "backend", receiver: "test", label: "success" },
    ]);
    // frontend's own success edge reaches @test through the manager review: a normal route covers it.
    expect(routesFrom(testHintRoutes([wf], instances), "frontend")).toEqual([]);
    expect(routesFrom(handoffRoutes([wf], instances), "frontend")).toContainEqual({
      sender: "frontend",
      receiver: "test",
      label: "success",
    });
  });

  it("gives nothing when @test is not on the success path after the sender", () => {
    const { wf, instances } = workflow(
      ["backend", "frontend", "reviewer"],
      [{ from: "reviewer", to: "test", label: "FAIL: a test" }]
    );
    expect(testHintRoutes([wf], instances)).toEqual([]);
  });

  it("never adds a route the orchestrator can be routed by", () => {
    const { wf, instances } = workflow(["backend", "frontend", "test"]);
    expect(routesFrom(handoffRoutes([wf], instances), "backend").map((r) => r.receiver)).toEqual(["frontend"]);
  });

  it("never gives test, reviewer or refactor a hints route", () => {
    const { wf, instances } = workflow(["refactor", "backend", "reviewer", "test"]);
    expect(testHintRoutes([wf], instances).map((r) => r.sender)).toEqual(["backend"]);
  });
});

describe("testHintRequirement", () => {
  const route: PayloadRoute = {
    label: "success",
    sender: "backend",
    receiver: "test",
    scope: "task-001",
    channelFile: ".claude/channels/task-001/test/backend.1.md",
    protocol: SEED_HANDOFFS["backend/test"],
  };

  it("names the file and inlines the shape on a first run", () => {
    const text = testHintRequirement([route], { withShapes: true })!;
    expect(text).toContain("`HANDOFF: success`, whatever agent that route goes to");
    expect(text).toContain(route.channelFile);
    expect(text).toContain(route.protocol);
  });

  it("keeps hints inside the test setup the project already has", () => {
    const text = testHintRequirement([route], { withShapes: true })!;
    expect(text).toContain("EXISTING test setup");
    expect(text).toContain("never suggest a test framework, runner, config, folder structure");
    expect(text).toContain("`none: no tests for this part yet`");
    for (const id of ["backend/test", "frontend/test", "mobile/test"])
      expect(SEED_HANDOFFS[id]).toContain("never a test framework, runner or structure to create");
  });

  it("names the file only on a resume, and nothing when there is no route", () => {
    const text = testHintRequirement([route], { withShapes: false })!;
    expect(text).toContain(route.channelFile);
    expect(text).not.toContain('"hintsOnly"');
    expect(testHintRequirement([], { withShapes: true })).toBeNull();
  });
});

describe("hints-only seeds", () => {
  it.each(["backend/test", "frontend/test", "mobile/test"])("%s carries the hints framing, not edge_cases", (id) => {
    const body = SEED_HANDOFFS[id];
    for (const k of ['"hintsOnly"', '"notHandled"', '"failureModes"', '"howToRun"', '"preHandoffChecks"'])
      expect(body).toContain(k);
    expect(body).not.toContain("edge_cases");
    expect(PRIOR_SEEDS[id][0]).toContain("edge_cases"); // the pre-`155` body upgrades
  });

  it("test/reviewer carries the origin split, the acceptance mapping and the skipped hints", () => {
    for (const k of ['"test_origin"', '"acceptance_coverage"', '"hints_skipped"'])
      expect(SEED_HANDOFFS["test/reviewer"]).toContain(k);
    // The pre-`155` body is still a prior seed (newest first, so behind the pre-known_gaps one).
    const pre155 = PRIOR_SEEDS["test/reviewer"][1];
    expect(pre155).toContain('"commands_run"');
    expect(pre155).not.toContain('"test_origin"');
  });

  it("every seeded handoff body is valid JSON inside its fence", () => {
    for (const [id, body] of Object.entries(SEED_HANDOFFS)) {
      const json = body.replace(/^```json\n/, "").replace(/\n```$/, "");
      expect(() => JSON.parse(json), id).not.toThrow();
    }
  });
});

// The INSTALLED hooks, on a workflow where backend hands off to frontend and @test runs later: the
// shape of the default workflow that left task 001's test agent without backend's hints.
describe("installed hooks: backend -> frontend -> test (155)", () => {
  const PLUGIN_ROOT = findUpPluginRoot(path.dirname(fileURLToPath(import.meta.url)))!;
  const SESS = "sess-155-aaa";
  let tmp: string;
  let home: string;

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-155-hints-")));
    home = path.join(tmp, "home");
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  async function installed(): Promise<string> {
    const root = path.join(tmp, "repo");
    fs.mkdirSync(root, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: root });
    const cfg = defaultV3Config(["backend", "frontend"]);
    const r = applyWorkflowSpec(cfg, { name: "hints", steps: ["backend", "frontend", "test"] }, "create");
    writeConfig(root, { ...r.config, workflows: [r.workflow] });
    await installRuntime(
      root,
      PLUGIN_ROOT,
      path.join(tmp, "reports.sqlite"),
      path.join(tmp, "tags.sqlite"),
      path.join(tmp, "handoffs.sqlite")
    );
    return root;
  }

  function hook(root: string, script: string, payload: Record<string, unknown>) {
    const r = spawnSync("node", [path.join(root, ".claude", "scripts", script)], {
      encoding: "utf8",
      input: JSON.stringify({ cwd: root, session_id: SESS, ...payload }),
      env: pinnedEnv(home, { CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_SESSION_ID: SESS }),
    });
    expect(r.status, r.stderr).toBe(0);
    return r.stdout ?? "";
  }

  const context = (root: string, agent: string, id: string): string => {
    const out = hook(root, "maestro-inject-agent-context.cjs", {
      hook_event_name: "SubagentStart",
      agent_type: agent,
      agent_id: id,
    });
    return out.trim() ? (JSON.parse(out).hookSpecificOutput.additionalContext as string) : "";
  };
  const start = (root: string, agent: string, id: string) =>
    hook(root, "maestro-subagent-log.cjs", { hook_event_name: "SubagentStart", agent_type: agent, agent_id: id });
  const stop = (root: string, agent: string, id: string) =>
    hook(root, "maestro-subagent-log.cjs", {
      hook_event_name: "SubagentStop",
      agent_type: agent,
      agent_id: id,
      last_assistant_message: '"verdict": "SUCCESS"\nHANDOFF: success',
    });
  const issues = (root: string) =>
    (JSON.parse(fs.readFileSync(path.join(root, ".claude", "maestro_sessions", SESS, "session.json"), "utf8"))
      .handoff_issues ?? []) as Array<Record<string, unknown>>;

  it("tells backend to write test hints, flags them when missing, and delivers them to @test", async () => {
    const root = await installed();
    const ctx = context(root, "backend", "b-1");
    expect(ctx).toContain("(routes to `frontend`)");
    expect(ctx).toContain("whatever agent that route goes to");
    const hintFile = ctx.match(/Test hints for `test` — write this to `([^`]+)`/)![1];
    expect(hintFile).toMatch(/\/test\/backend\.1\.md$/);
    expect(fs.existsSync(path.join(root, ".claude", "handoffs", "backend", "test.md"))).toBe(true);

    // HANDOFF: success with neither file written: both are missing.
    start(root, "backend", "b-1");
    stop(root, "backend", "b-1");
    const files = issues(root).find((i) => i.agent_id === "b-1")!.files as string[];
    expect(files.some((f) => f.endsWith("/frontend/backend.1.md"))).toBe(true);
    expect(files).toContain(hintFile);

    // A second backend run writes both, and nothing is flagged for it.
    start(root, "backend", "b-2");
    const frontendFile = hintFile.replace("/test/backend.1.md", "/frontend/backend.1.md");
    for (const [rel, body] of [
      [frontendFile, "```json\n{}\n```\n"],
      [hintFile, SEED_HANDOFFS["backend/test"] + "\n"],
    ]) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), body);
    }
    stop(root, "backend", "b-2");
    expect(issues(root).filter((i) => i.agent_id === "b-2")).toEqual([]);

    // @test's own SubagentStart inlines the hints, though no route ever led backend to @test.
    const testCtx = context(root, "test", "t-1");
    expect(testCtx).toContain("Delivered to your channel");
    expect(testCtx).toContain("From `backend`");
    expect(testCtx).toContain("Implementer hints, not the test scope");
  });

  it("frontend, whose own edge reaches @test, gets the normal route and no hints block", async () => {
    const root = await installed();
    const ctx = context(root, "frontend", "f-1");
    expect(ctx).toContain("Route `HANDOFF: success` → `test`");
    expect(ctx).not.toContain("whatever agent that route goes to");
  });
});
