// `083` through the REAL installed scripts: the SubagentStop hook's verdict/HANDOFF check, the
// `maestro-task-status.cjs` plan / plan-step / plan-show / handoff-issues / done / merge commands.
// Real git repos and worktrees under os.tmpdir(); nothing is mocked. HOME pinned and
// CLAUDE_CODE_SESSION_ID always set or deleted (never inherited) — see test-maestro's
// references/hook-script-tests.md.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { checkHandoff, reportVerdict } from "../../src/core/handoff-check.js";
import type { MaestroConfigV3 } from "../../src/core/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;

// Each test spawns real git and node processes; the 5s default flakes under a parallel full run.
vi.setConfig({ testTimeout: 30_000 });

const SESS = "sess-083-aaa";
const SESS_B = "sess-083-bbb";

const cfg = {
  version: 3,
  agents_available: ["scribe", "reviewer"],
  skills_available: [],
  workflow_instances: [
    { name: "scribe", agent: "scribe", loaded_skills: [], referenced_skills: [] },
    { name: "reviewer", agent: "reviewer", loaded_skills: [], referenced_skills: [] },
  ],
  workflows: [
    {
      name: "docs",
      nodes: [
        { id: "scribe", type: "agent", instance: "scribe", position: { x: 0, y: 100 } },
        { id: "reviewer", type: "agent", instance: "reviewer", position: { x: 0, y: 200 } },
      ],
      edges: [
        { from: "main-session", to: "scribe", kind: "success", sourceHandle: "bottom", targetHandle: "top" },
        { from: "scribe", to: "reviewer", kind: "success", sourceHandle: "bottom", targetHandle: "top" },
        {
          from: "reviewer",
          to: "scribe",
          kind: "condition",
          label: "changes requested",
          sourceHandle: "right",
          targetHandle: "top",
        },
      ],
    },
  ],
  rules: [],
} as unknown as MaestroConfigV3;

let tmp: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-083-")));
});
afterEach(() => {
  // a test may leave a read-only dir behind on purpose
  spawnSync("chmod", ["-R", "u+rwX", tmp]);
  fs.rmSync(tmp, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function env(root: string, sessionId: string | null): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_PROJECT_DIR: root,
    HOME: tmp,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
  if (sessionId === null) delete e.CLAUDE_CODE_SESSION_ID;
  else e.CLAUDE_CODE_SESSION_ID = sessionId;
  return e;
}

function script(dir: string, name: string, args: string[], sessionId: string | null, input?: unknown) {
  const r = spawnSync("node", [path.join(dir, ".claude", "scripts", name), ...args], {
    encoding: "utf8",
    env: env(dir, sessionId),
    ...(input !== undefined ? { input: JSON.stringify(input) } : {}),
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const cli = (dir: string, args: string[], sessionId: string | null) =>
  script(dir, "maestro-task-status.cjs", args, sessionId);

const sessionDir = (root: string, id: string) => path.join(root, ".claude", "maestro_sessions", id);
const readState = (root: string, id: string) =>
  JSON.parse(fs.readFileSync(path.join(sessionDir(root, id), "session.json"), "utf8"));
const readLog = (root: string, id: string): Record<string, any>[] =>
  fs
    .readFileSync(path.join(sessionDir(root, id), "log.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const tasksDir = (root: string) => path.join(root, ".claude", "maestro-tasks");

function writeTask(root: string, filename: string, title: string) {
  fs.mkdirSync(tasksDir(root), { recursive: true });
  fs.writeFileSync(path.join(tasksDir(root), filename), `# ${title}\n\n## Blocked by\n\nNone\n`);
}

async function installed(): Promise<string> {
  const root = path.join(tmp, "repo");
  fs.mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  writeConfig(root, cfg);
  await installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "report-defaults.sqlite"),
    path.join(tmp, "project-tags.sqlite"),
    path.join(tmp, "handoff-defaults.sqlite")
  );
  fs.writeFileSync(path.join(root, "app.txt"), "main\n");
  writeTask(root, "001-a.md", "A");
  writeTask(root, "002-b.md", "Make the thing work");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

function stop(root: string, agent: string, id: string, msg: string, sessionId = SESS) {
  return script(root, "maestro-subagent-log.cjs", [], sessionId, {
    cwd: root,
    session_id: sessionId,
    hook_event_name: "SubagentStop",
    agent_type: agent,
    agent_id: id,
    last_assistant_message: msg,
  });
}

// ── 1. SubagentStop: handoff_issue ──────────────────────────────────────────────────────────────

describe("SubagentStop hook flags verdict/HANDOFF disagreement (083)", () => {
  it("a missing HANDOFF line is logged as handoff_issue, recorded in session.json, surfaced by handoff-issues", async () => {
    const root = await installed();

    const run = stop(root, "scribe", "a1", "scribe done");
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toContain("handoff problem (missing)");

    const entry = readLog(root, SESS).find((e) => e.kind === "handoff")!;
    expect(entry.handoff_issue).toMatchObject({ kind: "missing", label: null, verdict: null });
    expect(entry.log).toContain("[missing]");

    const recorded = readState(root, SESS).handoff_issues;
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ agent: "scribe", agent_id: "a1", kind: "missing" });

    const seen = cli(root, ["handoff-issues"], SESS);
    expect(seen.code).toBe(0);
    expect(seen.stdout).toContain("1 problem(s)");
    expect(seen.stdout).toContain("scribe: NO HANDOFF line");

    // read-and-clear
    expect(readState(root, SESS).handoff_issues).toBeUndefined();
    expect(cli(root, ["handoff-issues"], SESS).stdout).toContain("no problems recorded");
  });

  it("a FAIL verdict ending HANDOFF: success is a contradiction, logged and surfaced", async () => {
    const root = await installed();
    const msg = 'Review notes.\n```json\n{ "subagent": "reviewer", "verdict": "FAIL" }\n```\nHANDOFF: success';

    const run = stop(root, "reviewer", "r1", msg);
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toContain("handoff problem (contradiction)");

    const entry = readLog(root, SESS).find((e) => e.kind === "handoff")!;
    expect(entry.label).toBe("success");
    expect(entry.handoff_issue).toMatchObject({ kind: "contradiction", verdict: "FAIL", label: "success" });
    expect(entry.log).toBe("HANDOFF: success [contradiction]");

    expect(readState(root, SESS).handoff_issues[0]).toMatchObject({
      agent: "reviewer",
      kind: "contradiction",
      verdict: "FAIL",
    });
    const seen = cli(root, ["handoff-issues"], SESS);
    expect(seen.stdout).toContain("reviewer: verdict FAIL but HANDOFF: success");
    expect(seen.stdout).toContain("(verdict FAIL)");
  });

  it("issues accumulate across agents until read", async () => {
    const root = await installed();
    stop(root, "scribe", "a1", "scribe done");
    stop(root, "reviewer", "r1", '"verdict": "FAIL"\nHANDOFF: success');
    expect(cli(root, ["handoff-issues"], SESS).stdout).toContain("2 problem(s)");
  });

  it("sound handoffs raise nothing: FAIL with the condition label, SUCCESS with success", async () => {
    const root = await installed();

    const a = stop(root, "reviewer", "r1", '"verdict": "FAIL"\nHANDOFF: changes requested');
    const b = stop(root, "scribe", "a1", '"verdict": "SUCCESS"\nHANDOFF: success');

    expect(a.stdout).not.toContain("handoff problem");
    expect(b.stdout).not.toContain("handoff problem");
    for (const e of readLog(root, SESS).filter((x) => x.kind === "handoff")) expect(e.handoff_issue).toBeUndefined();
    expect(readState(root, SESS).handoff_issues).toBeUndefined();
    expect(cli(root, ["handoff-issues"], SESS).stdout).toContain("no problems recorded");
  });

  it("the unfilled template value 'SUCCESS | FAIL' is not read as a verdict", async () => {
    const root = await installed();
    const run = stop(root, "scribe", "a1", '"verdict": "SUCCESS | FAIL"\nHANDOFF: success');
    expect(run.stdout).not.toContain("handoff problem");
  });

  it("a generic subagent that maps to no workflow instance is not judged", async () => {
    const root = await installed();
    const run = stop(root, "Explore", "e1", "found it, no handoff line here");
    expect(run.code).toBe(0);
    expect(run.stdout).not.toContain("handoff problem");
    expect(readLog(root, SESS).find((e) => e.kind === "handoff")!.handoff_issue).toBeUndefined();
  });

  it("issues are per session: another session sees none", async () => {
    const root = await installed();
    stop(root, "scribe", "a1", "scribe done", SESS);
    fs.mkdirSync(sessionDir(root, SESS_B), { recursive: true });
    expect(cli(root, ["handoff-issues"], SESS_B).stdout).toContain("no problems recorded");
    expect(cli(root, ["handoff-issues"], SESS).stdout).toContain("1 problem(s)");
  });

  it("the pure judgement agrees with the hook", () => {
    expect(checkHandoff("scribe done")?.kind).toBe("missing");
    expect(checkHandoff('"verdict": "FAIL"\nHANDOFF: success')?.kind).toBe("contradiction");
    expect(checkHandoff('"verdict": "FAIL"\nHANDOFF: changes requested')).toBeNull();
    expect(checkHandoff("ok\nHANDOFF: success")).toBeNull();
    expect(reportVerdict('"verdict": "SUCCESS"\n...\n"verdict": "FAIL"')).toBe("FAIL");
    expect(reportVerdict(null)).toBeNull();
  });
});

// ── 4. plan / plan-step / plan-show / done ──────────────────────────────────────────────────────

describe("the success-path tracker (083)", () => {
  async function withSession() {
    const root = await installed();
    fs.mkdirSync(sessionDir(root, SESS), { recursive: true });
    return root;
  }

  it("plan records the steps, plan-show prints them with the next marker", async () => {
    const root = await withSession();

    const rec = cli(root, ["plan", "@backend", "human review", "@scribe"], SESS);
    expect(rec.code, rec.stderr).toBe(0);
    expect(rec.stdout).toContain("recorded 3 step(s)");

    const state = readState(root, SESS);
    expect(state.plan.steps).toEqual([
      { label: "@backend", status: "pending" },
      { label: "human review", status: "pending" },
      { label: "@scribe", status: "pending" },
    ]);

    const show = cli(root, ["plan-show"], SESS);
    expect(show.stdout).toContain("1. [ ] @backend   <- next");
    expect(show.stdout).toContain("3 step(s) pending");
  });

  it("plan-show with no plan, and plan with no steps", async () => {
    const root = await withSession();
    expect(cli(root, ["plan-show"], SESS).stdout).toContain("none recorded");
    const bad = cli(root, ["plan"], SESS);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("needs the success-path step labels");
  });

  it("plan, plan-step and plan-show need a resolvable session", async () => {
    const root = await withSession();
    expect(cli(root, ["plan", "@backend"], null).code).toBe(1);
    expect(cli(root, ["plan-step", "@backend", "done"], null).code).toBe(1);
    expect(cli(root, ["plan-show"], null).code).toBe(0); // read-only: degrades
  });

  it("plan-step validates its arguments and the label", async () => {
    const root = await withSession();
    expect(cli(root, ["plan-step", "@backend", "done"], SESS).stderr).toContain("no plan recorded");
    cli(root, ["plan", "@backend", "@scribe"], SESS);
    expect(cli(root, ["plan-step", "@backend", "maybe"], SESS).stderr).toContain("usage");
    const unknown = cli(root, ["plan-step", "@nobody", "done"], SESS);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('no pending plan step labelled "@nobody"');
  });

  it("done refuses while any step is pending (including human review), then succeeds once all are done", async () => {
    const root = await withSession();
    cli(root, ["plan", "@backend", "human review", "@scribe"], SESS);

    const none = cli(root, ["done", "002-b.md"], SESS);
    expect(none.code).toBe(1);
    expect(none.stdout).toContain("done REFUSED");
    expect(none.stdout).toContain('"@backend", "human review", "@scribe"');

    cli(root, ["plan-step", "@backend", "done"], SESS);
    // skip human review, finish scribe: still refused, and the refusal names human review
    cli(root, ["plan-step", "@scribe", "done"], SESS);
    const review = cli(root, ["done", "002-b.md"], SESS);
    expect(review.code).toBe(1);
    expect(review.stdout).toContain('"human review"');
    expect(review.stdout).toContain("1 unfinished step(s)");

    cli(root, ["plan-step", "human review", "done"], SESS);
    expect(cli(root, ["plan-show"], SESS).stdout).toContain("you may run `done`");
    const ok = cli(root, ["done", "002-b.md"], SESS);
    expect(ok.code, ok.stdout + ok.stderr).toBe(0);
    expect(cli(root, ["sync"], SESS).stdout).toMatch(/done/i);
  });

  it("a refused done writes nothing to status.json", async () => {
    const root = await withSession();
    const statusFile = path.join(tasksDir(root), "status.json");
    const before = fs.existsSync(statusFile) ? fs.readFileSync(statusFile, "utf8") : null;
    cli(root, ["plan", "@backend"], SESS);
    expect(cli(root, ["done", "002-b.md"], SESS).code).toBe(1);
    expect(fs.existsSync(statusFile) ? fs.readFileSync(statusFile, "utf8") : null).toBe(before);
  });

  it("a session with no recorded plan can still done; another session's plan does not block it", async () => {
    const root = await withSession();
    fs.mkdirSync(sessionDir(root, SESS_B), { recursive: true });
    cli(root, ["plan", "@backend"], SESS_B);
    const ok = cli(root, ["done", "002-b.md"], SESS);
    expect(ok.code, ok.stdout + ok.stderr).toBe(0);
  });

  it("plan-step pending is a loop-back: resets the last done step with that label and everything after it", async () => {
    const root = await withSession();
    cli(root, ["plan", "@backend", "@reviewer", "human review", "@scribe"], SESS);
    for (const l of ["@backend", "@reviewer", "human review"]) cli(root, ["plan-step", l, "done"], SESS);

    const back = cli(root, ["plan-step", "@backend", "pending"], SESS);
    expect(back.code, back.stderr).toBe(0);

    expect(readState(root, SESS).plan.steps.map((s: any) => s.status)).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    expect(back.stdout).toContain("1. [ ] @backend   <- next");
    expect(cli(root, ["done", "002-b.md"], SESS).code).toBe(1);
  });

  it("a loop-back to a middle step keeps earlier steps done; duplicate labels reset the LAST done one", async () => {
    const root = await withSession();
    cli(root, ["plan", "@backend", "@reviewer", "@backend", "@reviewer"], SESS);
    for (const l of ["@backend", "@reviewer", "@backend", "@reviewer"]) cli(root, ["plan-step", l, "done"], SESS);

    cli(root, ["plan-step", "@reviewer", "pending"], SESS);
    expect(readState(root, SESS).plan.steps.map((s: any) => s.status)).toEqual(["done", "done", "done", "pending"]);

    // reset a step in the middle: the later duplicate is reset too
    cli(root, ["plan-step", "@backend", "pending"], SESS);
    expect(readState(root, SESS).plan.steps.map((s: any) => s.status)).toEqual(["done", "done", "pending", "pending"]);

    // plan-step done fills the FIRST pending one with that label
    cli(root, ["plan-step", "@reviewer", "done"], SESS);
    expect(readState(root, SESS).plan.steps.map((s: any) => s.status)).toEqual(["done", "done", "pending", "done"]);
  });

  it("plan survives other session.json writers (handoff issues recorded after a plan)", async () => {
    const root = await withSession();
    cli(root, ["plan", "@scribe"], SESS);
    stop(root, "scribe", "a1", "scribe done");
    const state = readState(root, SESS);
    expect(state.plan.steps).toHaveLength(1);
    expect(state.handoff_issues).toHaveLength(1);
  });
});

// ── 2. merge on a dirty worktree ────────────────────────────────────────────────────────────────

async function withWorktree(): Promise<{ root: string; wt: string }> {
  const root = await installed();
  // A worktree is only made when another live session holds a different task (SESS_B holds 001).
  for (const id of [SESS, SESS_B]) {
    fs.mkdirSync(sessionDir(root, id), { recursive: true });
    fs.writeFileSync(path.join(sessionDir(root, id), "log.jsonl"), '{"kind":"tool_call"}\n');
  }
  expect(cli(root, ["claim", "001-a.md"], SESS_B).stdout).toContain("claimed");
  expect(cli(root, ["claim", "002-b.md"], SESS).stdout).toContain("claimed");
  cli(root, ["worktree", "002-b.md"], SESS);
  const wt = path.join(path.dirname(root), `${path.basename(root)}-task-002`);
  expect(fs.statSync(wt).isDirectory()).toBe(true);
  return { root, wt };
}

function commitInWt(wt: string, file: string, content: string) {
  fs.mkdirSync(path.dirname(path.join(wt, file)), { recursive: true });
  fs.writeFileSync(path.join(wt, file), content);
  git(wt, "add", "-A");
  git(wt, "commit", "-q", "-m", "work");
}

describe("merge on a dirty worktree prints a commit suggestion (083)", () => {
  it("refuses, prints the worktree path, a title-based message and a runnable git -C command; changes nothing", async () => {
    const { root, wt } = await withWorktree();
    commitInWt(wt, "work.txt", "w\n");
    fs.writeFileSync(path.join(wt, "later.txt"), "uncommitted\n");
    expect(cli(wt, ["done", "002-b.md"], SESS).code).toBe(0);
    const head = git(root, "rev-parse", "HEAD");

    const run = cli(root, ["merge", "002-b.md"], null);

    expect(run.code).toBe(1);
    expect(run.stdout).toContain("REFUSED");
    expect(run.stdout).toContain("uncommitted changes");
    expect(run.stdout).toContain(`worktree: ${wt}`);
    expect(run.stdout).toContain("message:  Make the thing work (task 002)");
    expect(run.stdout).toContain("Never commit without the user's approval");
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(fs.existsSync(path.join(wt, "later.txt"))).toBe(true);

    // The printed command is real: running it makes the worktree clean and the next merge succeed.
    const command = /command:\s+(git -C .*)$/m.exec(run.stdout)![1];
    const sh = spawnSync("sh", ["-c", command], { encoding: "utf8", env: env(root, null) });
    expect(sh.status, sh.stderr).toBe(0);
    expect(git(wt, "status", "--porcelain")).toBe("");
    expect(git(wt, "log", "-1", "--format=%s")).toBe("Make the thing work (task 002)");
    const merged = cli(root, ["merge", "002-b.md"], null);
    expect(merged.code, merged.stdout).toBe(0);
    expect(fs.readFileSync(path.join(root, "later.txt"), "utf8")).toBe("uncommitted\n");
  });

  it("a title with an apostrophe is shell-quoted correctly", async () => {
    const { root, wt } = await withWorktree();
    fs.writeFileSync(path.join(tasksDir(root), "002-b.md"), "# Don't break it\n\n## Blocked by\n\nNone\n");
    fs.writeFileSync(path.join(wt, "x.txt"), "x\n");
    expect(cli(wt, ["done", "002-b.md"], SESS).code).toBe(0);

    const run = cli(root, ["merge", "002-b.md"], null);
    const command = /command:\s+(git -C .*)$/m.exec(run.stdout)![1];
    const sh = spawnSync("sh", ["-c", command], { encoding: "utf8", env: env(root, null) });
    expect(sh.status, sh.stderr).toBe(0);
    expect(git(wt, "log", "-1", "--format=%s")).toBe("Don't break it (task 002)");
  });

  it("a clean worktree gets no commit suggestion", async () => {
    const { root, wt } = await withWorktree();
    commitInWt(wt, "work.txt", "w\n");
    expect(cli(wt, ["done", "002-b.md"], SESS).code).toBe(0);
    const run = cli(root, ["merge", "002-b.md"], null);
    expect(run.code).toBe(0);
    expect(run.stdout).not.toContain("Suggested commit");
  });
});

// ── 3. colliding untracked files ────────────────────────────────────────────────────────────────

describe("merge lists untracked files in main that collide with the branch (083)", () => {
  it("refuses, listing an identical and a differing file correctly; nothing deleted or merged", async () => {
    const { root, wt } = await withWorktree();
    commitInWt(wt, "same.txt", "same content\n");
    commitInWt(wt, "dir/differs.txt", "branch copy\n");
    commitInWt(wt, "not-collided.txt", "n\n");
    expect(cli(wt, ["done", "002-b.md"], SESS).code).toBe(0);
    fs.writeFileSync(path.join(root, "same.txt"), "same content\n");
    fs.mkdirSync(path.join(root, "dir"), { recursive: true });
    fs.writeFileSync(path.join(root, "dir", "differs.txt"), "local edit\n");
    fs.writeFileSync(path.join(root, "unrelated.txt"), "u\n"); // untracked, not on the branch
    const head = git(root, "rev-parse", "HEAD");

    const run = cli(root, ["merge", "002-b.md"], null);

    expect(run.code).toBe(1);
    expect(run.stdout).toContain("REFUSED");
    expect(run.stdout).toContain("2 untracked file(s)");
    expect(run.stdout).toContain(`same.txt — identical to task-002's copy (safe to delete)`);
    expect(run.stdout).toContain(`dir/differs.txt — DIFFERENT from task-002's copy (needs a look before deleting)`);
    expect(run.stdout).not.toContain("unrelated.txt");
    expect(run.stdout).not.toContain("not-collided.txt");
    // nothing touched
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(fs.readFileSync(path.join(root, "same.txt"), "utf8")).toBe("same content\n");
    expect(fs.readFileSync(path.join(root, "dir", "differs.txt"), "utf8")).toBe("local edit\n");
    expect(fs.existsSync(wt)).toBe(true);
    expect(git(root, "branch", "--list", "task-002")).toContain("task-002");

    // after the user removes them, the merge goes through
    fs.rmSync(path.join(root, "same.txt"));
    fs.rmSync(path.join(root, "dir"), { recursive: true });
    const ok = cli(root, ["merge", "002-b.md"], null);
    expect(ok.code, ok.stdout).toBe(0);
    expect(fs.readFileSync(path.join(root, "dir", "differs.txt"), "utf8")).toBe("branch copy\n");
  });

  it("a collision on a byte-identical file with different line endings counts as different", async () => {
    const { root, wt } = await withWorktree();
    commitInWt(wt, "crlf.txt", "a\nb\n");
    expect(cli(wt, ["done", "002-b.md"], SESS).code).toBe(0);
    fs.writeFileSync(path.join(root, "crlf.txt"), "a\r\nb\r\n");
    const run = cli(root, ["merge", "002-b.md"], null);
    expect(run.code).toBe(1);
    expect(run.stdout).toContain("crlf.txt — DIFFERENT");
  });

  it("an empty file in main colliding with an empty branch file is identical", async () => {
    const { root, wt } = await withWorktree();
    commitInWt(wt, "empty.txt", "");
    expect(cli(wt, ["done", "002-b.md"], SESS).code).toBe(0);
    fs.writeFileSync(path.join(root, "empty.txt"), "");
    const run = cli(root, ["merge", "002-b.md"], null);
    expect(run.code).toBe(1);
    expect(run.stdout).toContain("empty.txt — identical");
  });

  it("a gitignored untracked file is not reported", async () => {
    const { root, wt } = await withWorktree();
    commitInWt(wt, "ignored.log", "x\n");
    expect(cli(wt, ["done", "002-b.md"], SESS).code).toBe(0);
    fs.writeFileSync(path.join(root, ".git", "info", "exclude"), "ignored.log\n");
    fs.writeFileSync(path.join(root, "ignored.log"), "x\n");
    const run = cli(root, ["merge", "002-b.md"], null);
    expect(run.stdout).not.toContain("untracked file(s)");
  });
});

// ── 5. sandbox-blocked merge ────────────────────────────────────────────────────────────────────

describe("merge SANDBOX-BLOCKED (083)", () => {
  it.skipIf(process.getuid?.() === 0)(
    "a write denial inside the main checkout is reported as SANDBOX-BLOCKED with the exact user command, merge aborted",
    async () => {
      const { root, wt } = await withWorktree();
      // A tracked file in a directory the merge cannot write into — the same failure shape as the
      // sandbox denying writes under .claude/skills ("unable to unlink old ...").
      fs.mkdirSync(path.join(root, "locked"), { recursive: true });
      fs.writeFileSync(path.join(root, "locked", "f.txt"), "base\n");
      git(root, "add", "-A");
      git(root, "commit", "-q", "-m", "locked");
      git(wt, "merge", "-q", "main");
      commitInWt(wt, "locked/f.txt", "changed on branch\n");
      expect(cli(wt, ["done", "002-b.md"], SESS).code).toBe(0);
      const head = git(root, "rev-parse", "HEAD");
      fs.chmodSync(path.join(root, "locked"), 0o555);

      const run = cli(root, ["merge", "002-b.md"], null);
      fs.chmodSync(path.join(root, "locked"), 0o755);

      expect(run.code).toBe(1);
      expect(run.stdout).toContain("merge SANDBOX-BLOCKED");
      expect(run.stdout).toContain("Do NOT retry");
      expect(run.stdout).toContain(
        `! CLAUDE_PROJECT_DIR='${root}' node '${path.join(root, ".claude", "scripts", "maestro-task-status.cjs")}' merge '002-b.md'`
      );
      expect(run.stdout).not.toContain("merged task-002");
      // no half-applied merge left behind, work intact
      expect(fs.existsSync(path.join(root, ".git", "MERGE_HEAD"))).toBe(false);
      expect(git(root, "rev-parse", "HEAD")).toBe(head);
      expect(fs.readFileSync(path.join(root, "locked", "f.txt"), "utf8")).toBe("base\n");
      expect(fs.existsSync(wt)).toBe(true);
      expect(git(root, "branch", "--list", "task-002")).toContain("task-002");

      // the printed command is what the user runs once the path is writable: it merges
      const again = cli(root, ["merge", "002-b.md"], null);
      expect(again.code, again.stdout).toBe(0);
    }
  );
});
