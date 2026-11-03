// `130`: AskUserQuestion is denied at a human review step until that round's review file exists.
// Pure module first, then the real hook script spawned against a temp project.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  checkHumanReview,
  currentReviewRound,
  reviewFileName,
  isReviewFile,
  SUMMARY_PLACEMENT,
} from "../../src/core/human-review-gate.js";
import { findUpPluginRoot } from "../../src/core/install.js";
import { fileURLToPath } from "node:url";
import { sessionPathsFor } from "../../src/core/session-paths.js";
import { listTasks } from "../../src/core/tasks.js";
import { pinnedEnv } from "../helpers/env.js";

const step = (label: string, status = "pending") => ({ label, status });
const plan = (steps: ReturnType<typeof step>[], loopbacks?: number) => ({ steps, ...(loopbacks ? { loopbacks } : {}) });
const atReview = plan([step("@backend", "done"), step("human review"), step("@test")]);

describe("reviewFileName / isReviewFile", () => {
  it("names round 1 plainly and later rounds with a number", () => {
    expect(reviewFileName("130-foo.md", 1)).toBe("130-foo.review.md");
    expect(reviewFileName("130-foo.md", 3)).toBe("130-foo.review-3.md");
    expect(reviewFileName(".claude/maestro-tasks/130-foo.md", 1)).toBe("130-foo.review.md");
  });
  it("recognises review files and not tasks", () => {
    expect(isReviewFile("130-foo.review.md")).toBe(true);
    expect(isReviewFile("130-foo.review-2.md")).toBe(true);
    expect(isReviewFile("130-foo.md")).toBe(false);
  });
});

describe("currentReviewRound", () => {
  it("is null unless the first unfinished step is a human review", () => {
    expect(currentReviewRound(undefined)).toBeNull();
    expect(currentReviewRound({})).toBeNull();
    expect(currentReviewRound(plan([step("@backend"), step("human review")]))).toBeNull();
    expect(currentReviewRound(plan([step("@backend", "done"), step("human review", "done")]))).toBeNull();
  });
  it("counts loop-backs and approved reviews into the round", () => {
    expect(currentReviewRound(atReview)).toBe(1);
    expect(currentReviewRound({ ...atReview, loopbacks: 2 })).toBe(3);
    expect(currentReviewRound(plan([step("human review", "done"), step("human review")]))).toBe(2);
  });
});

describe("checkHumanReview", () => {
  const tasksDir = "/p/.claude/maestro-tasks";
  const verdict = (toolName: string, state: object | null, files: string[] = []) =>
    checkHumanReview({ tasksDir, toolName, state, exists: (f) => files.includes(f) });

  it("denies at a human review without the round's file, naming the path", () => {
    const v = verdict("AskUserQuestion", { active_task: "130-foo.md", plan: atReview });
    expect(v.allow).toBe(false);
    if (!v.allow) expect(v.reason).toContain(`${tasksDir}/130-foo.review.md`);
  });
  it("allows once the round's file exists, and demands a new one after a loop-back", () => {
    const file = `${tasksDir}/130-foo.review.md`;
    expect(verdict("AskUserQuestion", { active_task: "130-foo.md", plan: atReview }, [file]).allow).toBe(true);
    const again = verdict("AskUserQuestion", { active_task: "130-foo.md", plan: { ...atReview, loopbacks: 1 } }, [
      file,
    ]);
    expect(again.allow).toBe(false);
    if (!again.allow) expect(again.reason).toContain("130-foo.review-2.md");
  });
  it("143: puts the path first in the digest and the printed summary, never last, in human and manager review", () => {
    const human = verdict("AskUserQuestion", { active_task: "130-foo.md", plan: atReview });
    const mgrPlan = plan([step("@backend", "done"), step("manager review"), step("@test")]);
    const manager = verdict("AskUserQuestion", { active_task: "130-foo.md", plan: mgrPlan });
    for (const v of [human, manager]) {
      expect(v.allow).toBe(false);
      if (v.allow) continue;
      expect(v.reason).toContain("as its first line");
      expect(v.reason).toContain("preview with the review file's path as its first line");
      expect(v.reason).toContain("its last line states that the full text is in the review file");
      expect(v.reason).not.toMatch(/ending with the review file/);
    }
  });
  it("143: the round 2+ file name sits in the first-line placement clause, in both review kinds", () => {
    const loop = { active_task: "130-foo.md", plan: { ...atReview, loopbacks: 1 } };
    const mgrLoop = {
      active_task: "130-foo.md",
      plan: { ...plan([step("@backend", "done"), step("manager review"), step("@test")]), loopbacks: 1 },
    };
    for (const state of [loop, mgrLoop]) {
      const v = verdict("AskUserQuestion", state);
      expect(v.allow).toBe(false);
      if (v.allow) continue;
      expect(v.reason).toContain(
        `as text above the question with the review file's path (${tasksDir}/130-foo.review-2.md) as its first line`
      );
      expect(v.reason).not.toContain("130-foo.review.md");
    }
  });
  it("143: the placement clause is the exported SUMMARY_PLACEMENT, verbatim, in both messages", () => {
    const file = `${tasksDir}/130-foo.review.md`;
    const human = verdict("AskUserQuestion", { active_task: "130-foo.md", plan: atReview });
    const mgrPlan = plan([step("@backend", "done"), step("manager review"), step("@test")]);
    const manager = verdict("AskUserQuestion", { active_task: "130-foo.md", plan: mgrPlan });
    for (const v of [human, manager]) {
      expect(v.allow).toBe(false);
      if (!v.allow) expect(v.reason).toContain(SUMMARY_PLACEMENT(file));
    }
    // Nothing in the placement may put the path last.
    expect(SUMMARY_PLACEMENT(file)).not.toMatch(/last line (is|being) the (review file|path)/);
    expect(SUMMARY_PLACEMENT(file)).not.toMatch(/ending with/);
  });
  it("143: the orchestrator template and the gate say the same placement words", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const root = findUpPluginRoot(here)!;
    const template = fs.readFileSync(path.join(root, "templates", "maestro", "SKILL.md"), "utf8");
    const bullet = template.match(/^- `human review` — .*$/m)?.[0] ?? "";
    expect(bullet).not.toBe("");
    const plain = bullet.replace(/`/g, "").replace("at most about 15", "at most 15");
    const gate = SUMMARY_PLACEMENT("<FILE>").replace(" (<FILE>)", "");
    // Each clause of the gate's wording (split at the parenthesised list, whose order differs) must
    // appear word for word in the template, so editing one side alone fails here.
    const clauses = [
      "print the full summary as text above the question with the review file's path as its first line",
      "putting a digest of at most 15 lines in the Approve option's preview with the review file's path as its first line",
      "If the digest is shortened to fit, its last line states that the full text is in the review file.",
    ];
    for (const c of clauses) {
      expect(gate).toContain(c);
      expect(plain).toContain(c);
    }
    expect(plain).not.toMatch(/as the last line the review file's path/);
  });
  it("allows everything outside a human review", () => {
    expect(verdict("Write", { active_task: "130-foo.md", plan: atReview }).allow).toBe(true);
    expect(verdict("AskUserQuestion", { active_task: "130-foo.md", plan: plan([step("@backend")]) }).allow).toBe(true);
    expect(verdict("AskUserQuestion", { active_task: "130-foo.md" }).allow).toBe(true);
    expect(verdict("AskUserQuestion", { plan: atReview }).allow).toBe(true);
    expect(verdict("AskUserQuestion", null).allow).toBe(true);
  });
});

describe("maestro-human-review-gate.js (real script)", () => {
  const script = path.resolve(__dirname, "../../../../plugins/maestro/scripts/maestro-human-review-gate.js");
  let root: string;
  const SID = "gate-test-session";

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-review-gate-")));
    fs.mkdirSync(path.join(root, ".claude", "maestro-tasks"), { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const writeState = (state: object) => {
    const sess = sessionPathsFor(path.join(root, ".claude"), SID)!;
    fs.mkdirSync(sess.dir, { recursive: true });
    fs.writeFileSync(sess.state, JSON.stringify(state));
  };
  const run = (payload: object = {}) =>
    spawnSync("node", [script], {
      input: JSON.stringify({
        cwd: root,
        session_id: SID,
        hook_event_name: "PreToolUse",
        tool_name: "AskUserQuestion",
        tool_input: {},
        ...payload,
      }),
      encoding: "utf8",
      env: pinnedEnv(root),
    });

  it("denies at a human review while the review file is missing", () => {
    writeState({ active_task: "130-foo.md", plan: atReview });
    const r = run();
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("130-foo.review.md");
  });

  it("is silent once the review file exists", () => {
    writeState({ active_task: "130-foo.md", plan: atReview });
    fs.writeFileSync(path.join(root, ".claude", "maestro-tasks", "130-foo.review.md"), "## Changed\n");
    expect(run().stdout).toBe("");
  });

  it("is silent outside a human review, for other tools, and with no session state", () => {
    writeState({ active_task: "130-foo.md", plan: plan([step("@backend")]) });
    expect(run().stdout).toBe("");
    writeState({ active_task: "130-foo.md", plan: atReview });
    expect(run({ tool_name: "Write" }).stdout).toBe("");
    fs.rmSync(path.join(root, ".claude", "maestro_sessions"), { recursive: true, force: true });
    expect(run().stdout).toBe("");
    expect(spawnSync("node", [script], { input: "not json", encoding: "utf8", env: pinnedEnv(root) }).stdout).toBe("");
  });
});

describe("task listing", () => {
  it("does not treat review files as tasks", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-review-list-")));
    try {
      const dir = path.join(root, ".claude", "maestro-tasks");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "001-a.md"), "# A\n\n## Blocked by\n\nNone\n");
      fs.writeFileSync(path.join(dir, "001-a.review.md"), "## Changed\n");
      fs.writeFileSync(path.join(dir, "001-a.review-2.md"), "## Changed\n");
      expect(listTasks(root).map((t) => t.filename)).toEqual(["001-a.md"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
