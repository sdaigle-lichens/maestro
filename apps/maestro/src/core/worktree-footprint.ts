// What a task worktree holds that git does not (`163`).
//
// A worktree is a fresh checkout: only tracked files travel into it. Two gaps follow, and this module
// owns both, project-agnostically (it names no package manager, test runner, language or file type):
//
//   1. Ignored files that exist ONLY in the worktree (a fixture a `.gitignore` rule keeps out of the
//      commit) pass every step there and are lost with the worktree. `ignoredOnlyInWorktree` lists
//      them so `merge` can stop and the user can commit, delete or waive them.
//   2. Git-excluded `.claude` directories that live below the repo root in the main checkout
//      (`apps/web/.claude`) do not exist in a new worktree. `provisionExcludedDirs` COPIES them in.
//
// The git runner is INJECTED as `(cwd, args) => { ok, out }`: a core module on the app's preview
// path may not import `child_process`, so the caller (the `maestro-task-status.cjs` CLI) owns the
// spawn. `fs`/`path` only, so it rides in the maestro-session bundle (no `node:sqlite`).

import fs from "node:fs";
import path from "node:path";

/** The injected git runner: run `git <args>` in `cwd`; `out` is its stdout. */
export type GitRunner = (cwd: string, args: string[]) => { ok: boolean; out: string };

/** Maestro's own per-session bookkeeping, never user content: never listed as "would be lost". */
const BOOKKEEPING = [".claude/maestro_sessions", ".claude/channels", ".claude/maestro.json"];

const isBookkeeping = (rel: string): boolean =>
  BOOKKEEPING.some((b) => rel === b || rel === `${b}/` || rel.startsWith(`${b}/`));

/** Ignored paths under `cwd`, wholly ignored directories collapsed to one `dir/` entry. */
function ignoredPaths(git: GitRunner, cwd: string): string[] {
  const r = git(cwd, ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"]);
  if (!r.ok) return [];
  return r.out.split("\0").filter((p) => p !== "");
}

/**
 * Ignored paths present in the worktree and ABSENT from the main checkout, wholly ignored
 * directories collapsed to one entry. An entry present in both checkouts is environment (installed
 * or generated state the worktree shares the shape of), not something the commit would lose.
 */
export function ignoredOnlyInWorktree(git: GitRunner, mainRoot: string, wtPath: string): string[] {
  const out: string[] = [];
  for (const rel of ignoredPaths(git, wtPath)) {
    if (isBookkeeping(rel)) continue;
    if (fs.existsSync(path.join(mainRoot, rel))) continue;
    out.push(rel);
  }
  return out;
}

/** The notice for a non-empty `list`: what is at risk and the three ways out. Empty for none. */
export function formatIgnoredNotice(list: string[], wtPath: string): string {
  if (list.length === 0) return "";
  const shown = list.slice(0, 20).map((p) => `  ${p}`);
  if (list.length > shown.length) shown.push(`  ... and ${list.length - shown.length} more`);
  return (
    `Maestro tasks: ${list.length} ignored path(s) exist ONLY in the worktree ${wtPath}. Git ignores them, so the ` +
    `commit does not carry them: whatever depended on them passed here but will not on the merged branch, and they ` +
    `are deleted with the worktree.\n${shown.join("\n")}\n` +
    "Pick one for each:\n" +
    "  1. commit them: `git add -f <path>` in the worktree, then commit (the user approves the commit);\n" +
    "  2. delete them if nothing needs them;\n" +
    "  3. waive the check with `merge <task> --accept-ignored` if losing them is intended.\n"
  );
}

/** Is `rel` inside (or is) a `.claude` directory nested BELOW the repo root, not the root's own? */
function nestedClaudeEntry(rel: string): boolean {
  const parts = rel.replace(/\/$/, "").split("/");
  return parts.length > 1 && parts.slice(1).includes(".claude");
}

/**
 * Copy every git-excluded entry that sits in a `.claude` directory below the repo root of the main
 * checkout (`apps/web/.claude`) into the same place in the worktree. A COPY, never a symlink: a
 * `dir/` ignore rule does not match a symlink, so a link would show up as untracked. After copying,
 * `git status` in the worktree must not list any copy as untracked; one that does (no ignore rule
 * covers it there) is removed again and goes into `warned`, so nothing is left to clean by hand.
 */
export function provisionExcludedDirs(
  git: GitRunner,
  mainRoot: string,
  wtPath: string
): { copied: string[]; warned: string[] } {
  const copied: string[] = [];
  const warned: string[] = [];
  const candidates = ignoredPaths(git, mainRoot).filter((rel) => nestedClaudeEntry(rel));
  const done: string[] = [];
  for (const rel of candidates) {
    const clean = rel.replace(/\/$/, "");
    const src = path.join(mainRoot, clean);
    const dest = path.join(wtPath, clean);
    if (done.some((d) => clean === d || clean.startsWith(`${d}/`))) continue;
    if (fs.existsSync(dest)) continue; // tracked content already there: never overwritten
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.cpSync(src, dest, { recursive: true, force: false, errorOnExist: false, dereference: false });
      done.push(clean);
      copied.push(clean);
    } catch {
      warned.push(clean);
      try {
        fs.rmSync(dest, { recursive: true, force: true });
      } catch {
        // nothing more to do
      }
    }
  }
  if (copied.length === 0) return { copied, warned };

  const status = git(wtPath, ["status", "--porcelain", "--untracked-files=all", "-z"]);
  const untracked = status.ok
    ? status.out
        .split("\0")
        .filter((l) => l.startsWith("?? "))
        .map((l) => l.slice(3))
    : [];
  for (const entry of [...copied]) {
    if (!untracked.some((u) => u === entry || u.startsWith(`${entry}/`))) continue;
    try {
      fs.rmSync(path.join(wtPath, entry), { recursive: true, force: true });
    } catch {
      // reported below anyway
    }
    copied.splice(copied.indexOf(entry), 1);
    warned.push(entry);
  }
  return { copied, warned };
}

/** What `provisionExcludedDirs` did, for the CLI to print; empty when it did nothing. */
export function formatExcludedProvision(r: { copied: string[]; warned: string[] }): string {
  const lines: string[] = [];
  if (r.copied.length) {
    lines.push(
      `Maestro tasks: copied git-excluded director${r.copied.length === 1 ? "y" : "ies"} from the main checkout into the worktree (ignored there too, so they never reach a commit): ${r.copied.join(", ")}.`
    );
  }
  if (r.warned.length) {
    lines.push(
      `Maestro tasks: NOT copied (the copy would show up as untracked in the worktree, or could not be written): ${r.warned.join(", ")}. ` +
        "Agents in the worktree run without them; tell the user."
    );
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}
