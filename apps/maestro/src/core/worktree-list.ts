// `075`: the worktrees of a project, and which of them the app may show as a Session Log tab.
//
// `worktree.ts` is the pure fs/path half (no git binary). Listing worktrees needs `git worktree
// list`, so it lives here, behind one injectable function so everything decided on top of it is
// testable with a canned list. Works for worktrees made by hand (`git worktree add`) exactly as for
// ones Maestro made: nothing here reads Maestro's own pointer files.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface WorktreeInfo {
  /** Absolute path of the working tree. */
  path: string;
  /** Short branch name (`task-074`), or `null` when detached or bare. */
  branch: string | null;
  /** Checked-out commit, when git reported one. */
  head: string | null;
  /** True for the main checkout (always git's first entry). */
  isMain: boolean;
  detached: boolean;
  locked: boolean;
  /** git considers the worktree's directory gone (`git worktree prune` would drop it). */
  prunable: boolean;
}

/** Parse `git worktree list --porcelain` output. The first block is the main checkout. */
export function parseWorktreeList(porcelain: string): WorktreeInfo[] {
  const out: WorktreeInfo[] = [];
  for (const block of porcelain.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    const first = lines.find((l) => l.startsWith("worktree "));
    if (!first) continue;
    const info: WorktreeInfo = {
      path: first.slice("worktree ".length),
      branch: null,
      head: null,
      isMain: out.length === 0,
      detached: false,
      locked: false,
      prunable: false,
    };
    for (const l of lines) {
      if (l.startsWith("HEAD ")) info.head = l.slice(5);
      else if (l.startsWith("branch ")) info.branch = l.slice(7).replace(/^refs\/heads\//, "");
      else if (l === "detached") info.detached = true;
      else if (l === "locked" || l.startsWith("locked ")) info.locked = true;
      else if (l === "prunable" || l.startsWith("prunable ")) info.prunable = true;
    }
    out.push(info);
  }
  return out;
}

/** Every worktree of `projectRoot`'s repository (main first), or `[]` when it is not a git repo / git is missing. */
export function listWorktrees(projectRoot: string): WorktreeInfo[] {
  if (!projectRoot) return [];
  try {
    const text = execFileSync("git", ["-C", projectRoot, "worktree", "list", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
    return parseWorktreeList(text);
  } catch {
    return [];
  }
}

export type WorktreeLister = (projectRoot: string) => WorktreeInfo[];

function canon(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** True when two paths name the same directory (symlink/trailing-slash safe; falls back to lexical). */
export function samePath(a: string, b: string): boolean {
  return canon(a) === canon(b);
}

/**
 * The LINKED worktrees (main checkout excluded) of `projectRoot`. The open project may itself be a
 * linked worktree; the list is still the repository's, minus the entry that is `projectRoot`.
 */
export function linkedWorktrees(projectRoot: string, list: WorktreeLister = listWorktrees): WorktreeInfo[] {
  return list(projectRoot).filter((w) => !w.isMain && !samePath(w.path, projectRoot));
}

export type ViewingRoot =
  { ok: true; root: string; worktree: WorktreeInfo } | { ok: false; reason: "no-project" | "not-a-worktree" };

/**
 * Accept `requested` as a worktree VIEWING root iff it is a linked worktree of `openProject`
 * according to git. Anything else is rejected outright; there is deliberately no fallback to the
 * project's own log, which would show the wrong run under the wrong tab. Returns the path as git
 * spells it, never the caller's spelling.
 */
export function resolveWorktreeRoot(
  openProject: string | null,
  requested: unknown,
  list: WorktreeLister = listWorktrees
): ViewingRoot {
  if (!openProject) return { ok: false, reason: "no-project" };
  if (typeof requested !== "string" || !path.isAbsolute(requested)) return { ok: false, reason: "not-a-worktree" };
  const hit = linkedWorktrees(openProject, list).find((w) => samePath(w.path, requested));
  return hit ? { ok: true, root: hit.path, worktree: hit } : { ok: false, reason: "not-a-worktree" };
}
