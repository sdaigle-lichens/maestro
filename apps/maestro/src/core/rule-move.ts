// Moving or reassigning a PROJECT rule without the desktop app (`081`).
//
// `/rules` does this in two steps the user never sees apart: the renderer edits the `rules` slice
// (one assignment per rule id — assigning again MOVES it) and `saveConfig` merges that slice into
// maestro.json and runs `applyRules`, which physically moves the `.claude/rules/<file>.md`. This
// module is the same two steps for a caller with no window: the terminal CLI
// `plugins/maestro/scripts/maestro-rules.cjs`, which the team-meeting skill uses to apply an
// approved `rule.move` / `rule.unassign` proposal.
//
// IT IS NOT A SECOND IMPLEMENTATION. Everything that decides what happens on disk and in the file is
// the app's own code, reached here rather than re-derived:
//   - the slice write is `saveConfig` (`mergeSlice` -> `writeConfig`), which replaces ONLY the
//     `rules` block and therefore preserves workflows, instances, gates, reports and handoffs;
//   - the placement is `applyRules`, which finds the file by id anywhere in the tree and moves it;
//   - the assignment shape is what `rule-tree.tsx` builds (`{ id, scope: "project" }` or
//     `{ id, paths: ["<dir>/**"] }`, plus `placement` when scope-only) with `source` stamped last,
//     as `rules.tsx`'s `handleAssign` does — so a rule moved from here is byte-for-byte what a
//     /rules save of the same move writes, and /rules shows it as a normal assignment.
//
// READ-BEFORE-WRITE. The `rules` slice has two writers (this and `/rules`), and `mergeSlice`
// replaces the whole block, so the new list is computed from a config read immediately before the
// save, never from one held earlier. A maestro.json that is missing, unreadable or not v3 is refused:
// `readConfig` answers a blank config for those, and saving a slice onto it would silently
// overwrite the user's file with a near-empty one.
//
// `fs`/`path` plus what `saveConfig` already pulls in; no `node:sqlite`, no Electron.

import fs from "node:fs";
import path from "node:path";
import { readConfig, readJsonSafe, maestroJsonPath } from "./config.js";
import { saveConfig } from "./save.js";
import { findProjectRuleFile, ruleIdOf, targetDirFor } from "./rules.js";
import { ruleSearchDirs, rulesFilesIn } from "./fs-scan.js";
import type { ApplyRulesSummary } from "./contracts.js";
import type { MaestroConfigV3, MaestroRuleV3 } from "./types.js";

export type RuleMoveResult =
  | { ok: true; id: string; to: string; placement: "move" | "scope-only"; rules: ApplyRulesSummary; warnings: string[] }
  | { ok: false; reason: string; configWritten?: boolean };

export type RuleUnassignResult =
  { ok: true; id: string; warnings: string[] } | { ok: false; reason: string; configWritten?: boolean };

export interface RuleListEntry {
  id: string;
  /** Project-relative directory the rule file lives in (its `.claude/rules/` parent). "" is the root. */
  dir: string;
  /** The rule's assignment in maestro.json, or null when it is not assigned. */
  assignment: { dir: string; placement: "move" | "scope-only" } | null;
}

/**
 * The `rules` list after assigning `assignment`: every earlier assignment of that id removed, the
 * new one appended with `source` last. This is `rules.tsx`'s `handleAssign`, as a pure function.
 */
export function assignRule(
  rules: MaestroRuleV3[],
  assignment: MaestroRuleV3,
  source: "project" | "vibe-rules" = "project"
): MaestroRuleV3[] {
  return [...rules.filter((r) => r.id !== assignment.id), { ...assignment, source }];
}

/** The `rule-tree.tsx` shape for a project-relative directory ("" = the project root). */
export function assignmentFor(id: string, relDir: string, scopeOnly: boolean): MaestroRuleV3 {
  const placement = scopeOnly ? ("scope-only" as const) : undefined;
  return relDir === "" ? { id, scope: "project", placement } : { id, paths: [`${relDir}/**`], placement };
}

/**
 * Normalise a user-supplied destination to a project-relative directory ("" = root), or explain why
 * it is refused. It must name an EXISTING directory inside the project: the app's picker can only
 * offer directories the tree walk found, so an invented path is never a valid assignment.
 */
export function resolveDestination(
  projectRoot: string,
  raw: string
): { ok: true; relDir: string } | { ok: false; reason: string } {
  let rel = raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/\*\*$/, "");
  rel = rel.replace(/^\.\/+/, "").replace(/\/+$/, "");
  if (rel === "" || rel === ".") return { ok: true, relDir: "" };
  if (path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel)) {
    return { ok: false, reason: `destination "${raw}" must be relative to the project root` };
  }
  const normal = path.posix.normalize(rel);
  if (normal === ".." || normal.startsWith("../") || normal.split("/").includes("..")) {
    return { ok: false, reason: `destination "${raw}" is outside the project` };
  }
  const segments = normal.split("/");
  if (segments[0] === ".claude" || segments[0] === ".git" || segments.includes("node_modules")) {
    return { ok: false, reason: `destination "${raw}" is not a place rules are assigned to` };
  }
  const abs = path.join(projectRoot, normal);
  let isDir = false;
  try {
    isDir = fs.statSync(abs).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) return { ok: false, reason: `destination "${raw}" is not a directory in this project` };
  return { ok: true, relDir: normal };
}

/** The config, or the reason it must not be written onto. */
function configToWriteOnto(projectRoot: string): { cfg: MaestroConfigV3 } | { reason: string } {
  const p = maestroJsonPath(projectRoot);
  if (!fs.existsSync(p)) return { reason: "this project has no .claude/maestro.json (Maestro is not installed here)" };
  const raw = readJsonSafe<{ version?: number }>(p);
  if (!raw || raw.version !== 3) {
    return { reason: ".claude/maestro.json is unreadable or not a v3 config, so a rules save would overwrite it" };
  }
  const cfg = readConfig(projectRoot);
  if (!cfg) return { reason: "this project has no .claude/maestro.json (Maestro is not installed here)" };
  return { cfg };
}

function dirOfRuleFile(projectRoot: string, file: string): string {
  const rel = path.relative(projectRoot, path.dirname(path.dirname(path.dirname(file))));
  return rel.split(path.sep).join("/");
}

/** Every project rule on disk, with where it lives and what maestro.json says about it. */
export function listRules(projectRoot: string): RuleListEntry[] {
  const cfg = readConfig(projectRoot);
  const out: RuleListEntry[] = [];
  const seen = new Set<string>();
  for (const dir of ruleSearchDirs(projectRoot)) {
    for (const file of rulesFilesIn(dir)) {
      const id = ruleIdOf(file);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const a = (cfg?.rules ?? []).find((r) => r.id === id);
      out.push({
        id,
        dir: dirOfRuleFile(projectRoot, file),
        assignment: a
          ? { dir: targetDirFor(a), placement: a.placement === "scope-only" ? "scope-only" : "move" }
          : null,
      });
    }
  }
  return out.sort((x, y) => x.id.localeCompare(y.id));
}

/**
 * Assign a project rule to a directory (or the root) and place its file there — what dropping the
 * rule's chip on a row of `/rules` and pressing Save does. Assigning an already-assigned rule moves
 * it. `scopeOnly` scopes without moving the file.
 */
export async function moveRule(
  projectRoot: string,
  ruleId: string,
  destination: string,
  opts: { scopeOnly?: boolean } = {}
): Promise<RuleMoveResult> {
  const id = ruleId.trim();
  if (!id) return { ok: false, reason: "a rule id is required" };
  if (!projectRoot || !fs.existsSync(projectRoot)) return { ok: false, reason: "the project directory does not exist" };

  const dest = resolveDestination(projectRoot, destination);
  if (!dest.ok) return dest;
  if (!findProjectRuleFile(projectRoot, id)) {
    return { ok: false, reason: `no project rule "${id}" found under any .claude/rules/ in this project` };
  }

  const scopeOnly = opts.scopeOnly === true;
  // Read right before the write: the slice is replaced whole.
  const current = configToWriteOnto(projectRoot);
  if (!("cfg" in current)) return { ok: false, reason: current.reason };
  const rules = assignRule(current.cfg.rules ?? [], assignmentFor(id, dest.relDir, scopeOnly));

  const saved = await saveConfig(projectRoot, { sliceType: "rules", slice: { rules } });
  const failure = saved.rules.errors.find((e) => e.id === id);
  if (failure) return { ok: false, reason: `${id}: ${failure.error}`, configWritten: true };
  if (saved.rules.missing.includes(id)) {
    return { ok: false, reason: `rule file for "${id}" disappeared while saving`, configWritten: true };
  }
  return {
    ok: true,
    id,
    to: dest.relDir,
    placement: scopeOnly ? "scope-only" : "move",
    rules: saved.rules,
    warnings: saved.warnings,
  };
}

/**
 * Remove a rule's assignment from maestro.json — the `×` on its chip in `/rules`, then Save. The
 * rule FILE is never touched: `applyRules` never deletes, and neither does this.
 */
export async function unassignRule(projectRoot: string, ruleId: string): Promise<RuleUnassignResult> {
  const id = ruleId.trim();
  if (!id) return { ok: false, reason: "a rule id is required" };
  const current = configToWriteOnto(projectRoot);
  if (!("cfg" in current)) return { ok: false, reason: current.reason };
  const before = current.cfg.rules ?? [];
  if (!before.some((r) => r.id === id)) return { ok: false, reason: `rule "${id}" is not assigned in maestro.json` };

  const saved = await saveConfig(projectRoot, {
    sliceType: "rules",
    slice: { rules: before.filter((r) => r.id !== id) },
  });
  return { ok: true, id, warnings: saved.warnings };
}
