// The directory walk that finds every `.claude/skills` in a project tree.
//
// A copy of the relevant slice of apps/maestro/src/core/fs-scan.ts, kept deliberately identical in
// behaviour (same ignore list, same depth cap, root first then depth-first): concept skills live
// beside the code they explain, and the Maestro app discovers the same tree for its skill pickers.
// A second walk that skipped a different set of directories would make the two disagree about
// which skills exist.

import fs from "node:fs";
import path from "node:path";

export const IGNORE_DIRS = ["node_modules", ".git", "dist", "build", ".next", ".turbo", ".output"];
export const MAX_DEPTH = 4;

/** Every directory under `root` (excluding `root`), depth-first, in readdir order. `.claude` is skipped. */
function* walkDirs(root: string): Generator<string> {
  function* rec(dir: string, depth: number): Generator<string> {
    if (depth > MAX_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (IGNORE_DIRS.includes(entry.name) || entry.name === ".claude") continue;
      const absolute = path.join(dir, entry.name);
      yield absolute;
      yield* rec(absolute, depth + 1);
    }
  }
  yield* rec(root, 0);
}

/** `<dir>/.claude/skills`, or null when there is no such directory. */
function skillsDirIn(dir: string): string | null {
  const skillsDir = path.join(dir, ".claude", "skills");
  try {
    return fs.statSync(skillsDir).isDirectory() ? skillsDir : null;
  } catch {
    return null;
  }
}

/** Every `.claude/skills` directory in the tree: the root's, then each walked subdirectory's. */
export function skillSearchDirs(root: string): string[] {
  return [root, ...walkDirs(root)].map(skillsDirIn).filter((d): d is string => d !== null);
}
