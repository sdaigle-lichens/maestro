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
//   * `overwrittenByMerge` (`173`) — locally modified files the merge would overwrite, each compared
//     with the branch's copy, so `merge` refuses with their names and the resolving commands instead
//     of git's bare error; it never discards or stashes anything itself.
//   * `mergeTaskTrackers` (`173`) — a three-way merge of the task tracker, so the tracker change a
//     task committed on its branch lands even while the main checkout's tracker has moved on.
//
// Path bases (`173`). The Maestro project may sit BELOW the git top level (`<top>/sub`), so two bases
// exist and every path here is in exactly one of them:
//   * a repo path (`rel`) is relative to the git top level, forward slashes: the form
//     `git diff --name-only`, `ls-files --full-name`, `ls-tree --full-tree` and `<rev>:<path>` use, and
//     the form every refusal names. A repo path touches the filesystem only joined onto `top`
//     (`gitTopLevel`), never onto the project directory.
//   * a project path is relative to the project directory (Maestro's own `.claude/...` layout). It
//     becomes a repo path only through an explicit conversion: `projectPrefixFor` (the project's
//     `git rev-parse --show-prefix`) or `trackerRelPath`.
// Git commands may run from either directory; only their output's base matters, and each call below
// asks for the top-level form.
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

/**
 * True iff `rel` (forward slashes, relative to the git top level) is under one of
 * `MAESTRO_STATE_DIRS` of the project at `projectPrefix` below the top level (`""` when the project
 * is the top level; `"sub/"` for a project in `sub/`, see `projectPrefixFor`). `173`: git names
 * paths from the top level, so a project below it must be matched with its prefix.
 */
export function isMaestroStatePath(rel: string, projectPrefix = ""): boolean {
  const p = rel.replace(/\\/g, "/").replace(/^\.\//, "");
  const prefix = projectPrefix.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/*$/, "");
  const scoped = prefix ? `${prefix}/` : "";
  return MAESTRO_STATE_DIRS.some((d) => p.startsWith(`${scoped}${d}`) || `${p}/` === `${scoped}${d}`);
}

/**
 * `173`: the project's path below the git top level, as git reports it for `root`
 * (`git rev-parse --show-prefix`): `""` at the top level, `"sub/proj/"` for a nested project. Git
 * resolves symlinks itself, so a symlinked temp dir or checkout path never skews it. `""` when git
 * cannot answer.
 */
export function projectPrefixFor(git: GitRunner, root: string): string {
  const r = git(root, ["rev-parse", "--show-prefix"]);
  return r.ok ? r.out.trim() : "";
}

/**
 * `git diff --name-only` with its output pinned to repo paths (relative to the git top level) from
 * any cwd: a user's `diff.relative=true` would otherwise make it cwd-relative, and restrict it to the
 * cwd. `-c` rather than `--no-relative` so an older git accepts it too.
 */
const REPO_DIFF_NAMES: readonly string[] = ["-c", "diff.relative=false", "diff", "--name-only", "--no-renames", "-z"];

/**
 * Tracked paths with staged or unstaged changes in `root` (against HEAD), relative to the git top
 * level, Maestro's state files excepted. `git diff --name-only` rather than `status --porcelain`: an
 * injected runner may trim its output, which would eat porcelain's leading status column; a
 * NUL-separated name list survives it.
 */
export function dirtyTrackedPaths(git: GitRunner, root: string): string[] | null {
  const r = git(root, [...REPO_DIFF_NAMES, "HEAD"]);
  if (!r.ok) return null;
  const prefix = projectPrefixFor(git, root);
  return [
    ...new Set(
      r.out
        .split("\0")
        .map((rel) => rel.trim())
        .filter((rel) => rel !== "")
    ),
  ].filter((rel) => !isMaestroStatePath(rel, prefix));
}

/**
 * Untracked, not ignored paths in `root`, relative to the git top level (`--full-name`, the form
 * `dirtyTrackedPaths` uses), Maestro's state files excepted.
 */
export function untrackedPaths(git: GitRunner, root: string): string[] {
  const r = git(root, ["ls-files", "--others", "--exclude-standard", "--full-name", "-z"]);
  if (!r.ok) return [];
  const prefix = projectPrefixFor(git, root);
  return r.out.split("\0").filter((rel) => rel !== "" && !isMaestroStatePath(rel, prefix));
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
 * Of the repo paths `rels` (relative to the git top level `top`, as `pathsChangedBetween` returns
 * them) that a checkout would rewrite, those this process cannot write: the file itself or the
 * directory git must unlink it from or create it in. The sandbox's read-only mounts answer `EROFS`
 * here, so a switch that would stop halfway is caught before it runs. `173`: `top` is the git top
 * level, NOT the project directory: joining a repo path onto a project below the top level checks a
 * path that does not exist (`sub/sub/...`) and passes, and `git switch` then only warns and leaves
 * the file behind.
 */
export function unwritablePaths(top: string, rels: string[]): string[] {
  const out: string[] = [];
  for (const rel of rels) {
    const abs = path.join(top, rel);
    const exists = fs.existsSync(abs);
    const dir = exists ? path.dirname(abs) : nearestExistingDir(abs);
    if ((exists && !writable(abs)) || !writable(dir)) out.push(rel);
  }
  return out;
}

/**
 * The repo paths (relative to the git top level, whatever `root` is) a checkout from `from` to `to`
 * rewrites (`git diff --name-only -z from to`), or `null`.
 */
export function pathsChangedBetween(git: GitRunner, root: string, from: string, to: string): string[] | null {
  const r = git(root, [...REPO_DIFF_NAMES, from, to]);
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

// ── local changes the merge would overwrite (`173`) ─────────────────────────

/** The repository's top level for `root` (`git rev-parse --show-toplevel`), else `root` itself. */
export function gitTopLevel(git: GitRunner, root: string): string {
  const r = git(root, ["rev-parse", "--show-toplevel"]);
  return r.ok && r.out.trim() ? r.out.trim() : root;
}

/**
 * The task tracker (`<project>/.claude/maestro-tasks/status.json`) as a path relative to the git top
 * level `top`, forward slashes: the form `git diff --name-only` prints and `git show <rev>:<path>`
 * takes. The project may sit below the top level, so it is never assumed to be the top level itself.
 */
export function trackerRelPath(top: string, projectRoot: string): string {
  // Both resolved: git prints the top level with symlinks resolved (a temp dir on macOS), and the
  // project root may still carry them.
  const real = (p: string) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  };
  return path
    .relative(real(top), path.join(real(projectRoot), ".claude", "maestro-tasks", "status.json"))
    .split(path.sep)
    .join("/");
}

/** Tracked paths with staged or unstaged changes against HEAD in `top`, Maestro's state included. */
export function locallyModifiedPaths(git: GitRunner, top: string): string[] | null {
  const r = git(top, [...REPO_DIFF_NAMES, "HEAD"]);
  if (!r.ok) return null;
  return [...new Set(r.out.split("\0").filter((rel) => rel !== ""))];
}

export interface OverwrittenPath {
  /** Relative to the git top level, forward slashes. */
  rel: string;
  /** True iff the working copy is byte-for-byte the branch's copy (both absent counts as a match). */
  matchesBranch: boolean;
}

/**
 * The working copy's blob id for `rel` (`git hash-object`, which applies the same clean filters a
 * commit would), or null when the file is absent. Compared with the branch's blob id, never with
 * text an injected runner may have trimmed.
 */
function workingBlob(git: GitRunner, top: string, rel: string): string | null {
  if (!fs.existsSync(path.join(top, rel))) return null;
  const r = git(top, ["hash-object", "--", rel]);
  return r.ok ? r.out.trim() : null;
}

function branchBlob(git: GitRunner, top: string, branch: string, rel: string): string | null {
  const r = git(top, ["rev-parse", "--verify", "--quiet", `${branch}:${rel}`]);
  return r.ok && r.out.trim() ? r.out.trim() : null;
}

/** Whether each repo-relative path's working copy in `top` is the branch's copy. */
export function compareWithBranch(git: GitRunner, top: string, branch: string, rels: string[]): OverwrittenPath[] {
  return rels.map((rel) => {
    const mine = workingBlob(git, top, rel);
    const theirs = branchBlob(git, top, branch, rel);
    return { rel, matchesBranch: mine === theirs };
  });
}

/**
 * The locally modified tracked files in `top` that merging `branch` would write: changed on the
 * branch since its merge base with HEAD (`git diff HEAD...branch`) and changed in the working tree
 * or index. Git refuses such a merge with "Your local changes ... would be overwritten"; this names
 * them first. Paths in `except` (the task tracker, which `merge` merges itself) are left out.
 * `null` when git cannot answer.
 */
export function overwrittenByMerge(
  git: GitRunner,
  top: string,
  branch: string,
  except: readonly string[] = []
): OverwrittenPath[] | null {
  const local = locallyModifiedPaths(git, top);
  const theirs = git(top, [...REPO_DIFF_NAMES, `HEAD...${branch}`]);
  if (local === null || !theirs.ok) return null;
  const onBranch = new Set(theirs.out.split("\0").filter((rel) => rel !== ""));
  const hits = local.filter((rel) => onBranch.has(rel) && !except.includes(rel)).sort();
  return compareWithBranch(git, top, branch, hits);
}

/**
 * The file names in git's own "Your local changes to the following files would be overwritten by
 * merge:" error (one tab-indented path per line, until the "Please commit" line), or `[]`. The
 * fallback for a file rewritten after `overwrittenByMerge` looked (a background tool racing the merge).
 */
export function parseOverwriteError(text: string): string[] {
  const m = /local changes to the following files would be overwritten[^\n]*\n((?:[ \t]+\S[^\n]*\n?)+)/i.exec(text);
  if (!m) return [];
  return (m[1] as string)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * The body of `merge`'s refusal over locally modified files: each file, whether it matches the
 * branch's copy, and the commands that resolve it. Nothing is run: a file that matches loses nothing
 * by being restored (the merge brings the same content back); one that differs is stashed, so the
 * user's change survives and is re-applied after the merge. The user decides and runs them.
 */
export function formatOverwriteRefusal(top: string, branch: string, files: OverwrittenPath[]): string {
  const lines = files.map(
    (f) =>
      `  ${f.rel} — ${f.matchesBranch ? `identical to ${branch}'s copy (restoring it loses nothing)` : `DIFFERENT from ${branch}'s copy (a change of its own)`}`
  );
  const matching = files.filter((f) => f.matchesBranch).map((f) => shellQuote(f.rel));
  const differ = files.filter((f) => !f.matchesBranch).map((f) => shellQuote(f.rel));
  const at = `git -C ${shellQuote(top)}`;
  const steps: string[] = [];
  if (matching.length) steps.push(`  ${at} restore --source=HEAD --staged --worktree -- ${matching.join(" ")}`);
  if (differ.length)
    steps.push(`  ${at} stash push -m ${shellQuote(`before merging ${branch}`)} -- ${differ.join(" ")}`);
  const after = differ.length
    ? `\nThen ask for the merge again, and after it lands re-apply the stashed change with \`${at} stash pop\` (it may need resolving against the merged copy).`
    : "\nThen ask for the merge again.";
  return (
    `${lines.join("\n")}\n` +
    `To resolve (the user approves; nothing was discarded or stashed by this command):\n${steps.join("\n")}` +
    after
  );
}

// ── the task tracker's own merge (`173`) ────────────────────────────────────

export type TrackerMap = Record<string, Record<string, unknown>>;

/** `text` parsed as a tracker map, `{}` for anything that is not a JSON object. */
export function parseTracker(text: string | null | undefined): TrackerMap {
  if (!text) return {};
  try {
    const data: unknown = JSON.parse(text);
    return data && typeof data === "object" && !Array.isArray(data) ? (data as TrackerMap) : {};
  } catch {
    return {};
  }
}

const sameEntry = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Three-way merge of two task trackers that both moved on from `base`, task by task. A task only one
 * side changed takes that side's entry (a removal included). A task both sides changed keeps both
 * sides' fields (`ours` winning a disagreement), and is `done` when either side says so: a task is
 * never un-done by a merge. `ready`/`blocked` and `blockedBy` come out stale-but-harmless; the
 * caller recomputes the cascade from the task files (`sync`/`markMerged`) right after.
 */
export function mergeTaskTrackers(base: TrackerMap, ours: TrackerMap, theirs: TrackerMap): TrackerMap {
  const out: TrackerMap = {};
  for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
    const o = ours[key];
    const t = theirs[key];
    const b = base[key];
    let entry: Record<string, unknown> | undefined;
    if (sameEntry(o, t) || sameEntry(t, b)) entry = o;
    else if (sameEntry(o, b)) entry = t;
    else if (!o || !t) entry = o ?? t;
    else {
      entry = { ...t, ...o };
      if (o.status === "done" || t.status === "done") entry.status = "done";
    }
    if (entry) out[key] = entry;
  }
  return out;
}

/** Whether `rev`'s committed tracker at `rel` marks `task` done. */
export function trackerMarksDone(git: GitRunner, top: string, rev: string, rel: string, task: string): boolean {
  const r = git(top, ["show", `${rev}:${rel}`]);
  return r.ok && parseTracker(r.out)[task]?.status === "done";
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
