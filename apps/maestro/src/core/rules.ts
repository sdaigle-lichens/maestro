// Applies the `rules` slice of maestro.json to the filesystem.
//
// PORTED FROM plugins/maestro/scripts/maestro-apply-rules.js — Step 4 of the
// /maestro-app skill, another `node <script>` shell-out that only existed because the
// containerised app couldn't reach host paths (and `vibe-rules` is a host CLI).
//
//   source:"project"    → MOVE the rule's .claude/rules/<file>.md into the assigned directory's
//                          .claude/rules/ (no-op if it's already there).
//   source:"vibe-rules" → install with `vibe-rules load <id> claude-code -t <dir>/.claude/rules/<id>.md`
//                          (appends a tagged block; skipped if already present, so re-runs don't
//                          duplicate).
//   unassigned/removed  → left untouched. We NEVER delete rule files; that's the user's call.
//
// Idempotent.

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseFrontmatter } from "@repo/claude-fs";
import { rulesFilesIn, ruleSearchDirs } from "./fs-scan.js";
import type { MaestroConfigV3, MaestroRuleV3 } from "./types.js";

import type { ApplyRulesSummary } from "./contracts.js";
export type { ApplyRulesSummary };

const execFileAsync = promisify(execFile);

function emptySummary(): ApplyRulesSummary {
  return { moved: [], installed: [], unchanged: [], skipped: [], missing: [], errors: [] };
}

/**
 * Project-relative directory an assignment targets.
 * `paths: ["src/x/**"]` → "src/x"; scope-project / no paths → "" (project root).
 */
export function targetDirFor(rule: MaestroRuleV3): string {
  if (Array.isArray(rule.paths) && rule.paths.length > 0) {
    return rule.paths[0].replace(/\/\*\*$/, "").replace(/\/+$/, "");
  }
  return "";
}

/**
 * Read the frontmatter `name:` (the rule id), falling back to the file basename — mirrors
 * discoverProjectRules so we match the same id the form assigned.
 */
function ruleIdOf(filePath: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  return parseFrontmatter(text).name || path.basename(filePath).replace(/\.md$/, "");
}

/** Locate the on-disk file for a project rule id by scanning every .claude/rules/ in the tree. */
function findProjectRuleFile(projectRoot: string, id: string): string | null {
  for (const dir of ruleSearchDirs(projectRoot)) {
    for (const file of rulesFilesIn(dir)) {
      if (ruleIdOf(file) === id) return file;
    }
  }
  return null;
}

/** vibe-rules wraps its content in <id>…</id>; the opening tag means it's already installed. */
function alreadyInstalled(file: string, id: string): boolean {
  try {
    return fs.readFileSync(file, "utf8").includes(`<${id}>`);
  } catch {
    return false;
  }
}

/**
 * Place every rule assignment from the config. Never deletes: a rule removed from the config
 * leaves its file exactly where it is.
 */
export async function applyRules(
  projectRoot: string,
  cfg: Pick<MaestroConfigV3, "rules"> | null
): Promise<ApplyRulesSummary> {
  const summary = emptySummary();
  if (!cfg || !Array.isArray(cfg.rules)) return summary;

  for (const rule of cfg.rules) {
    const relDir = targetDirFor(rule);
    const targetRulesDir = path.join(projectRoot, relDir, ".claude", "rules");
    const source = rule.source || "project";

    if (source === "vibe-rules") {
      const targetFile = path.join(targetRulesDir, `${rule.id}.md`);
      if (alreadyInstalled(targetFile, rule.id)) {
        summary.skipped.push({ id: rule.id, dir: relDir, reason: "already installed" });
        continue;
      }
      try {
        fs.mkdirSync(targetRulesDir, { recursive: true });
        await execFileAsync("vibe-rules", ["load", rule.id, "claude-code", "-t", targetFile]);
        summary.installed.push({ id: rule.id, dir: relDir });
      } catch (e) {
        summary.errors.push({ id: rule.id, error: String((e as Error)?.message ?? e) });
      }
      continue;
    }

    // source === "project": move the existing file into the assigned directory.
    const current = findProjectRuleFile(projectRoot, rule.id);
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
        from: path.relative(projectRoot, current),
        to: path.relative(projectRoot, targetFile),
      });
    } catch (e) {
      summary.errors.push({ id: rule.id, error: String((e as Error)?.message ?? e) });
    }
  }

  return summary;
}
