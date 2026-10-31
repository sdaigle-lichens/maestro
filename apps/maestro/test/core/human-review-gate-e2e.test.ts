// `130` end to end: the real hook scripts (plugin .js and the project-local .cjs copy) against a
// temp project, with the plan driven by the real `maestro-task-status.cjs plan / plan-step` CLI.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { sessionPathsFor } from "../../src/core/session-paths.js";
import { pinnedEnv } from "../helpers/env.js";

const repo = path.resolve(__dirname, "../../../..");
const SCRIPTS = {
  plugin: path.join(repo, "plugins/maestro/scripts/maestro-human-review-gate.js"),
  local: path.join(repo, ".claude/scripts/maestro-human-review-gate.cjs"),
};
const CLI = path.join(repo, "plugins/maestro/scripts/maestro-task-status.cjs");
const SID = "gate-e2e-session";
const TASK = "130-foo.md";

describe.each(Object.entries(SCRIPTS))("human review gate e2e (%s copy)", (_name, script) => {
  let root: string;
  let tasks: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-gate-e2e-")));
    tasks = path.join(root, ".claude", "maestro-tasks");
    fs.mkdirSync(tasks, { recursive: true });
    const sess = sessionPathsFor(path.join(root, ".claude"), SID)!;
    fs.mkdirSync(sess.dir, { recursive: true });
    fs.writeFileSync(sess.state, JSON.stringify({ active_task: TASK }));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const env = () => pinnedEnv(root, { CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_SESSION_ID: SID });
  const cli = (...args: string[]) => {
    const r = spawnSync("node", [CLI, ...args], { encoding: "utf8", env: env(), cwd: root });
    expect(r.status, r.stderr).toBe(0);
  };
  const ask = (payload: object = {}) => {
    const r = spawnSync("node", [script], {
      input: JSON.stringify({
        cwd: root,
        session_id: SID,
        hook_event_name: "PreToolUse",
        tool_name: "AskUserQuestion",
        tool_input: {},
        ...payload,
      }),
      encoding: "utf8",
      env: env(),
    });
    expect(r.status).toBe(0);
    return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput : null;
  };
  const review = (n: number) => path.join(tasks, n === 1 ? "130-foo.review.md" : `130-foo.review-${n}.md`);
  const planState = () => {
    const sess = sessionPathsFor(path.join(root, ".claude"), SID)!;
    return JSON.parse(fs.readFileSync(sess.state, "utf8")).plan;
  };

  it("walks allow -> deny -> allow across plan steps and loop-backs", () => {
    cli("plan", "@backend", "human review", "@scribe");
    expect(ask()).toBeNull(); // current step is @backend
    cli("plan-step", "@backend", "done");
    expect(ask()?.permissionDecision).toBe("deny");
    expect(ask()?.permissionDecisionReason).toContain(review(1));

    fs.writeFileSync(review(1), "## Changed\n");
    expect(ask()).toBeNull();

    // Loop back from review to @backend: counter increments, round 2 needs its own file.
    cli("plan-step", "@backend", "pending");
    expect(planState().loopbacks).toBe(1);
    expect(ask()).toBeNull(); // @backend is current again
    cli("plan-step", "@backend", "done");
    const d2 = ask();
    expect(d2?.permissionDecision).toBe("deny");
    expect(d2?.permissionDecisionReason).toContain(review(2));
    fs.writeFileSync(review(2), "## Changed\n");
    expect(ask()).toBeNull();

    // Loop back at the review step itself: round 3.
    cli("plan-step", "human review", "pending");
    expect(planState().loopbacks).toBe(2);
    expect(ask()?.permissionDecisionReason).toContain(review(3));

    // Approve: past the review, everything is allowed again.
    fs.writeFileSync(review(3), "## Changed\n");
    cli("plan-step", "human review", "done");
    expect(ask()).toBeNull();
  });

  it("re-recording the plan resets the loop-back counter", () => {
    cli("plan", "human review");
    cli("plan-step", "human review", "pending");
    expect(planState().loopbacks).toBe(1);
    cli("plan", "human review");
    expect(planState().loopbacks).toBeUndefined();
    expect(ask()?.permissionDecisionReason).toContain(review(1));
  });

  it("a review file for another round does not satisfy the current one", () => {
    cli("plan", "human review");
    fs.writeFileSync(review(2), "x");
    expect(ask()?.permissionDecision).toBe("deny");
  });

  it("allows other tools, a missing session id, and empty or garbage stdin", () => {
    cli("plan", "human review");
    expect(ask({ tool_name: "Bash" })).toBeNull();
    const e = pinnedEnv(root, { CLAUDE_PROJECT_DIR: root }); // no session id anywhere
    const noId = spawnSync("node", [script], {
      input: JSON.stringify({ cwd: root, hook_event_name: "PreToolUse", tool_name: "AskUserQuestion" }),
      encoding: "utf8",
      env: e,
    });
    expect(noId.status).toBe(0);
    expect(noId.stdout).toBe("");
    for (const input of ["", "{}", "[]", "null"]) {
      const r = spawnSync("node", [script], { input, encoding: "utf8", env: e });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("");
    }
  });

  it("a session with a plan but no active_task is never gated", () => {
    const sess = sessionPathsFor(path.join(root, ".claude"), SID)!;
    fs.writeFileSync(sess.state, JSON.stringify({ plan: { steps: [{ label: "human review", status: "pending" }] } }));
    expect(ask()).toBeNull();
  });

  it("fails open on a corrupt session.json", () => {
    const sess = sessionPathsFor(path.join(root, ".claude"), SID)!;
    fs.writeFileSync(sess.state, "{not json");
    expect(ask()).toBeNull();
  });
});
