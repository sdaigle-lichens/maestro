// Guards on the path that LANDS a finished task (`170`): the epic report and the task-status merge.
//
// In the worktree-handoff-fixes epic most failures were in landing, not building: done reports
// that named no commit, a main checkout left on a task branch (so one task merged into another
// task's branch), merges nobody verified, and a `git switch` back to the default branch that died
// halfway on sandbox-read-only paths. Prose told workers what to do; this module is what the scripts
// now enforce instead.
//
//   * `checkReportCommit` — a report for a task that is done must name a commit that exists and is
//     on the task's branch (`task-NNN`), or on the default branch once that branch is merged away.
//   * `checkTargetCheckout` — `merge` runs only into a checkout that is on the default branch with a
//     clean tracked tree; Maestro's own tracker and epic state files do not count as dirt.
//   * `unwritablePaths` — the paths a `git switch` would rewrite that this process cannot write (the
//     sandbox's read-only mounts), checked BEFORE switching so a switch never stops halfway.
//
// Project-agnostic: names no language, package manager or test runner. The git runner is INJECTED
// (`(cwd, args) => { ok, out }`), as in `worktree-footprint.ts`: a core module may not import
// `child_process`, so each CLI owns its spawn. `fs`/`path` only, so it rides in the
// maestro-session and maestro-epic bundles without `node:sqlite`.

import fs from "node:fs";
import path from "node:path";
import { worktreeBranchFor } from "./worktree.js";
import type { GitRunner } from "./worktree-footprint.js";

export type { GitRunner };

// ── the default branch ──────────────────────────────────────────────────────

/**
 * The repository's default branch: what `origin/HEAD` points at, else a local `main`, else a local
 * `master`, else `null`. Never guessed past that: a caller with `null` refuses and says why.
 */
export function defaultBranch(git: GitRunner, root: string): string | null {
  const remote = git(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (remote.ok && remote.out.trim()) {
    const name = remote.out.trim().replace(/^origin\//, "");
    if (name) return name;
  }
  for (const name of ["main", "master"]) {
    if (git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]).ok) return name;
  }
  return null;
}

/** The branch `root` has checked out, or `null` on a detached HEAD (or outside a repository). */
export function currentBranch(git: GitRunner, root: string): string | null {
  const r = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return r.ok && r.out.trim() ? r.out.trim() : null;
}

// ── Maestro's own state files ───────────────────────────────────────────────

/**
 * Paths Maestro itself writes during a run in the main checkout, which other live sessions keep
 * changing too: the task tracker and task files, and the epics' state, EPIC.md and inbox. They never
 * make a checkout "dirty" for the merge guard.
 */
export const MAESTRO_STATE_DIRS: readonly string[] = [".claude/maestro-tasks/", ".claude/epics/"];

/** True iff the repo-relative `rel` (forward slashes) is under one of `MAESTRO_STATE_DIRS`. */
export function isMaestroStatePath(rel: string): boolean {
  const p = rel.replace(/\\/g, "/").replace(/^\.\//, "");
  return MAESTRO_STATE_DIRS.some((d) => p.startsWith(d) || `${p}/` === d);
}

/**
 * Tracked paths with staged or unstaged changes in `root` (against HEAD), Maestro's state files
 * excepted. `git diff --name-only` rather than `status --porcelain`: an injected runner may trim its
 * output, which would eat porcelain's leading status column; a NUL-separated name list survives it.
 */
export function dirtyTrackedPaths(git: GitRunner, root: string): string[] | null {
  const r = git(root, ["diff", "--name-only", "--no-renames", "-z", "HEAD"]);
  if (!r.ok) return null;
  return [
    ...new Set(
      r.out
        .split("\0")
        .map((rel) => rel.trim())
        .filter((rel) => rel !== "")
    ),
  ].filter((rel) => !isMaestroStatePath(rel));
}

/** Untracked, not ignored paths in `root`, Maestro's state files excepted. */
export function untrackedPaths(git: GitRunner, root: string): string[] {
  const r = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  if (!r.ok) return [];
  return r.out.split("\0").filter((rel) => rel !== "" && !isMaestroStatePath(rel));
}

// ── the merge target ────────────────────────────────────────────────────────

export type TargetCheckoutVerdict =
  | { ok: true; branch: string; defaultBranch: string; untracked: string[] }
  | {
      ok: false;
      kind: "detached" | "mid-merge" | "no-default" | "not-default" | "dirty" | "unreadable";
      message: string;
      branch: string | null;
      defaultBranch: string | null;
      paths: string[];
    };

/**
 * Whether `root` (the main checkout) may receive a merge: not detached, not mid-merge, on the
 * default branch, and no tracked changes outside Maestro's state files. Untracked files do not
 * refuse (git's own untracked-collision check, and `merge`'s, cover the files that matter); they are
 * returned so the caller can say the verified tree held them.
 */
export function checkTargetCheckout(git: GitRunner, root: string): TargetCheckoutVerdict {
  const branch = currentBranch(git, root);
  const def = defaultBranch(git, root);
  const no = (kind: Extract<TargetCheckoutVerdict, { ok: false }>["kind"], message: string, paths: string[] = []) =>
    ({ ok: false, kind, message, branch, defaultBranch: def, paths }) as const;
  if (!branch)
    return no("detached", `the main checkout (${root}) is on a detached HEAD — check out the base branch first`);
  if (git(root, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).ok)
    return no("mid-merge", `the main checkout (${root}) is in the middle of a merge — finish or abort it first`);
  if (!def)
    return no(
      "no-default",
      `the default branch of ${root} cannot be determined (no origin/HEAD, and no local main or master branch)`
    );
  if (branch !== def)
    return no(
      "not-default",
      `the main checkout (${root}) is on branch ${branch}, not the default branch ${def} — a merge here would land in ${branch}`
    );
  const dirty = dirtyTrackedPaths(git, root);
  if (dirty === null) return no("unreadable", `could not read the status of ${root}`);
  if (dirty.length)
    return no(
      "dirty",
      `the main checkout (${root}) has uncommitted changes to ${dirty.length} tracked path(s) (e.g. ${dirty[0]}) — commit, stash or discard them first (Maestro's .claude/maestro-tasks/ and .claude/epics/ files do not count)`,
      dirty
    );
  return { ok: true, branch, defaultBranch: def, untracked: untrackedPaths(git, root) };
}

// ── switching back to the default branch ────────────────────────────────────

function nearestExistingDir(abs: string): string {
  let dir = path.dirname(abs);
  while (!fs.existsSync(dir)) {
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return dir;
}

function writable(abs: string): boolean {
  try {
    fs.accessSync(abs, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Of the repo-relative `rels` that a checkout would rewrite in `root`, those this process cannot
 * write: the file itself or the directory git must unlink it from or create it in. The sandbox's
 * read-only mounts answer `EROFS` here, so a switch that would stop halfway is caught before it runs.
 */
export function unwritablePaths(root: string, rels: string[]): string[] {
  const out: string[] = [];
  for (const rel of rels) {
    const abs = path.join(root, rel);
    const exists = fs.existsSync(abs);
    const dir = exists ? path.dirname(abs) : nearestExistingDir(abs);
    if ((exists && !writable(abs)) || !writable(dir)) out.push(rel);
  }
  return out;
}

/** The paths a checkout from `from` to `to` rewrites (`git diff --name-only -z from to`), or `null`. */
export function pathsChangedBetween(git: GitRunner, root: string, from: string, to: string): string[] | null {
  const r = git(root, ["diff", "--name-only", "--no-renames", "-z", from, to]);
  if (!r.ok) return null;
  return r.out.split("\0").filter((rel) => rel !== "");
}

/** The exact command the USER runs with `!` to switch `root` to `branch` themselves. */
export function switchCommandFor(root: string, branch: string): string {
  return `! git -C ${shellQuote(root)} switch ${shellQuote(branch)}`;
}

function shellQuote(s: string): string {
  return /^[A-Za-z0-9_./@:=+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

// ── the epic report ─────────────────────────────────────────────────────────

/**
 * Commit-SHA candidates in free text: 7 to 40 hex characters, either case, standing alone (not part
 * of a longer word, number or identifier). Each is only a CANDIDATE: git decides whether it is a
 * commit. git resolves uppercase hex too; candidates are lowercased, so `DEADBEEF1` and `deadbeef1`
 * are one candidate.
 */
const SHA_CANDIDATE = /(?<![0-9A-Za-z_])[0-9a-fA-F]{7,40}(?![0-9A-Za-z_])/g;

/** Distinct SHA candidates in `body`, lowercased, in order of first appearance. */
export function shaCandidates(body: string): string[] {
  return [...new Set((body.match(SHA_CANDIDATE) ?? []).map((c) => c.toLowerCase()))];
}

/**
 * A line that declares the task done: an `Outcome:` or `Status:` label (markdown emphasis, a list
 * bullet or a heading mark allowed around it) whose value starts with done, complete, completed or
 * finished. `Outcome: blocked`, `Outcome: partial` and a sentence merely containing "done" do not.
 */
const DONE_LINE = /^[\s>*_#-]*(?:outcome|status)[\s*_]*:[\s*_]*(?:done|complete|completed|finished)\b/im;

/** True iff `body` has a line declaring the task done (see `DONE_LINE`). */
export function declaresDone(body: string): boolean {
  return DONE_LINE.test(body);
}

export type ReportCommitVerdict =
  | { ok: true; checked: false }
  | { ok: true; checked: true; sha: string; on: string }
  | { ok: false; missing: "no-sha" | "no-such-commit" | "not-on-branch"; message: string };

function isAncestor(git: GitRunner, root: string, a: string, b: string): boolean {
  return git(root, ["merge-base", "--is-ancestor", a, b]).ok;
}

/** Commits on `branch` that `base` does not have; 0 when unreadable. */
function commitsBeyond(git: GitRunner, root: string, base: string, branch: string): number {
  const r = git(root, ["rev-list", "--count", `${base}..${branch}`]);
  const n = r.ok ? Number.parseInt(r.out.trim(), 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

/** True iff commit `sha`'s message names the task: `branch` (task-NNN) as a whole word, or `file`. */
function namesTask(git: GitRunner, root: string, sha: string, branch: string | null, file: string): boolean {
  const r = git(root, ["log", "-1", "--format=%B", sha]);
  if (!r.ok) return false;
  if (r.out.includes(file)) return true;
  return branch !== null && new RegExp(`(?<![0-9A-Za-z_-])${branch}(?![0-9A-Za-z_])`).test(r.out);
}

function branchExists(git: GitRunner, root: string, branch: string): boolean {
  return git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).ok;
}

/**
 * Whether a report about `task` may be written. A report counts as declaring the task done when
 * the tracker already says `done` (`trackerDone`: the orchestrator reports after `done`) or the body
 * has a done line (`declaresDone`). Such a report must name a commit that:
 *
 *   1. exists (`git rev-parse --verify <sha>^{commit}`), and
 *   2. while `task-NNN` has commits the default branch lacks: is on `task-NNN` and NOT already on
 *      the default branch (that would be the commit the task started from, not one holding its
 *      work); or, when there is no `task-NNN`, or it has no commits of its own (empty, or merged),
 *      is on the default branch AND its message names `task-NNN` or the task file (the
 *      `Merge task-NNN (...)` commit `merge` writes, a squash, a hand-merged or fast-forwarded one).
 *
 * Any candidate that passes is enough. A report that does not declare the task done passes unchecked.
 */
export function checkReportCommit(
  git: GitRunner,
  root: string,
  input: { task: string; body: string; trackerDone: boolean }
): ReportCommitVerdict {
  const base = path.basename(input.task);
  if (!input.trackerDone && !declaresDone(input.body)) return { ok: true, checked: false };
  const refuse = (missing: Extract<ReportCommitVerdict, { ok: false }>["missing"], why: string) =>
    ({
      ok: false,
      missing,
      message:
        `report REFUSED — "${base}" is done, but ${why}. A done report must name the commit holding the task's work. ` +
        `Commit it on the task branch first (the user approves the commit), put that commit's SHA in the report, then run this again. Nothing was written.`,
    }) as const;

  const candidates = shaCandidates(input.body);
  if (candidates.length === 0) return refuse("no-sha", "the report names no commit SHA");

  const resolved: { short: string; sha: string }[] = [];
  for (const c of candidates) {
    const r = git(root, ["rev-parse", "--verify", "--quiet", `${c}^{commit}`]);
    if (r.ok && r.out.trim()) resolved.push({ short: c, sha: r.out.trim() });
  }
  if (resolved.length === 0) {
    const shown = candidates.slice(0, 3).join(", ");
    return refuse("no-such-commit", `no commit named in it exists in this repository (checked: ${shown})`);
  }

  const branch = worktreeBranchFor(base);
  const def = defaultBranch(git, root);
  const hasBranch = branch !== null && branchExists(git, root, branch);
  // The branch holds work of its own only while it has commits the default branch lacks. An empty
  // branch (created, never committed to) and a merged one both have none, so ancestry cannot tell
  // the task's commits from the base: both fall through to the message rule below.
  const ownCommits = hasBranch && (def === null || commitsBeyond(git, root, def, branch as string) > 0);
  let onDefaultOnly: string | null = null;
  for (const { short, sha } of resolved) {
    if (ownCommits) {
      if (!isAncestor(git, root, sha, branch as string)) continue;
      if (def !== null && isAncestor(git, root, sha, def)) {
        onDefaultOnly = onDefaultOnly ?? short;
        continue;
      }
      return { ok: true, checked: true, sha, on: branch as string };
    }
    // No branch work to point at: a default-branch commit counts only when its message makes it the
    // task's own (the `Merge task-NNN` commit `merge` writes, or a squash, hand merge or
    // fast-forwarded commit naming task-NNN or the task file). Anything else could be the base.
    if (def !== null && isAncestor(git, root, sha, def) && namesTask(git, root, sha, branch, base))
      return { ok: true, checked: true, sha, on: def };
  }
  const named = resolved.map((r) => r.short).join(", ");
  if (onDefaultOnly)
    return refuse(
      "not-on-branch",
      `commit ${onDefaultOnly} is already on ${def}, so it is what ${branch} started from, not a commit with the task's work`
    );
  if (ownCommits) return refuse("not-on-branch", `commit ${named} is not on the task branch ${branch}`);
  if (def === null)
    return refuse(
      "not-on-branch",
      `there is no task branch ${branch ?? "(the task has no number)"} and no default branch to look on`
    );
  const where = hasBranch
    ? `the task branch ${branch} has no commits of its own beyond ${def}`
    : `there is no task branch ${branch ?? "(the task has no number)"}`;
  const proof = branch
    ? `the \`Merge ${branch}\` commit or a commit whose message names ${branch} or ${base}`
    : `a commit whose message names ${base}`;
  return refuse(
    "not-on-branch",
    `${where}, and commit ${named} is not ${proof} on ${def} (it could be the commit the task started from)`
  );
}
