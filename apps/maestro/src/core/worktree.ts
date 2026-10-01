// Git-worktree isolation for concurrent sessions (`074`) — the pure, `fs`/`path`-only half.
//
// When a session claims a task while ANOTHER live session already holds a claim in the same
// repository, the orchestrator does that task's work in a sibling git worktree on its own branch
// (see `maestro-task-status.cjs worktree`). Two roots then stop being the same directory:
//
//   queue root  — where `status.json` and `claims/` live. ALWAYS the main checkout, so a claim or a
//                 close made from inside a worktree is seen by every session and by the app.
//   state root  — where this session's gitignored `maestro_sessions/<id>/` lives, and where its
//                 agents work. The worktree, once one exists for the session.
//
// `mainCheckoutRoot` is the queue-root half: given any checkout root it answers "which working tree
// owns the queue". The state-root half is the pointer in session-paths.ts (`worktree.json`).
//
// No process spawning and no git binary here: a linked worktree's `.git` is a FILE reading
// `gitdir: <main>/.git/worktrees/<name>`, which is enough to find the main checkout. Creating a
// worktree needs the git binary and lives in the CLI, not here.

import fs from "node:fs";
import path from "node:path";

/** What the CLI records, in the main checkout's session directory, once a session has a worktree. */
export interface WorktreePointer {
  /** Absolute path of the worktree. */
  path: string;
  /** Branch the worktree is on. */
  branch: string;
  /** The task file this worktree was created for. */
  task: string;
  /** Absolute path of the main checkout that owns the queue. */
  main_root: string;
  created_at: string;
}

/** The zero-padded number at the front of a task filename (`074-foo.md` -> `074`), or `null`. */
export function taskNumber(filename: string): string | null {
  const m = /^(\d+)-/.exec(path.basename(filename));
  return m ? (m[1] as string) : null;
}

/** `task-074` — the branch a task's worktree is created on. `null` for a filename with no number. */
export function worktreeBranchFor(filename: string): string | null {
  const n = taskNumber(filename);
  return n ? `task-${n}` : null;
}

/** `<parent>/<repo>-task-074` — a SIBLING of the main checkout, named after the repo and the task. */
export function worktreePathFor(mainRoot: string, filename: string): string | null {
  const n = taskNumber(filename);
  if (!n) return null;
  return path.join(path.dirname(mainRoot), `${path.basename(mainRoot)}-task-${n}`);
}

/**
 * The main checkout owning `dir`'s repository: `dir` itself unless it is a LINKED worktree (its
 * `.git` is a file pointing into `<main>/.git/worktrees/<name>`). Anything unreadable or unexpected
 * answers `dir`, so a non-git folder or a main checkout behaves exactly as before.
 */
export function mainCheckoutRoot(dir: string): string {
  const gitEntry = path.join(dir, ".git");
  try {
    if (!fs.statSync(gitEntry).isFile()) return dir;
    const text = fs.readFileSync(gitEntry, "utf8");
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(text);
    if (!m) return dir;
    const gitDir = path.resolve(dir, m[1] as string);
    // <common>/worktrees/<name>
    if (path.basename(path.dirname(gitDir)) !== "worktrees") return dir;
    const common = path.dirname(path.dirname(gitDir));
    if (path.basename(common) !== ".git") return dir;
    return path.dirname(common);
  } catch {
    return dir;
  }
}

/** True iff `dir` is a linked worktree (not the main checkout). */
export function isLinkedWorktree(dir: string): boolean {
  return mainCheckoutRoot(dir) !== dir;
}
