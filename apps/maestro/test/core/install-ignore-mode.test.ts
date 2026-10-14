// `--ignore-mode` on the plugin's maestro-install.js: `ignored` records `.claude/` in the
// clone-local git exclude file and never writes the committed .gitignore `# Maestro` block; absent
// or `committed` keeps today's behaviour. The app's installRuntime() has no equivalent.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { findUpPluginRoot } from "../../src/core/install.js";
import { pinnedEnv } from "../helpers/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_SCRIPTS = path.join(findUpPluginRoot(here)!, "scripts");
const INSTALLER = path.join(PLUGIN_SCRIPTS, "maestro-install.js");
const UNINSTALLER = path.join(PLUGIN_SCRIPTS, "maestro-uninstall.js");
const MARKER = "# Maestro (added by maestro-install)";

let tmp: string;
let home: string;
let n = 0;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "install-ignore-mode-"));
  home = path.join(tmp, "home");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function gitProject(): string {
  const root = path.join(tmp, `p${n++}`);
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

function run(root: string, ...flags: string[]) {
  const r = spawnSync("node", [INSTALLER, root, ...flags], { encoding: "utf8", env: pinnedEnv(home) });
  return { status: r.status, json: JSON.parse(r.stdout.trim().split("\n").pop()!) };
}

const exclude = (root: string) => path.join(root, ".git", "info", "exclude");
const lines = (file: string) => fs.readFileSync(file, "utf8").split(/\r?\n/);

describe("maestro-install.js --ignore-mode", () => {
  it("ignored: writes .claude/ to the exclude file and no .gitignore block", () => {
    const root = gitProject();
    fs.rmSync(path.join(root, ".git", "info"), { recursive: true, force: true });
    const { status, json } = run(root, "--ignore-mode", "ignored");
    expect(status).toBe(0);
    expect(json.ignoreMode).toBe("ignored");
    expect(json.wroteGitExclude).toBe(true);
    expect(json.wroteRepoGitignore).toBe(false);
    expect(lines(exclude(root))).toContain(".claude/");
    expect(fs.existsSync(path.join(root, ".gitignore"))).toBe(false);
  });

  it("ignored: is idempotent, no duplicate line on re-run", () => {
    const root = gitProject();
    run(root, "--ignore-mode", "ignored");
    const again = run(root, "--ignore-mode", "ignored");
    expect(again.json.wroteGitExclude).toBe(false);
    expect(lines(exclude(root)).filter((l) => l === ".claude/")).toHaveLength(1);
  });

  it("ignored: leaves an already-ignored .claude alone", () => {
    const root = gitProject();
    fs.writeFileSync(path.join(root, ".gitignore"), ".claude/\n");
    const { json } = run(root, "--ignore-mode", "ignored");
    expect(json.wroteGitExclude).toBe(false);
    expect(fs.readFileSync(path.join(root, ".gitignore"), "utf8")).toBe(".claude/\n");
  });

  it("committed and absent flag: write the .gitignore block, no exclude entry", () => {
    for (const flags of [[], ["--ignore-mode", "committed"]]) {
      const root = gitProject();
      const { json } = run(root, ...flags);
      expect(json.ignoreMode).toBe("committed");
      expect(json.wroteGitExclude).toBe(false);
      expect(json.wroteRepoGitignore).toBe(true);
      expect(lines(exclude(root))).not.toContain(".claude/");
    }
  });

  it("ignored: git worktree writes to the worktree's own exclude path, not a stale .git/info", () => {
    const main = gitProject();
    const git = (cwd: string, ...a: string[]) =>
      execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd, stdio: "ignore" });
    git(main, "commit", "-q", "--allow-empty", "-m", "init");
    const wt = path.join(tmp, "wt");
    git(main, "worktree", "add", "-q", wt, "-b", "wtbranch");
    const { status, json } = run(wt, "--ignore-mode", "ignored");
    expect(status).toBe(0);
    expect(json.wroteGitExclude).toBe(true);
    const expected = execFileSync("git", ["rev-parse", "--git-path", "info/exclude"], {
      cwd: wt,
      encoding: "utf8",
    }).trim();
    expect(fs.realpathSync(json.gitExcludePath)).toBe(fs.realpathSync(path.resolve(wt, expected)));
    expect(lines(json.gitExcludePath)).toContain(".claude/");
    expect(fs.existsSync(path.join(wt, ".gitignore"))).toBe(false);
    expect(fs.existsSync(path.join(wt, ".git", "info"))).toBe(false); // .git is a file in a worktree
  });

  it("ignored: appends on its own line to an exclude file lacking a trailing newline", () => {
    const root = gitProject();
    fs.writeFileSync(exclude(root), "*.log");
    run(root, "--ignore-mode", "ignored");
    expect(lines(exclude(root)).filter(Boolean)).toEqual(["*.log", MARKER, ".claude/"]);
  });

  it("ignored: .claude already in the exclude file is not duplicated", () => {
    const root = gitProject();
    fs.writeFileSync(exclude(root), "/.claude\n");
    const { json } = run(root, "--ignore-mode", "ignored");
    expect(json.wroteGitExclude).toBe(false);
    expect(fs.readFileSync(exclude(root), "utf8")).toBe("/.claude\n");
  });

  it("ignored: the installed .claude files are really ignored by git afterwards", () => {
    const root = gitProject();
    run(root, "--ignore-mode", "ignored");
    const out = execFileSync("git", ["status", "--porcelain", "-uall"], { cwd: root, encoding: "utf8" });
    expect(out).toBe("");
  });

  it("ignored: writes the marker above .claude/ exactly once", () => {
    const root = gitProject();
    run(root, "--ignore-mode", "ignored");
    run(root, "--ignore-mode", "ignored");
    const l = lines(exclude(root));
    expect(l.filter((x) => x === MARKER)).toHaveLength(1);
    expect(l[l.indexOf(MARKER) + 1]).toBe(".claude/");
  });

  it("refuses an unknown mode before writing anything", () => {
    const root = gitProject();
    const { status, json } = run(root, "--ignore-mode", "bogus");
    expect(status).toBe(1);
    expect(json.refused).toBe("ignore-mode");
    expect(fs.existsSync(path.join(root, ".claude"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".gitignore"))).toBe(false);
    expect(lines(exclude(root))).not.toContain(".claude/");
  });

  it("refuses ignored outside a git repo", () => {
    const root = path.join(tmp, "plain");
    fs.mkdirSync(root);
    const { status, json } = run(root, "--ignore-mode", "ignored");
    expect(status).toBe(1);
    expect(json.refused).toBe("ignore-mode");
    expect(fs.existsSync(path.join(root, ".claude"))).toBe(false);
  });
});

function uninstall(root: string, ...flags: string[]) {
  const r = spawnSync("node", [UNINSTALLER, root, ...flags], { encoding: "utf8", env: pinnedEnv(home) });
  return { status: r.status, json: JSON.parse(r.stdout.trim().split("\n").pop()!) };
}

describe("maestro-uninstall.js and the git exclude entry", () => {
  it("--purge removes the marker and the .claude/ line it added, keeping the rest", () => {
    const root = gitProject();
    fs.appendFileSync(exclude(root), "*.log\n");
    run(root, "--ignore-mode", "ignored");
    const { json } = uninstall(root, "--purge");
    expect(json.removedGitExclude).toBe(true);
    const l = lines(exclude(root));
    expect(l).not.toContain(MARKER);
    expect(l).not.toContain(".claude/");
    expect(l).toContain("*.log");
  });

  it("is idempotent: a second uninstall removes nothing", () => {
    const root = gitProject();
    run(root, "--ignore-mode", "ignored");
    uninstall(root, "--purge");
    const before = fs.readFileSync(exclude(root), "utf8");
    const again = uninstall(root, "--purge");
    expect(again.json.removedGitExclude).toBe(false);
    expect(fs.readFileSync(exclude(root), "utf8")).toBe(before);
  });

  it("never touches a .claude/ entry the user wrote themselves", () => {
    const root = gitProject();
    fs.appendFileSync(exclude(root), ".claude/\n");
    run(root, "--ignore-mode", "ignored");
    const { json } = uninstall(root, "--purge");
    expect(json.removedGitExclude).toBe(false);
    expect(lines(exclude(root))).toContain(".claude/");
  });

  it("a default (non-purge) uninstall keeps the entry", () => {
    const root = gitProject();
    run(root, "--ignore-mode", "ignored");
    const { json } = uninstall(root);
    expect(json.removedGitExclude).toBe(false);
    expect(lines(exclude(root))).toContain(".claude/");
  });

  it("is a no-op outside a git repo", () => {
    const root = path.join(tmp, "plain-uninstall");
    fs.mkdirSync(root);
    const { status, json } = uninstall(root, "--purge");
    expect(status).toBe(0);
    expect(json.removedGitExclude).toBe(false);
  });

  it("marker present but the .claude/ line below it edited: nothing is removed", () => {
    const root = gitProject();
    const content = `*.a\n${MARKER}\n/.claude/\n*.b\n`;
    fs.writeFileSync(exclude(root), content);
    expect(uninstall(root, "--purge").json.removedGitExclude).toBe(false);
    expect(fs.readFileSync(exclude(root), "utf8")).toBe(content);
  });

  it("marker as the last line, or followed by a blank line: nothing is removed", () => {
    for (const content of [`*.a\n${MARKER}`, `*.a\n${MARKER}\n`, `${MARKER}\n\n.claude/\n`]) {
      const root = gitProject();
      fs.writeFileSync(exclude(root), content);
      expect(uninstall(root, "--purge").json.removedGitExclude).toBe(false);
      expect(fs.readFileSync(exclude(root), "utf8")).toBe(content);
    }
  });

  it("CRLF exclude file: the pair is removed and surrounding CRLF lines survive byte-for-byte", () => {
    const root = gitProject();
    fs.writeFileSync(exclude(root), `*.a\r\n${MARKER}\r\n.claude/\r\n*.b\r\n`);
    expect(uninstall(root, "--purge").json.removedGitExclude).toBe(true);
    expect(fs.readFileSync(exclude(root), "utf8")).toBe("*.a\r\n*.b\r\n");
  });

  it("CRLF exclude file: install detects an existing CRLF .claude/ line and does not duplicate it", () => {
    const root = gitProject();
    fs.writeFileSync(exclude(root), "*.a\r\n.claude/\r\n");
    expect(run(root, "--ignore-mode", "ignored").json.wroteGitExclude).toBe(false);
    expect(fs.readFileSync(exclude(root), "utf8")).toBe("*.a\r\n.claude/\r\n");
  });

  it("content before and after the pair is preserved byte-for-byte (no trailing newline too)", () => {
    for (const tail of ["\n", ""]) {
      const root = gitProject();
      const before = "# comment\n*.log\n\n";
      const after = `build/\n!keep${tail}`;
      fs.writeFileSync(exclude(root), `${before}${MARKER}\n.claude/\n${after}`);
      expect(uninstall(root, "--purge").json.removedGitExclude).toBe(true);
      expect(fs.readFileSync(exclude(root), "utf8")).toBe(before + after);
    }
  });

  it("install, purge, reinstall round trip restores the same exclude file and a clean git status", () => {
    const root = gitProject();
    fs.writeFileSync(exclude(root), "*.log\n");
    expect(run(root, "--ignore-mode", "ignored").json.wroteGitExclude).toBe(true);
    const installed = fs.readFileSync(exclude(root), "utf8");
    expect(installed).toBe(`*.log\n${MARKER}\n.claude/\n`);
    expect(uninstall(root, "--purge").json.removedGitExclude).toBe(true);
    expect(fs.readFileSync(exclude(root), "utf8")).toBe("*.log\n");
    expect(fs.existsSync(path.join(root, ".claude", "maestro.json"))).toBe(false);
    expect(execFileSync("git", ["status", "--porcelain", "-uall"], { cwd: root, encoding: "utf8" })).not.toContain(
      "maestro"
    );
    expect(run(root, "--ignore-mode", "ignored").json.wroteGitExclude).toBe(true);
    expect(fs.readFileSync(exclude(root), "utf8")).toBe(installed);
    expect(execFileSync("git", ["status", "--porcelain", "-uall"], { cwd: root, encoding: "utf8" })).toBe("");
  });

  it("after purge git surfaces only the files purge deliberately keeps (settings, reports, handoffs)", () => {
    // Purge un-ignores .claude/, so the user-owned leftovers show as untracked; nothing Maestro-owned does.
    const root = gitProject();
    run(root, "--ignore-mode", "ignored");
    uninstall(root, "--purge");
    const out = execFileSync("git", ["status", "--porcelain", "-uall"], { cwd: root, encoding: "utf8" });
    const untracked = out
      .split("\n")
      .filter(Boolean)
      .map((l) => l.slice(3));
    expect(untracked.length).toBeGreaterThan(0);
    for (const f of untracked) {
      expect(f).toMatch(/^\.claude\/(settings\.json|reports\/|handoffs\/)/);
    }
  });

  it("works from a linked worktree (shared info/exclude)", () => {
    const main = gitProject();
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"], {
      cwd: main,
    });
    const wt = path.join(tmp, "wt");
    execFileSync("git", ["worktree", "add", "-q", wt, "-b", "side"], { cwd: main });
    const installed = run(wt, "--ignore-mode", "ignored");
    expect(installed.json.wroteGitExclude).toBe(true);
    expect(fs.realpathSync(installed.json.gitExcludePath)).toBe(fs.realpathSync(exclude(main)));
    expect(lines(exclude(main))).toContain(".claude/");
    expect(uninstall(wt, "--purge").json.removedGitExclude).toBe(true);
    expect(lines(exclude(main))).not.toContain(".claude/");
  });
});
