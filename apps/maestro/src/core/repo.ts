// "Is this directory inside a git repository?", answered with `fs` and nothing else.
//
// Its own module rather than a function in `git.ts` because two of its three callers must not be
// able to start a process. `claude-preview.ts` proves it cannot spawn by its import graph
// (`test/core/claude.test.ts`), and the scaffold's decision not to nest a repository has to hold on
// a machine with no `git` at all — so neither can reach for `git rev-parse`.
//
// That is not a workaround. `rev-parse` answers about the process's working directory when the
// directory it was pointed at does not exist yet, which is precisely the case here: the scaffold
// asks BEFORE it creates the marketplace.

import fs from "node:fs";
import path from "node:path";

/**
 * The root of the repository `dir` sits inside, or null. `dir` need not exist.
 *
 * `.git` is tested with `existsSync` rather than `isDirectory` on purpose: in a worktree or a
 * submodule it is a FILE pointing elsewhere, and those are repositories too — reinitialising inside
 * one is exactly the nesting this check prevents.
 */
export function enclosingRepo(dir: string): string | null {
  for (let cur = path.resolve(dir); ; cur = path.dirname(cur)) {
    if (fs.existsSync(path.join(cur, ".git"))) return cur;
    if (path.dirname(cur) === cur) return null;
  }
}
