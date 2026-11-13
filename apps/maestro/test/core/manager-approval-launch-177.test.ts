// `177`: the launcher's read-only approvals mount, the human-review gate's manager-approval branch,
// and the installed epic CLI's refusals (off by default; never from inside a worker container).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { CONTAINER_APPROVALS_DIR, mountArg, workerMounts, workerRunArgs } from "../../src/core/worker-runtime.js";
import { checkHumanReview, reviewFileName } from "../../src/core/human-review-gate.js";
import {
  approvalFile,
  projectKeyFor,
  readPendingEscalation,
  resolveManagerApproval,
  writeApproval,
} from "../../src/core/manager-approval.js";
import { setTaskEpic } from "../../src/core/tasks.js";
import { blankConfig } from "../../src/core/config.js";
import { pinnedEnv } from "../helpers/env.js";

const repo = path.resolve(__dirname, "../../../..");
const EPIC_CLI = path.join(repo, "plugins/maestro/scripts/maestro-epic.cjs");

const REPO = "/home/u/gits/proj";
const WT = "/home/u/gits/proj-task-177";
const APPROVALS = "/home/u/.config/maestro/approvals";

describe("the read-only approvals mount (177)", () => {
  const base = { repoRoot: REPO, worktreePath: WT, filteredSettingsLocal: null, exists: () => true };

  it("the container path is under the worker's home, outside the repository mount", () => {
    expect(CONTAINER_APPROVALS_DIR).toBe("/home/worker/.config/maestro/approvals");
  });

  it("mounts the host approvals directory read-only at the container path", () => {
    const m = workerMounts({ ...base, approvalsDir: APPROVALS });
    expect(m).toContainEqual({ source: APPROVALS, target: CONTAINER_APPROVALS_DIR, readonly: true });
    expect(mountArg(m.find((x) => x.target === CONTAINER_APPROVALS_DIR)!)).toMatch(/:ro$/);
  });

  it("the approvals source lies outside the repository and its worktree, so a worker cannot reach it through the repo", () => {
    const m = workerMounts({ ...base, approvalsDir: APPROVALS });
    const src = m.find((x) => x.target === CONTAINER_APPROVALS_DIR)!.source;
    expect(src.startsWith(REPO)).toBe(false);
    expect(src.startsWith(WT)).toBe(false);
  });

  it("the repository and worktree mounts are unchanged by the approvals mount", () => {
    const without = workerMounts({ ...base, approvalsDir: null });
    const withIt = workerMounts({ ...base, approvalsDir: APPROVALS });
    expect(withIt.filter((x) => x.target !== CONTAINER_APPROVALS_DIR)).toEqual(without);
  });

  it("is absent when manager approval is off (approvalsDir not given): the mount list is exactly as before", () => {
    const off = workerMounts({ ...base });
    expect(off.some((x) => x.target === CONTAINER_APPROVALS_DIR)).toBe(false);
    expect(workerMounts({ ...base, approvalsDir: null })).toEqual(off);
    expect(workerMounts({ ...base, approvalsDir: undefined })).toEqual(off);
  });

  it("the run args point the worker at the mount only when it is mounted", () => {
    const args = (mounts: ReturnType<typeof workerMounts>) =>
      workerRunArgs({
        tag: "img:1",
        name: "e1-177",
        taskRel: ".claude/maestro-tasks/177-x.md",
        model: "sonnet",
        repoRoot: REPO,
        mounts,
      });
    const on = args(workerMounts({ ...base, approvalsDir: APPROVALS }));
    expect(on).toContain(`MAESTRO_APPROVALS_DIR=${CONTAINER_APPROVALS_DIR}`);
    const off = args(workerMounts({ ...base }));
    expect(off.some((a) => a.startsWith("MAESTRO_APPROVALS_DIR="))).toBe(false);
  });

  it("the setting defaults off on a blank config", () => {
    expect(resolveManagerApproval(blankConfig())).toBe(false);
  });
});

describe("the human-review gate with manager approval (177)", () => {
  const tasksDir = "/p/.claude/maestro-tasks";
  const task = "177-x.md";
  const review = path.join(tasksDir, reviewFileName(task, 1));
  const state = {
    active_task: task,
    plan: {
      steps: [
        { label: "@backend", status: "done" },
        { label: "human review", status: "pending" },
      ],
    },
  };
  const verdict = (toolName: string, managerApproval: { active: boolean; message: string } | null) =>
    checkHumanReview({
      tasksDir,
      toolName,
      state,
      exists: (f) => f === review,
      managerApproval,
    });

  it("with manager approval on, an AskUserQuestion at the human review is refused even after the review file exists", () => {
    const v = verdict("AskUserQuestion", { active: true, message: "A manager approval record covers it." });
    expect(v.allow).toBe(false);
    expect(v.allow ? "" : v.reason).toContain("manager approval is on");
    expect(v.allow ? "" : v.reason).toContain("A manager approval record covers it.");
  });

  it("with manager approval off (null), the same question is allowed once the review file exists, as before", () => {
    expect(verdict("AskUserQuestion", null).allow).toBe(true);
  });

  it("a SendMessage is not affected by the approval branch", () => {
    expect(verdict("SendMessage", { active: true, message: "x" }).allow).toBe(true);
  });
});

describe("the installed epic CLI refuses approval outside the manager's host session (177)", () => {
  let root: string;
  let approvals: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-approval-cli-177-")));
    approvals = path.join(root, "approvals-root");
    fs.mkdirSync(path.join(root, ".claude", "maestro-tasks"), { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const writeConfig = (manager_approval: unknown) =>
    fs.writeFileSync(
      path.join(root, ".claude", "maestro.json"),
      JSON.stringify({ version: 3, ...(manager_approval === undefined ? {} : { manager_approval }) })
    );
  const cli = (args: string[], extra: Record<string, string> = {}) => {
    const env = pinnedEnv(root, { CLAUDE_PROJECT_DIR: root, MAESTRO_APPROVALS_DIR: approvals, ...extra });
    // Host unless a test names the container runtime itself: never inherit the developer's value.
    if (!("MAESTRO_WORKER_RUNTIME" in extra)) delete env.MAESTRO_WORKER_RUNTIME;
    return spawnSync("node", [EPIC_CLI, ...args], { encoding: "utf8", env, cwd: root });
  };
  const approveArgs = [
    "approve",
    "--task",
    "177-x.md",
    "--stop",
    "commit",
    "--commit",
    "abcdef1",
    "--decision",
    "approved",
  ];

  it("off by default: approval-check answers NOT-APPLICABLE (exit 4) and the manager's approve is refused", () => {
    writeConfig(undefined);
    const check = cli(["approval-check", "--task", "177-x.md", "--stop", "commit", "--commit", "abcdef1"]);
    expect(check.status).toBe(4);
    expect(check.stdout).toContain("NOT-APPLICABLE");
    const a = cli(approveArgs);
    expect(a.status).not.toBe(0);
    expect(a.stderr).toContain("manager_approval is not enabled");
    expect(fs.existsSync(approvals)).toBe(false);
  });

  it('the string "true" is not on: a hand-edited config must use the boolean', () => {
    writeConfig("true");
    expect(cli(approveArgs).status).not.toBe(0);
    expect(fs.existsSync(approvals)).toBe(false);
  });

  it("a worker container cannot write an approval even when the setting is on", () => {
    writeConfig(true);
    const r = cli(approveArgs, { MAESTRO_WORKER_RUNTIME: "docker" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("never from a worker container");
    expect(fs.existsSync(approvals)).toBe(false);
  });

  it("a worker container cannot record an escalation either", () => {
    writeConfig(true);
    const r = cli(
      ["approval-escalate", "--task", "177-x.md", "--stop", "commit", "--commit", "abcdef1", "--reason", "outward-git"],
      { MAESTRO_WORKER_RUNTIME: "docker" }
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("never from a worker container");
    expect(fs.existsSync(approvals)).toBe(false);
  });

  it("a host worker is not approved by a record: approval-check says NOT-APPLICABLE, not APPROVED", () => {
    writeConfig(true);
    const check = cli(["approval-check", "--task", "177-x.md", "--stop", "commit", "--commit", "abcdef1"]);
    expect(check.stdout).not.toContain("APPROVED:");
    expect(check.status).toBe(4);
  });
});

// `177` fix, through the installed bundle: a host manager session with an epic-linked task whose
// user has already answered the commit. Approve and approval-escalate both refuse, and the user's
// record is left as it was.
describe("the installed epic CLI never overwrites the user's answer for the same commit (177)", () => {
  const TASK_FILE = "177-x.md";
  const EPIC = "containerized-workers";
  let root: string;
  let approvals: string;

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-approval-user-177-")));
    approvals = path.join(root, "approvals-root");
    fs.mkdirSync(path.join(root, ".claude", "maestro-tasks"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "maestro-tasks", TASK_FILE), "# 177 test task\n");
    fs.writeFileSync(
      path.join(root, ".claude", "maestro.json"),
      JSON.stringify({ version: 3, manager_approval: true })
    );
    setTaskEpic(root, [TASK_FILE], EPIC);
    // The user's Approve for commit abcdef1234, as the AskUserQuestion hook would have written it.
    writeApproval(approvals, {
      project: projectKeyFor(root),
      epic: EPIC,
      task: TASK_FILE,
      stop: "commit",
      commit: "abcdef1234567890",
      decision: "approved",
      source: "user",
      escalation: "security-finding",
    });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const cli = (args: string[]) => {
    const env = pinnedEnv(root, { CLAUDE_PROJECT_DIR: root, MAESTRO_APPROVALS_DIR: approvals });
    delete env.MAESTRO_WORKER_RUNTIME;
    return spawnSync("node", [EPIC_CLI, ...args], { encoding: "utf8", env, cwd: root });
  };
  const recordPath = () =>
    approvalFile(approvals, { project: projectKeyFor(root), epic: EPIC, task: TASK_FILE, stop: "commit" });

  it("approve over the user's Approve for the same commit exits non-zero, prints the refusal, and keeps the user's record", () => {
    const before = fs.readFileSync(recordPath(), "utf8");
    const r = cli([
      "approve",
      "--task",
      TASK_FILE,
      "--stop",
      "commit",
      "--commit",
      "abcdef1",
      "--decision",
      "rejected",
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("already answered");
    expect(fs.readFileSync(recordPath(), "utf8")).toBe(before);
  });

  it("approval-escalate on the same commit exits non-zero, prints the refusal, and records no pending escalation", () => {
    const r = cli([
      "approval-escalate",
      "--task",
      TASK_FILE,
      "--stop",
      "commit",
      "--commit",
      "abcdef1",
      "--reason",
      "outward-git",
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("already answered");
    expect(
      readPendingEscalation(approvals, { project: projectKeyFor(root), epic: EPIC, task: TASK_FILE, stop: "commit" })
    ).toBeNull();
  });

  it("a new commit reopens the stop through the CLI: approval-escalate on another commit is recorded", () => {
    const r = cli([
      "approval-escalate",
      "--task",
      TASK_FILE,
      "--stop",
      "commit",
      "--commit",
      "9999999fedcba",
      "--reason",
      "outward-git",
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("escalation recorded");
  });
});
