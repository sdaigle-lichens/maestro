// Epic boundaries: decide whether an epic's start or end step is due, claim it atomically, and
// produce its scope. The maestro-manager skill calls this and never works out due-ness, once-only
// state or scope itself.
//
//   <epic dir>/boundary/<phase>-<n>/scope.txt   one path per line, sorted, relative to the git root
//                                               (the project root without git). The manager saves
//                                               each skill's output beside it, so a rerun gets a
//                                               new folder and never overwrites an earlier one.
//
// A run is claimed if and only if its scope file was written: the decision, the git calls, the
// scope write and the record all happen inside one `updateState` callback, so a throw records
// nothing. `epics.ts` keeps its fs/path-only rule, which is why the git calls live here. Git is
// reached directly rather than through `git.ts`, whose port only initialises repositories; every
// call is read-only and a failure means "no git answer", never an error.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { readClaims } from "./claims.js";
import { readConfig } from "./config.js";
import { epicDirFor, readEpicState, unacknowledgedHandles, updateState, type EpicState } from "./epics.js";
import { resolveSkillLists } from "./skill-lists.js";
import { readTaskTracker, sectionOf, tasksDirFor, type TrackerEntry } from "./tasks.js";
import { mainCheckoutRoot } from "./worktree.js";

export type EpicBoundaryPhase = "start" | "end";

export type EpicBoundaryResult =
  | { outcome: "none" }
  | { outcome: "not-due"; reason: string }
  | { outcome: "already-ran"; at: string }
  | {
      outcome: "run";
      skills: string[];
      /** Absolute path of this run's scope file. */
      scopeFile: string;
      /** How many paths the scope file holds. */
      paths: number;
    };

const BOUNDARY_DIR = "boundary";
const SCOPE_FILE = "scope.txt";
/** Below the epic lock's stale age, so a hung git can never get the lock broken under it. */
const GIT_TIMEOUT_MS = 10000;

/** One git output, or null when git failed: no git, not a repository, no commit, a bad revision. */
function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: GIT_TIMEOUT_MS,
    });
  } catch {
    return null;
  }
}

/**
 * The folder scope paths are relative to, as a real path: the git toplevel, or the project itself
 * when it is not in a repository. Git always answers with a real path, so `root` is resolved too,
 * or a project reached through a symlink would get a prefix full of `..`.
 */
function scopeBase(root: string): { base: string; prefix: string } {
  const real = fs.realpathSync(root);
  const base = git(root, ["rev-parse", "--show-toplevel"])?.trim() || real;
  return { base, prefix: path.relative(base, real).split(path.sep).join("/") };
}

/**
 * Files changed from `base` to HEAD, or null when `base` can't be diffed (unreachable, no git).
 * Paths are relative to the git root, and the `.` pathspec keeps them inside the project even when
 * it is nested in its repository, so a rename across the project's edge counts only on its inside
 * end. `diff.relative` is forced off because a user's setting would otherwise change the paths.
 */
function changedSince(root: string, base: string): string[] | null {
  if (!/^[0-9a-f]{7,64}$/.test(base)) return null;
  const out = git(root, ["-c", "diff.relative=false", "diff", "--name-only", "-z", base, "HEAD", "--", "."]);
  return out === null ? null : out.split("\0").filter(Boolean);
}

/**
 * One `## Touched surfaces` entry as a normalised relative path, or null for anything that is not
 * a bare path: an annotation or prose (whitespace), a glob, an absolute path, or a `..` segment.
 * Brackets are left to the existence check: `routes/[id].tsx` is a real file name.
 */
function surfacePath(line: string): string | null {
  const entry = line
    .trim()
    .replace(/^[-*+]\s+/, "")
    .replace(/^`([^`]*)`$/, "$1");
  if (!entry || /[\s`*?{}]/.test(entry) || entry.startsWith("~") || path.isAbsolute(entry)) return null;
  if (entry.split("/").includes("..")) return null;
  return path.posix.normalize(entry);
}

/** Every path the epic's tasks name under `## Touched surfaces`. A task without one adds nothing. */
function touchedSurfaces(root: string, tasks: string[]): string[] {
  const dir = tasksDirFor(root);
  return tasks.flatMap((task) => {
    let content: string;
    try {
      content = fs.readFileSync(path.join(dir, task), "utf8");
    } catch {
      return [];
    }
    const section = sectionOf(content, /^##\s+Touched surfaces\s*$/m) ?? "";
    return section
      .split("\n")
      .slice(1)
      .flatMap((line) => surfacePath(line) ?? []);
  });
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** Sorted, de-duplicated, existing files only: what a scope file holds. */
function scopeEntries(base: string, paths: string[]): string[] {
  return [...new Set(paths)].filter((p) => isFile(path.join(base, p))).sort();
}

/** Why the start moment has passed or has not come yet, or null when it is due. */
function startBlocker(root: string, state: EpicState, tasks: string[], tracker: Record<string, TrackerEntry>) {
  if (!tasks.length) return "the epic has no tasks yet";
  if (state.workers.length) return "the epic already has workers";
  const claims = readClaims(root, tasksDirFor(root));
  const running = tasks.filter((t) => claims.get(t)?.live);
  if (running.length) return `already running: ${running.join(", ")}`;
  const done = tasks.filter((t) => tracker[t].status === "done");
  return done.length ? `already done: ${done.join(", ")}` : null;
}

/**
 * Why the epic is not finished, or null when it is. Review requests do not hold it back.
 * `173`: an unacknowledged report or note FILE in the inbox counts even when the log no longer lists
 * it (a git operation put back an older `state.json`), and each is named by its handle, so two
 * entries sharing an id are both named, each the way `ack` takes it.
 */
function endBlocker(state: EpicState, epicDir: string, tasks: string[], tracker: Record<string, TrackerEntry>) {
  if (!tasks.length) return "the epic has no tasks";
  const open = tasks.filter((t) => tracker[t].status !== "done");
  if (open.length) return `not done: ${open.join(", ")}`;
  const unmerged = tasks.filter((t) => tracker[t].unmerged);
  if (unmerged.length) return `not merged: ${unmerged.join(", ")}`;
  const waiting = unacknowledgedHandles(state, epicDir);
  return waiting.length ? `not acknowledged: ${waiting.join(", ")}` : null;
}

/** `<epic dir>/boundary/<phase>-<n>`, one past the highest run on disk. Never reuses a folder. */
function nextRunDir(epicDir: string, phase: EpicBoundaryPhase): string {
  const parent = path.join(epicDir, BOUNDARY_DIR);
  const pattern = new RegExp(`^${phase}-(\\d+)$`);
  let used: number[] = [];
  try {
    used = fs.readdirSync(parent).map((name) => Number(pattern.exec(name)?.[1] ?? 0));
  } catch {
    // no run yet
  }
  return path.join(parent, `${phase}-${Math.max(0, ...used) + 1}`);
}

/**
 * The scope for one run, relative to the git root. A Touched surfaces entry names a project path
 * first and a repository path otherwise; `surfacePath` already refused `..`, so neither can leave
 * the git root.
 */
function buildScope(root: string, phase: EpicBoundaryPhase, commit: string | undefined, tasks: string[]): string[] {
  const { base, prefix } = scopeBase(root);
  const changed = phase === "end" && commit ? changedSince(root, commit) : null;
  const surfaces = () =>
    touchedSurfaces(root, tasks).map((p) => (isFile(path.join(root, p)) ? path.posix.join(prefix, p) : p));
  return scopeEntries(base, changed ?? surfaces());
}

/**
 * Decide, claim and scope one boundary. Throws on an unknown epic or a bad phase. Both lists empty
 * writes nothing. An empty start list with a non-empty end list still records the base commit at
 * the start moment, without claiming a run, so the end scope works.
 *
 * `force` re-runs a boundary already claimed, whatever the epic's state now; on one never claimed
 * it changes nothing, so it can't start a boundary that was not due. A re-run keeps the base.
 */
export function runEpicBoundary(
  projectRoot: string,
  slug: string,
  phase: EpicBoundaryPhase,
  options: { force?: boolean } = {}
): EpicBoundaryResult {
  if (phase !== "start" && phase !== "end") throw new Error(`"${String(phase)}" is not a boundary (start or end)`);
  // A relative CLAUDE_PROJECT_DIR passes through mainCheckoutRoot unchanged; the printed path must not.
  const absoluteRoot = path.resolve(projectRoot);
  const dir = epicDirFor(absoluteRoot, slug);
  if (!dir || !readEpicState(absoluteRoot, slug)) throw new Error(`no epic "${slug}"`);
  const root = mainCheckoutRoot(absoluteRoot);
  const { managerStart, managerEnd } = resolveSkillLists(readConfig(root));
  const skills = phase === "start" ? managerStart : managerEnd;
  if (!skills.length && (phase === "end" || !managerEnd.length)) return { outcome: "none" };

  return updateState<EpicBoundaryResult>(absoluteRoot, slug, (state) => {
    const claimed = skills.length ? state.boundaries?.[phase] : undefined;
    if (claimed && !options.force) return { outcome: "already-ran", at: claimed.at };

    const tracker = readTaskTracker(root);
    const tasks = Object.keys(tracker)
      .filter((t) => tracker[t].epic === slug)
      .sort();
    const boundaries = (state.boundaries ??= {});

    if (!claimed) {
      const reason =
        phase === "start" ? startBlocker(root, state, tasks, tracker) : endBlocker(state, dir, tasks, tracker);
      if (reason) return skills.length ? { outcome: "not-due", reason } : { outcome: "none" };
      if (phase === "start" && !boundaries.base) {
        const head = git(root, ["rev-parse", "HEAD"])?.trim();
        if (head) boundaries.base = head;
      }
    }
    if (!skills.length) return { outcome: "none" };

    const entries = buildScope(root, phase, boundaries.base, tasks);
    const runDir = nextRunDir(dir, phase);
    fs.mkdirSync(runDir, { recursive: true });
    const scopeFile = path.join(runDir, SCOPE_FILE);
    fs.writeFileSync(scopeFile, entries.length ? `${entries.join("\n")}\n` : "");
    boundaries[phase] = { at: new Date().toISOString() };
    return { outcome: "run", skills, scopeFile, paths: entries.length };
  });
}

/** The one line `maestro-epic.cjs boundary` prints. */
export function formatBoundary(result: EpicBoundaryResult): string {
  switch (result.outcome) {
    case "none":
      return "Maestro epic: boundary has nothing to run";
    case "not-due":
      return `Maestro epic: boundary not due: ${result.reason}`;
    case "already-ran":
      return `Maestro epic: boundary already ran at ${result.at}`;
    case "run":
      return `Maestro epic: boundary due: run ${result.skills.join(", ")} with scope file ${result.scopeFile} (${result.paths} paths)`;
  }
}
