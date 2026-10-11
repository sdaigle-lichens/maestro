// Task 071: maestro-write-tasks.cjs always writes to the repository root's .claude/maestro-tasks.
// Fallback order under test: nearest ancestor with .claude/maestro.json > git root > start dir.
// Runs the REAL shipped script via spawnSync in throwaway dirs.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { findUpPluginRoot } from "../../src/core/install.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(findUpPluginRoot(here)!, "scripts", "maestro-write-tasks.cjs");

let tmp: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-071-")));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function mkdir(...p: string[]): string {
  const d = path.join(tmp, ...p);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function write(cwd: string, projectDir?: string) {
  const json = path.join(tmp, "slices.json");
  fs.writeFileSync(
    json,
    JSON.stringify([{ title: "Probe", whatToBuild: "x", acceptanceCriteria: ["a"], blockedBy: [] }])
  );
  const childEnv: NodeJS.ProcessEnv = { ...process["env"] };
  delete childEnv.CLAUDE_PROJECT_DIR;
  if (projectDir) childEnv.CLAUDE_PROJECT_DIR = projectDir;
  const r = spawnSync("node", [SCRIPT, json], { cwd, env: childEnv, encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
}

const hasTask = (root: string) => fs.existsSync(path.join(root, ".claude", "maestro-tasks", "001-probe.md"));

describe("maestro-write-tasks root resolution", () => {
  it("prefers the nearest .claude/maestro.json ancestor over the git root", () => {
    const repo = mkdir("repo");
    mkdir("repo", ".git");
    mkdir("repo", "apps", "app", ".claude");
    fs.writeFileSync(path.join(repo, "apps", "app", ".claude", "maestro.json"), "{}");
    write(mkdir("repo", "apps", "app", "src", "deep"));
    expect(hasTask(path.join(repo, "apps", "app"))).toBe(true);
    expect(hasTask(repo)).toBe(false);
  });

  it("falls back to the git root when no maestro.json exists", () => {
    const repo = mkdir("repo");
    mkdir("repo", ".git");
    write(mkdir("repo", "a", "b", ".claude", "skills"));
    expect(hasTask(repo)).toBe(true);
    expect(hasTask(path.join(repo, "a", "b"))).toBe(false);
  });

  it("falls back to the start dir when there is neither maestro.json nor .git", () => {
    const start = mkdir("loose", "sub");
    write(start);
    expect(hasTask(start)).toBe(true);
  });

  it("uses CLAUDE_PROJECT_DIR as the starting point instead of cwd", () => {
    const repo = mkdir("repo");
    mkdir("repo", "pkg");
    mkdir("repo", ".git");
    const elsewhere = mkdir("elsewhere");
    write(elsewhere, path.join(repo, "pkg"));
    expect(hasTask(repo)).toBe(true);
    expect(hasTask(elsewhere)).toBe(false);
  });

  it("treats a .git file (worktree/submodule) as a git root", () => {
    const repo = mkdir("wt");
    fs.writeFileSync(path.join(repo, ".git"), "gitdir: /nowhere\n");
    write(mkdir("wt", "x", "y"));
    expect(hasTask(repo)).toBe(true);
  });
});

// A new batch can depend on a task already in the queue, named by filename or NNN.
describe("maestro-write-tasks blockedBy on existing tasks", () => {
  const EXISTING = "001-earlier-work.md";

  function setup(): string {
    const repo = mkdir("repo");
    mkdir("repo", ".git");
    const dir = mkdir("repo", ".claude", "maestro-tasks");
    fs.writeFileSync(path.join(dir, EXISTING), "# Earlier work\n\n## Blocked by\n\nNone — can start immediately\n");
    return repo;
  }

  function run(repo: string, slices: unknown[]) {
    const json = path.join(tmp, "slices.json");
    fs.writeFileSync(json, JSON.stringify(slices));
    const childEnv: NodeJS.ProcessEnv = { ...process["env"], HOME: tmp, CLAUDE_PROJECT_DIR: repo };
    delete childEnv.CLAUDE_CODE_SESSION_ID;
    return spawnSync("node", [SCRIPT, json], { cwd: repo, env: childEnv, encoding: "utf8" });
  }

  const slice = (title: string, blockedBy: unknown[]) => ({
    title,
    whatToBuild: "x",
    acceptanceCriteria: ["a"],
    blockedBy,
  });

  const status = (repo: string) =>
    JSON.parse(fs.readFileSync(path.join(repo, ".claude", "maestro-tasks", "status.json"), "utf8"));

  it("resolves an existing task by number and by filename, alongside batch indices", () => {
    const repo = setup();
    const r = run(repo, [slice("By number", ["001"]), slice("By name and index", [EXISTING, 0])]);
    expect(r.status, r.stderr).toBe(0);
    const s = status(repo);
    expect(s["002-by-number.md"]).toEqual({ status: "blocked", blockedBy: [EXISTING] });
    expect(s["003-by-name-and-index.md"].blockedBy).toEqual([EXISTING, "002-by-number.md"]);
    const body = fs.readFileSync(path.join(repo, ".claude", "maestro-tasks", "002-by-number.md"), "utf8");
    expect(body).toContain(`## Blocked by\n\n- \`${EXISTING}\``);
  });

  it("refuses a name that matches no existing task and writes nothing", () => {
    const repo = setup();
    for (const ref of ["099", "001-missing.md"]) {
      const r = run(repo, [slice("Bad", [ref])]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(`blockedBy "${ref}" does not name exactly one existing task`);
    }
    expect(fs.readdirSync(path.join(repo, ".claude", "maestro-tasks"))).toEqual([EXISTING]);
  });
});
