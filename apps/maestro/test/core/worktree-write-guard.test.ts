// `082` item 3: a session running its task in a git worktree may not write into the main checkout.
// Real git repo, real worktree made by the installed `maestro-task-status.cjs worktree`, the real
// plugin hook spawned with a PreToolUse payload. Nothing is mocked.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { checkWorktreeWrite } from "../../src/core/worktree-write-guard.js";
import { defaultish } from "./fixtures/configs.js";
import { pinnedEnv } from "../helpers/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const GUARD = path.join(PLUGIN_ROOT, "scripts", "maestro-channel-write-guard.js");

const SESSION_A = "sess-aaa-111";
const SESSION_B = "sess-bbb-222";

let tmp: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-082-")));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

const sessionDir = (root: string, id: string) => path.join(root, ".claude", "maestro_sessions", id);

function cli(dir: string, args: string[], sessionId: string) {
  return spawnSync("node", [path.join(dir, ".claude", "scripts", "maestro-task-status.cjs"), ...args], {
    encoding: "utf8",
    env: pinnedEnv(tmp, { CLAUDE_PROJECT_DIR: dir, CLAUDE_CODE_SESSION_ID: sessionId }),
  });
}

async function worktreeRun(): Promise<{ root: string; wt: string }> {
  const root = path.join(tmp, "repo");
  fs.mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  writeConfig(root, defaultish);
  await installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "r.sqlite"),
    path.join(tmp, "p.sqlite"),
    path.join(tmp, "h.sqlite")
  );
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "app.ts"), "main\n");
  fs.mkdirSync(path.join(root, ".claude", "maestro-tasks"), { recursive: true });
  for (const [f, t] of [
    ["001-a.md", "A"],
    ["002-b.md", "B"],
  ]) {
    fs.writeFileSync(path.join(root, ".claude", "maestro-tasks", f), `# ${t}\n\n## Blocked by\n\nNone\n`);
  }
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  for (const id of [SESSION_A, SESSION_B]) {
    fs.mkdirSync(sessionDir(root, id), { recursive: true });
    fs.writeFileSync(path.join(sessionDir(root, id), "log.jsonl"), '{"kind":"tool_call"}\n');
  }
  expect(cli(root, ["claim", "001-a.md"], SESSION_A).stdout).toContain("claimed");
  expect(cli(root, ["claim", "002-b.md"], SESSION_B).stdout).toContain("claimed");
  cli(root, ["worktree", "002-b.md"], SESSION_B);
  const wt = path.join(path.dirname(root), `${path.basename(root)}-task-002`);
  expect(fs.statSync(wt).isDirectory()).toBe(true);
  return { root, wt };
}

function runHook(cwd: string, sessionId: string, filePath: string, agentType = "backend") {
  const res = spawnSync("node", [GUARD], {
    encoding: "utf8",
    env: pinnedEnv(tmp, { CLAUDE_PROJECT_DIR: cwd, CLAUDE_CODE_SESSION_ID: sessionId }),
    input: JSON.stringify({
      cwd,
      session_id: sessionId,
      agent_type: agentType,
      tool_name: "Write",
      tool_input: { file_path: filePath },
    }),
  });
  const denied = res.stdout.includes('"permissionDecision":"deny"');
  return { denied, stdout: res.stdout };
}

describe("worktree write guard (082)", () => {
  it("denies a write into the main checkout's source and leaves main untouched", async () => {
    const { root, wt } = await worktreeRun();
    const target = path.join(root, "src", "new-module.ts");

    const run = runHook(wt, SESSION_B, target);

    expect(run.denied).toBe(true);
    expect(run.stdout).toContain(wt);
    expect(fs.existsSync(target)).toBe(false);
    expect(git(root, "status", "--porcelain")).toBe("");
  });

  it("denies .claude/scripts and .claude/skills in main; allows the worktree and shared dirs", async () => {
    const { root, wt } = await worktreeRun();
    expect(runHook(wt, SESSION_B, path.join(root, ".claude", "scripts", "x.cjs")).denied).toBe(true);
    expect(runHook(wt, SESSION_B, path.join(root, ".claude", "skills", "s", "SKILL.md")).denied).toBe(true);

    expect(runHook(wt, SESSION_B, path.join(wt, "src", "new-module.ts")).denied).toBe(false);
    expect(runHook(wt, SESSION_B, path.join(root, ".claude", "maestro-tasks", "002-b.md")).denied).toBe(false);
    expect(runHook(wt, SESSION_B, path.join(root, ".claude", "channels", "frontend", "backend.1.md")).denied).toBe(false);
    expect(runHook(wt, SESSION_B, path.join(root, ".claude", "maestro_sessions", SESSION_B, "x.json")).denied).toBe(false);
  });

  it("does not restrict a session that has no worktree", async () => {
    const { root } = await worktreeRun();
    expect(runHook(root, SESSION_A, path.join(root, "src", "new-module.ts")).denied).toBe(false);
  });
});

describe("checkWorktreeWrite (082) unit", () => {
  const worktree = { path: "/nope/wt", main_root: "/nope/main" };

  it("allows when there is no worktree or the tool does not write files", () => {
    expect(checkWorktreeWrite({ cwd: "/x", toolName: "Write", toolInput: { file_path: "/nope/main/a" }, worktree: null }).allow).toBe(true);
    expect(checkWorktreeWrite({ cwd: "/x", toolName: "Read", toolInput: { file_path: "/nope/main/a" }, worktree }).allow).toBe(true);
  });

  it("denies a main-checkout path and allows a worktree path", () => {
    expect(checkWorktreeWrite({ cwd: "/nope/wt", toolName: "Edit", toolInput: { file_path: "/nope/main/a.ts" }, worktree }).allow).toBe(false);
    expect(checkWorktreeWrite({ cwd: "/nope/wt", toolName: "Edit", toolInput: { file_path: "/nope/wt/a.ts" }, worktree }).allow).toBe(true);
  });

  it("resolves a relative path against cwd", () => {
    expect(checkWorktreeWrite({ cwd: "/nope/wt", toolName: "Write", toolInput: { file_path: "../main/a.ts" }, worktree }).allow).toBe(false);
  });
});

describe("merge conflict on a generated lib names the resolution (082)", () => {
  it("lists rebuild and copy steps when only libs and mirrors conflict", async () => {
    const { root, wt } = await worktreeRun();
    const lib = path.join("plugins", "maestro", "scripts", "lib", "maestro-scratch-lib.cjs");
    const mirror = path.join(".claude", "scripts", "lib", "maestro-scratch-lib.cjs");
    for (const f of [lib, mirror]) {
      fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
      fs.writeFileSync(path.join(root, f), "base\n");
    }
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "libs");
    // The worktree branched before this commit; bring it up to date, then diverge both sides.
    git(wt, "merge", "-q", "main");
    for (const f of [lib, mirror]) fs.writeFileSync(path.join(wt, f), "wt\n");
    git(wt, "add", "-A");
    git(wt, "commit", "-q", "-m", "wt libs");
    expect(cli(wt, ["done", "002-b.md"], SESSION_B).status).toBe(0);
    for (const f of [lib, mirror]) fs.writeFileSync(path.join(root, f), "main\n");
    git(root, "commit", "-qam", "main libs");

    const run = spawnSync("node", [path.join(root, ".claude", "scripts", "maestro-task-status.cjs"), "merge", "002"], {
      encoding: "utf8",
      env: pinnedEnv(tmp, {
        CLAUDE_PROJECT_DIR: root,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      }),
    });

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("pnpm --filter maestro build:plugin-libs");
    expect(run.stdout).toContain("cp plugins/maestro/scripts/lib/maestro-scratch-lib.cjs .claude/scripts/lib/maestro-scratch-lib.cjs");
  });

  it("gives no mirror-copy hint when a hand-written file (or the hand-maintained maestro-tasks.cjs) also conflicts", async () => {
    const { root, wt } = await worktreeRun();
    const files = [path.join("src", "app.ts"), path.join("plugins", "maestro", "scripts", "lib", "maestro-tasks.cjs")];
    for (const f of files) {
      fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
      fs.writeFileSync(path.join(root, f), "base\n");
    }
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "base");
    git(wt, "merge", "-q", "main");
    for (const f of files) fs.writeFileSync(path.join(wt, f), "wt\n");
    git(wt, "add", "-A");
    git(wt, "commit", "-q", "-m", "wt edits");
    expect(cli(wt, ["done", "002-b.md"], SESSION_B).status).toBe(0);
    for (const f of files) fs.writeFileSync(path.join(root, f), "main\n");
    git(root, "commit", "-qam", "main edits");

    const run = spawnSync("node", [path.join(root, ".claude", "scripts", "maestro-task-status.cjs"), "merge", "002"], {
      encoding: "utf8",
      env: pinnedEnv(tmp, {
        CLAUDE_PROJECT_DIR: root,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      }),
    });

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("CONFLICT");
    expect(run.stdout).not.toContain("build:plugin-libs");
    // The merge was aborted: no unmerged paths, and main still holds its own edit.
    expect(git(root, "diff", "--name-only", "--diff-filter=U")).toBe("");
    expect(fs.readFileSync(path.join(root, "src", "app.ts"), "utf8")).toBe("main\n");
  });
});
