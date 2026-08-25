#!/usr/bin/env node
// Applies the `rules` slice of <project>/.claude/maestro.json to the filesystem.
//
//   source:"project"    → MOVE the rule's .claude/rules/<file>.md into the assigned
//                          directory's .claude/rules/ (no-op if it's already there).
//   source:"vibe-rules" → install with `vibe-rules load <id> claude-code -t
//                          <dir>/.claude/rules/<id>.md` (appends a tagged block; skipped
//                          if that block is already present, so re-runs don't duplicate).
//   unassigned/removed  → left untouched. We NEVER delete rule files; that's the user's call.
//
//   node maestro-apply-rules.js [projectDir]
//
// Run by the maestro skill after maestro.json is written (host-side —
// the container can't reach project paths and vibe-rules is a host CLI). Idempotent.
// Prints a JSON summary to stdout.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const projectDir = process.argv[2] || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const IGNORE = ["node_modules", ".git", "dist", "build", ".next", ".turbo", ".output", ".claude"];
const MAX_DEPTH = 4;

function readMaestro() {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectDir, ".claude", "maestro.json"), "utf8"));
  } catch {
    return null;
  }
}

// Project-relative directory an assignment targets. `paths: ["src/x/**"]` → "src/x";
// scope-project / no paths → "" (project root).
function targetDirFor(rule) {
  if (Array.isArray(rule.paths) && rule.paths.length > 0) {
    return rule.paths[0].replace(/\/\*\*$/, "").replace(/\/+$/, "");
  }
  return "";
}

// Read the frontmatter `name:` (the rule id), falling back to the file basename — mirrors
// getProjectRules so we match the same id the form assigned.
function ruleIdOf(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const i = line.indexOf(":");
      if (i === -1) continue;
      if (line.slice(0, i).trim() === "name") {
        return line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  return path.basename(filePath).replace(/\.md$/, "");
}

// Locate the on-disk file for a project rule id by scanning every .claude/rules/ in the tree.
function findProjectRuleFile(id) {
  let result = null;
  walk(projectDir, 0);
  return result;

  function walk(dir, depth) {
    const rulesDir = path.join(dir, ".claude", "rules");
    let files = [];
    try {
      files = fs.readdirSync(rulesDir);
    } catch {
      files = [];
    }
    for (const entry of files) {
      if (!entry.endsWith(".md")) continue;
      const fp = path.join(rulesDir, entry);
      if (ruleIdOf(fp) === id) {
        result = fp;
        return;
      }
    }
    if (depth >= MAX_DEPTH || result) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || IGNORE.includes(e.name)) continue;
      walk(path.join(dir, e.name), depth + 1);
      if (result) return;
    }
  }
}

// vibe-rules wraps its content in <id>…</id>; presence of the opening tag means already installed.
function alreadyInstalled(file, id) {
  try {
    return fs.readFileSync(file, "utf8").includes(`<${id}>`);
  } catch {
    return false;
  }
}

function main() {
  const maestro = readMaestro();
  const summary = { moved: [], installed: [], unchanged: [], skipped: [], missing: [], errors: [] };
  if (!maestro || maestro.version !== 3 || !Array.isArray(maestro.rules)) {
    process.stdout.write(JSON.stringify(summary));
    return;
  }

  for (const rule of maestro.rules) {
    const relDir = targetDirFor(rule);
    const targetRulesDir = path.join(projectDir, relDir, ".claude", "rules");
    const source = rule.source || "project";

    if (source === "vibe-rules") {
      const targetFile = path.join(targetRulesDir, `${rule.id}.md`);
      if (alreadyInstalled(targetFile, rule.id)) {
        summary.skipped.push({ id: rule.id, dir: relDir, reason: "already installed" });
        continue;
      }
      try {
        fs.mkdirSync(targetRulesDir, { recursive: true });
        execFileSync("vibe-rules", ["load", rule.id, "claude-code", "-t", targetFile], { stdio: "pipe" });
        summary.installed.push({ id: rule.id, dir: relDir });
      } catch (e) {
        summary.errors.push({ id: rule.id, error: String((e && e.message) || e) });
      }
      continue;
    }

    // source === "project": move the existing file into the assigned directory.
    const current = findProjectRuleFile(rule.id);
    if (!current) {
      summary.missing.push(rule.id);
      continue;
    }
    const targetFile = path.join(targetRulesDir, path.basename(current));
    if (path.resolve(current) === path.resolve(targetFile)) {
      summary.unchanged.push({ id: rule.id, dir: relDir });
      continue;
    }
    try {
      fs.mkdirSync(targetRulesDir, { recursive: true });
      fs.renameSync(current, targetFile);
      summary.moved.push({
        id: rule.id,
        from: path.relative(projectDir, current),
        to: path.relative(projectDir, targetFile),
      });
    } catch (e) {
      summary.errors.push({ id: rule.id, error: String((e && e.message) || e) });
    }
  }

  process.stdout.write(JSON.stringify(summary));
}

main();
