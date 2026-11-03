// Installed-dependency check for a task worktree — `fs`/`path` only, so it can ship in the
// `maestro-session` bundle.
//
// A fresh `git worktree add` checkout has no `node_modules`, so a test or review step run there can
// only read code. The agent usually cannot install (the Bash sandbox blocks package installs), so the
// design is "detect and stop": name the package manager from the lockfile, and when dependencies are
// missing print the exact command the USER must run. Nothing is installed, linked or left behind.

import fs from "node:fs";
import path from "node:path";

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

const LOCKFILES: ReadonlyArray<{ file: string; manager: PackageManager }> = [
  { file: "pnpm-lock.yaml", manager: "pnpm" },
  { file: "package-lock.json", manager: "npm" },
  { file: "yarn.lock", manager: "yarn" },
  { file: "bun.lock", manager: "bun" },
  { file: "bun.lockb", manager: "bun" },
];

export type PackageManagerDetection =
  | { kind: "detected"; manager: PackageManager; lockfile: string }
  | { kind: "ambiguous"; lockfiles: string[] }
  | { kind: "unknown" };

/** Name the package manager from the lockfile(s) in `dir`. Several managers' lockfiles is ambiguous. */
export function detectPackageManager(dir: string): PackageManagerDetection {
  const found = LOCKFILES.filter((l) => fs.existsSync(path.join(dir, l.file)));
  const managers = new Set(found.map((l) => l.manager));
  if (managers.size === 0) return { kind: "unknown" };
  if (managers.size > 1) return { kind: "ambiguous", lockfiles: found.map((l) => l.file) };
  return { kind: "detected", manager: found[0].manager, lockfile: found[0].file };
}

/** The install command for `manager` targeting `dir`, as the user would type it after `!`. */
export function installCommand(manager: PackageManager, dir: string): string {
  const q = JSON.stringify(dir);
  switch (manager) {
    case "pnpm":
      return `pnpm --dir ${q} install`;
    case "npm":
      return `npm --prefix ${q} install`;
    case "yarn":
      return `yarn --cwd ${q} install`;
    case "bun":
      return `bun install --cwd ${q}`;
  }
}

export type DependencyStatus =
  | { state: "not-applicable" }
  | { state: "installed" }
  | { state: "missing"; detection: PackageManagerDetection; command: string | null };

const INSTALL_MARKERS = [".modules.yaml", ".package-lock.json", ".yarn-integrity"];

/**
 * A `node_modules` counts only when something was installed into it: a package entry, or the
 * install marker a package manager writes. A directory holding only tool state (pnpm creates
 * `.pnpm-task-run-state-v1` even on a failed run) is not an install.
 */
function hasInstalledModules(nodeModules: string): boolean {
  let entries: string[];
  try {
    entries = fs.readdirSync(nodeModules);
  } catch {
    return false;
  }
  return entries.some((e) => !e.startsWith(".") || INSTALL_MARKERS.includes(e));
}

/**
 * Whether `dir` (a worktree root) has its dependencies. No `package.json` means nothing to install.
 * Otherwise a `node_modules` directory is what "installed" means; when it is absent `command` is the
 * install command, or null when the lockfile does not name exactly one manager.
 */
export function dependencyStatus(dir: string): DependencyStatus {
  if (!fs.existsSync(path.join(dir, "package.json"))) return { state: "not-applicable" };
  if (hasInstalledModules(path.join(dir, "node_modules"))) return { state: "installed" };
  const detection = detectPackageManager(dir);
  const command = detection.kind === "detected" ? installCommand(detection.manager, dir) : null;
  return { state: "missing", detection, command };
}

/**
 * The stop message for a worktree with missing dependencies, or null when nothing is missing. It
 * never guesses a command: an unknown or ambiguous lockfile setup gets guidance instead.
 */
export function missingDependenciesNotice(dir: string): string | null {
  const status = dependencyStatus(dir);
  if (status.state !== "missing") return null;
  const head =
    `STOP: the worktree ${dir} has no installed dependencies (no node_modules), so tests, lint and builds cannot run there. ` +
    "Do NOT dispatch @test or @reviewer, and do NOT report the task as tested, until it is installed. ";
  const tail =
    " Installing is the user's step (package installs cannot run in the agent sandbox). Then re-run this same command to confirm.\n";
  const { detection, command } = status;
  if (command && detection.kind === "detected") {
    return `${head}Ask the user to run this (${detection.manager}, from ${detection.lockfile}):\n  ! ${command}\n${tail}`;
  }
  const why =
    detection.kind === "ambiguous"
      ? `More than one package manager's lockfile is present (${detection.lockfiles.join(", ")})`
      : "No recognised lockfile (pnpm-lock.yaml, package-lock.json, yarn.lock, bun.lock, bun.lockb) is present";
  return `${head}${why}, so no install command is guessed. Ask the user which package manager this project uses and to install the dependencies in ${dir} with it.${tail}`;
}
