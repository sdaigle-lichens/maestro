#!/usr/bin/env node
// Claude Code PostToolUse hook: run the linter/formatter on a file right after Claude (or one of its
// subagents) wrote it, and say something only when there is a problem. Zero dependencies (Node >= 18).
//
// Registered once in .claude/settings.json (hooks also fire inside subagents):
//   PostToolUse, matcher "Write|Edit|MultiEdit":
//   node "$CLAUDE_PROJECT_DIR/.claude/hooks/auto-lint-format.mjs"
//
// Config, .claude/hooks/auto-lint-format.json:
//   { "ignore": ["**/generated/**"],
//     "rules": [ { "match": ["*.py"], "commands": ["ruff format {file}", "ruff check {file}"] },
//                { "match": ["*.ts", "*.tsx"], "cwd": "apps/web", "commands": ["pnpm exec eslint {file}"] } ] }
//
// `match` globs are tested against the project-relative path (a pattern without `/` matches the file
// name only). `{file}` is replaced by the quoted absolute path; `cwd` is relative to the project root;
// `timeout` (seconds per command, default 30, max 120) drops a slow command silently.
// A file in another git worktree of the same repo (e.g. `git worktree add ../wt`, or a nested
// .claude/worktrees/<name>) uses that worktree as its root: its relative path, `cwd`, and its own
// config (falling back to the project's config) all resolve there, not in CLAUDE_PROJECT_DIR.
// Every command of every matching rule runs, in order, so a formatter that rewrites the file can come
// first. A command that exits non-zero is a finding.
//
// Output contract:
//   all commands pass       -> no output, exit 0: nothing reaches Claude or the user
//   a command fails (1..)   -> exit 2, its output on stderr: PostToolUse shows it to Claude, who fixes it
//   command not found, etc. -> exit 1 (127, 126): shown to the user only, a setup problem Claude can't fix
//   anything unexpected     -> exit 0: fails open, this is a convenience hook

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const CONFIG = path.join(".claude", "hooks", "auto-lint-format.json");
const DEFAULT_TIMEOUT_S = 30;
const MAX_TIMEOUT_S = 120;
const MAX_OUTPUT = 4000;
const ALWAYS_IGNORED = ["**/node_modules/**", "**/.git/**"];

const globToRegExp = (glob) => {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
};

const matches = (globs, relPath) =>
  globs.some((g) => globToRegExp(g).test(g.includes("/") ? relPath : path.posix.basename(relPath)));

const shellQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

const realpath = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

const git = (cwd, ...args) => {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 5000 });
  return result.status === 0 ? result.stdout.trim() : null;
};

const gitCommonDir = (dir) => {
  const common = git(dir, "rev-parse", "--git-common-dir");
  return common ? realpath(path.resolve(dir, common)) : null;
};

// The root of the git worktree holding `file` when it is another checkout of the project's repo
// (same git common dir), else null: the file is handled against the project dir as before.
const worktreeRoot = (projectDir, file) => {
  const top = git(path.dirname(file), "rev-parse", "--show-toplevel");
  if (!top) return null;
  const root = realpath(top);
  if (root === realpath(projectDir)) return null;
  const common = gitCommonDir(root);
  return common && common === gitCommonDir(projectDir) ? root : null;
};

const truncate = (text) => (text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n... (output truncated)` : text);

const main = () => {
  const input = JSON.parse(fs.readFileSync(0, "utf8"));
  const target = input.tool_input?.file_path;
  if (typeof target !== "string" || !target) return 0;

  const projectDir = path.resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
  let file = path.resolve(input.cwd || projectDir, target);
  if (!fs.existsSync(file)) return 0;
  // A file in a git worktree of this repo (sibling dir or nested under .claude/worktrees) belongs to
  // that checkout: paths, config and `cwd` resolve against the worktree root, not the main checkout.
  let root = projectDir;
  const worktree = worktreeRoot(projectDir, file);
  if (worktree) {
    root = worktree;
    file = realpath(file);
  }
  if (!file.startsWith(root + path.sep)) return 0;
  const relPath = path.relative(root, file).split(path.sep).join("/");

  let config;
  for (const dir of root === projectDir ? [projectDir] : [root, projectDir]) {
    try {
      config = JSON.parse(fs.readFileSync(path.join(dir, CONFIG), "utf8"));
      break;
    } catch {
      // try the next location
    }
  }
  if (!config) return 0;
  if (!Array.isArray(config.rules)) return 0;
  if (matches([...ALWAYS_IGNORED, ...(config.ignore ?? [])], relPath)) return 0;

  const findings = [];
  const setupProblems = [];
  for (const rule of config.rules) {
    if (!Array.isArray(rule.match) || !Array.isArray(rule.commands) || !matches(rule.match, relPath)) continue;
    const cwd = path.resolve(root, rule.cwd ?? ".");
    const seconds = Number(rule.timeout) > 0 ? Math.min(Number(rule.timeout), MAX_TIMEOUT_S) : DEFAULT_TIMEOUT_S;
    for (const template of rule.commands) {
      const command = String(template).split("{file}").join(shellQuote(file));
      const result = spawnSync("sh", ["-c", command], { cwd, encoding: "utf8", timeout: seconds * 1000 });
      if (result.error || result.signal) continue; // timeout or spawn failure: stay quiet
      if (result.status === 0) continue;
      const output = truncate(`${result.stdout ?? ""}${result.stderr ?? ""}`.trim());
      const line = `$ ${String(template).split("{file}").join(relPath)}\n${output}`;
      (result.status === 126 || result.status === 127 ? setupProblems : findings).push(line);
    }
  }

  if (findings.length) {
    process.stderr.write(`[auto-lint-format] ${relPath} has lint/format problems, please fix them:\n\n${findings.join("\n\n")}\n`);
    return 2;
  }
  if (setupProblems.length) {
    process.stderr.write(`[auto-lint-format] a configured command could not run for ${relPath}:\n\n${setupProblems.join("\n\n")}\n`);
    return 1;
  }
  return 0;
};

try {
  process.exit(main());
} catch (error) {
  console.error(`[auto-lint-format] hook error, ignoring: ${error?.message ?? error}`);
  process.exit(0);
}
