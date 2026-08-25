// Shared directory-walk primitives.
//
// The same "walk the project, skipping build output, max 4 deep" loop was written three times
// in the web app and the plugin scripts — getProjectTree, getProjectRules, and
// maestro-apply-rules' findProjectRuleFile — each with its own slightly different ignore list.
// One implementation here, so a directory that's invisible to the rules picker is also
// invisible to the rules applier.

import fs from "node:fs";
import path from "node:path";

export const IGNORE_DIRS = ["node_modules", ".git", "dist", "build", ".next", ".turbo", ".output"];
export const MAX_DEPTH = 4;

export interface WalkOptions {
  maxDepth?: number;
  ignore?: string[];
  /** Also skip `.claude` itself — callers that read `<dir>/.claude/rules` directly want this. */
  skipClaudeDir?: boolean;
}

/**
 * Yield every directory under `root` (excluding `root` itself), depth-first, in readdir order.
 * `depth` is 0 for direct children.
 */
export function* walkDirs(
  root: string,
  opts: WalkOptions = {}
): Generator<{ absolute: string; relative: string; name: string; depth: number }> {
  const maxDepth = opts.maxDepth ?? MAX_DEPTH;
  const ignore = opts.ignore ?? IGNORE_DIRS;

  function* rec(
    dir: string,
    depth: number
  ): Generator<{
    absolute: string;
    relative: string;
    name: string;
    depth: number;
  }> {
    if (depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (ignore.includes(entry.name)) continue;
      if (opts.skipClaudeDir && entry.name === ".claude") continue;
      const absolute = path.join(dir, entry.name);
      yield { absolute, relative: path.relative(root, absolute), name: entry.name, depth };
      yield* rec(absolute, depth + 1);
    }
  }

  yield* rec(root, 0);
}

/** `<dir>/.claude/rules/*.md`, absolute paths. Empty when the directory doesn't exist. */
export function rulesFilesIn(dir: string): string[] {
  const rulesDir = path.join(dir, ".claude", "rules");
  try {
    return fs
      .readdirSync(rulesDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => path.join(rulesDir, f));
  } catch {
    return [];
  }
}

/**
 * Every directory that could hold a `.claude/rules/` — the project root plus every walked
 * subdirectory. Rules start at the root but get MOVED into assigned directories on save, so
 * both the picker and the applier have to search the whole tree to stay in agreement.
 */
export function ruleSearchDirs(root: string): string[] {
  return [root, ...Array.from(walkDirs(root, { skipClaudeDir: true }), (d) => d.absolute)];
}
