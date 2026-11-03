// `135`: a fresh task worktree has no installed dependencies. Pure detection (real temp dirs) plus the
// REAL installed CLI: `worktree` stops with the install command, and `done` refuses while it is missing.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { defaultish } from "./fixtures/configs.js";
import {
  detectPackageManager,
  installCommand,
  dependencyStatus,
  missingDependenciesNotice,
} from "../../src/core/worktree-deps.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const SESSION_A = "sess-aaa-111";
const SESSION_B = "sess-bbb-222";

let tmp: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-135-")));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function touch(dir: string, ...files: string[]) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(dir, f), f === "package.json" ? "{}\n" : "");
}

describe("detectPackageManager", () => {
  it.each([
    ["pnpm-lock.yaml", "pnpm"],
    ["package-lock.json", "npm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
  ])("%s -> %s", (lock, manager) => {
    touch(tmp, lock);
    expect(detectPackageManager(tmp)).toEqual({ kind: "detected", manager, lockfile: lock });
  });

  it("no lockfile is unknown", () => {
    expect(detectPackageManager(tmp)).toEqual({ kind: "unknown" });
  });

  it("two managers' lockfiles are ambiguous, but bun.lock + bun.lockb is one manager", () => {
    touch(tmp, "pnpm-lock.yaml", "yarn.lock");
    expect(detectPackageManager(tmp)).toEqual({ kind: "ambiguous", lockfiles: ["pnpm-lock.yaml", "yarn.lock"] });
    const bun = path.join(tmp, "bun");
    touch(bun, "bun.lock", "bun.lockb");
    expect(detectPackageManager(bun).kind).toBe("detected");
  });
});

describe("installCommand", () => {
  it("targets the worktree by absolute path for each manager", () => {
    expect(installCommand("pnpm", "/w")).toBe('pnpm --dir "/w" install');
    expect(installCommand("npm", "/w")).toBe('npm --prefix "/w" install');
    expect(installCommand("yarn", "/w")).toBe('yarn --cwd "/w" install');
    expect(installCommand("bun", "/w")).toBe('bun install --cwd "/w"');
  });
});

describe("dependencyStatus / missingDependenciesNotice", () => {
  it("no package.json: not applicable, no notice", () => {
    expect(dependencyStatus(tmp).state).toBe("not-applicable");
    expect(missingDependenciesNotice(tmp)).toBeNull();
  });

  it("package.json with node_modules: installed, no notice", () => {
    touch(tmp, "package.json");
    fs.mkdirSync(path.join(tmp, "node_modules", "left-pad"), { recursive: true });
    expect(dependencyStatus(tmp).state).toBe("installed");
    expect(missingDependenciesNotice(tmp)).toBeNull();
  });

  it("a node_modules holding only tool state is not an install; an install marker is", () => {
    touch(tmp, "package.json", "pnpm-lock.yaml");
    touch(path.join(tmp, "node_modules", ".pnpm-task-run-state-v1"), "latest.json");
    expect(dependencyStatus(tmp).state).toBe("missing");
    touch(path.join(tmp, "node_modules"), ".modules.yaml");
    expect(dependencyStatus(tmp).state).toBe("installed");
  });

  it("missing with a pnpm lockfile: STOP with the exact command", () => {
    touch(tmp, "package.json", "pnpm-lock.yaml");
    const notice = missingDependenciesNotice(tmp)!;
    expect(notice).toContain("STOP");
    expect(notice).toContain(`! pnpm --dir "${tmp}" install`);
  });

  it("missing with no lockfile: guidance, no guessed command", () => {
    touch(tmp, "package.json");
    const notice = missingDependenciesNotice(tmp)!;
    expect(notice).toContain("STOP");
    expect(notice).toContain("No recognised lockfile");
    expect(notice).not.toMatch(/! (pnpm|npm|yarn|bun)/);
  });

  it("missing with conflicting lockfiles: guidance naming them, no command", () => {
    touch(tmp, "package.json", "package-lock.json", "yarn.lock");
    const notice = missingDependenciesNotice(tmp)!;
    expect(notice).toContain("package-lock.json, yarn.lock");
    expect(notice).not.toMatch(/! (pnpm|npm|yarn|bun)/);
  });
});

describe("worktree CLI with missing dependencies", () => {
  function git(cwd: string, ...args: string[]) {
    return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }
  function cli(dir: string, args: string[], sessionId: string) {
    const res = spawnSync("node", [path.join(dir, ".claude", "scripts", "maestro-task-status.cjs"), ...args], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir, HOME: tmp, CLAUDE_CODE_SESSION_ID: sessionId },
    });
    return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  }
  async function repoWithPackage(): Promise<string> {
    const root = path.join(tmp, "repo");
    fs.mkdirSync(path.join(root, ".claude", "maestro-tasks"), { recursive: true });
    git(root, "init", "-q", "-b", "main");
    writeConfig(root, defaultish);
    await installRuntime(
      root,
      PLUGIN_ROOT,
      path.join(tmp, "r.sqlite"),
      path.join(tmp, "p.sqlite"),
      path.join(tmp, "h.sqlite")
    );
    touch(root, "package.json", "pnpm-lock.yaml");
    for (const [f, t] of [
      ["001-a.md", "A"],
      ["002-b.md", "B"],
    ]) {
      fs.writeFileSync(path.join(root, ".claude", "maestro-tasks", f), `# ${t}\n\n## Blocked by\n\nNone\n`);
    }
    for (const id of [SESSION_A, SESSION_B]) {
      const d = path.join(root, ".claude", "maestro_sessions", id);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, "log.jsonl"), '{"kind":"tool_call"}\n');
    }
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "init");
    expect(cli(root, ["claim", "001-a.md"], SESSION_A).stdout).toContain("claimed");
    return root;
  }

  it("stops with the install command, refuses done, and clears once node_modules exists", async () => {
    const root = await repoWithPackage();
    const wt = path.join(path.dirname(root), `${path.basename(root)}-task-002`);
    const made = cli(root, ["worktree", "002-b.md"], SESSION_B);
    expect(made.stdout).toContain(`worktree: ${wt}`);
    expect(made.stdout).toContain("STOP");
    expect(made.stdout).toContain(`! pnpm --dir "${wt}" install`);
    expect(fs.existsSync(path.join(wt, "node_modules"))).toBe(false); // nothing installed or linked

    const again = cli(root, ["worktree", "002-b.md"], SESSION_B);
    expect(again.stdout).toContain("already works in worktree");
    expect(again.stdout).toContain("STOP");

    const refused = cli(wt, ["done", "002-b.md"], SESSION_B);
    expect(refused.code).toBe(1);
    expect(refused.stdout).toContain("done REFUSED");

    fs.mkdirSync(path.join(wt, "node_modules", "left-pad"), { recursive: true });
    expect(cli(root, ["worktree", "002-b.md"], SESSION_B).stdout).not.toContain("STOP");
    const done = cli(wt, ["done", "002-b.md"], SESSION_B);
    expect(done.code).toBe(0);
    expect(done.stdout).toContain("marked");
    fs.rmSync(wt, { recursive: true, force: true });
  });

  it("freeform-check: no other live session means no worktree and no STOP", async () => {
    const root = await repoWithPackage();
    // Release session A's claim so nobody else is live.
    expect(cli(root, ["release", "001-a.md"], SESSION_A).code).toBe(0);
    const out = cli(root, ["freeform-check"], SESSION_B);
    expect(out.code).toBe(0);
    expect(out.stdout).toContain("no worktree needed");
    expect(out.stdout).not.toContain("STOP");
  });

  it("freeform-check: a new freeform worktree stops with the install command, re-run confirms", async () => {
    const root = await repoWithPackage(); // session A holds a live claim on 001
    const made = cli(root, ["freeform-check"], SESSION_B);
    expect(made.code).toBe(0);
    const m = made.stdout.match(/worktree: (\S+)/);
    expect(m).not.toBeNull();
    const wt = m![1];
    expect(made.stdout).toContain("STOP");
    expect(made.stdout).toContain(`! pnpm --dir "${wt}" install`);
    expect(fs.existsSync(path.join(wt, "node_modules"))).toBe(false);

    const again = cli(root, ["freeform-check"], SESSION_B);
    expect(again.stdout).toContain("already works in worktree");
    expect(again.stdout).toContain("STOP");
    expect(again.stdout).toContain(`! pnpm --dir "${wt}" install`);

    fs.mkdirSync(path.join(wt, "node_modules", "left-pad"), { recursive: true });
    const clear = cli(root, ["freeform-check"], SESSION_B);
    expect(clear.stdout).toContain("already works in worktree");
    expect(clear.stdout).not.toContain("STOP");
    fs.rmSync(wt, { recursive: true, force: true });
  });
});
