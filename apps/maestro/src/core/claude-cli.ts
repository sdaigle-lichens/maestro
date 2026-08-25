// Finding the `claude` CLI without trusting the environment we were launched from.
//
// A GUI app does not inherit a login shell's PATH. On Linux a desktop launcher execs the binary
// from a session that sourced none of the user's shell rc files; on macOS `launchd` hands the app
// the bare `/usr/bin:/bin:/usr/sbin:/sbin` path. `process.env.PATH` inside Electron is therefore
// NOT what the user sees in their terminal, and the official installer puts `claude` in
// `~/.local/bin` — a directory that is on every shell's PATH and on almost no GUI app's. The
// result is a CLI that "is not installed" on a machine where `which claude` answers instantly, and
// the failure only reproduces when the app is launched from the desktop rather than a terminal.
//
// So resolution is explicit: PATH is one source among several, not the source. The list of
// directories searched is returned with the answer, because "we looked in these 14 places" is a
// message a user can act on and "spawn ENOENT" is not.
//
// NOTHING HERE SPAWNS. Availability is decided by `fs` — the file exists and is executable. That
// is what lets `claude-preview.ts` report availability while remaining incapable of starting a
// process; see the module comment there.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Where the CLI was found, and everywhere that was looked at to decide it. */
export interface ClaudeCli {
  available: boolean;
  /** Absolute path of the executable, or null. */
  bin: string | null;
  /** Directories searched, in order, deduplicated — the "we looked here" of a not-found message. */
  searched: string[];
}

/** Injection points, so tests can resolve against a fixture instead of the developer's machine. */
export interface ResolveOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
}

/**
 * Directories a `claude` install lands in, beyond whatever PATH happens to say.
 *
 * Ordered by how authoritative they are: the official installer's target first, then the local
 * install layout it superseded, then the package managers people install it with, then the system
 * directories. First match wins, so a user who has both a native install and a stale global npm
 * copy gets the one the installer maintains.
 */
function fallbackDirs(home: string, platform: NodeJS.Platform): string[] {
  if (platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    return [path.join(local, "Programs", "claude"), path.join(appData, "npm"), path.join(home, ".bun", "bin")];
  }
  return [
    path.join(home, ".local", "bin"), // the current installer
    path.join(home, ".claude", "local"), // the previous "local install" layout
    path.join(home, "bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin", // Apple silicon Homebrew, absent from the default GUI PATH
    path.join(home, ".local", "share", "pnpm"),
    path.join(home, ".bun", "bin"),
    path.join(home, ".volta", "bin"),
    path.join(home, ".yarn", "bin"),
    path.join(home, ".npm-global", "bin"),
    "/usr/bin",
    "/bin",
    "/snap/bin",
  ];
}

/**
 * `~/.nvm/versions/node/*​/bin`, newest first.
 *
 * A version-manager-installed global is invisible to a GUI app for the same reason as the rest of
 * this file, and unlike the others its directory name is not knowable in advance — so it is read.
 * Bounded to the versions actually installed, and a missing nvm costs one failed `readdir`.
 */
function nvmBinDirs(home: string): string[] {
  const root = path.join(home, ".nvm", "versions", "node");
  try {
    return fs
      .readdirSync(root)
      .sort()
      .reverse()
      .map((v) => path.join(root, v, "bin"));
  } catch {
    return [];
  }
}

/** Executable file names to look for. Windows resolves a shim, not the script. */
function binaryNames(platform: NodeJS.Platform): string[] {
  return platform === "win32" ? ["claude.cmd", "claude.exe", "claude.bat", "claude"] : ["claude"];
}

function isExecutable(file: string, platform: NodeJS.Platform): boolean {
  try {
    if (!fs.statSync(file).isFile()) return false;
    // The permission bit matters: `~/.local/bin/claude` non-executable is a broken install, and
    // reporting it as available would turn into an EACCES at spawn time — the exact class of
    // "fails at spawn instead of in preview" this module exists to prevent.
    if (platform !== "win32") fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Every directory that will be searched, in order, deduplicated. Also the child's PATH. */
export function claudeSearchDirs(opts: ResolveOptions = {}): string[] {
  const env = opts.env ?? process.env;
  const home = opts.home ?? os.homedir();
  const platform = opts.platform ?? process.platform;
  const sep = platform === "win32" ? ";" : ":";

  const fromPath = (env.PATH ?? env.Path ?? "").split(sep).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of [...fromPath, ...fallbackDirs(home, platform), ...nvmBinDirs(home)]) {
    const norm = path.normalize(dir);
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

/**
 * The first of `names` that exists and is executable in the search list above, or where it isn't.
 *
 * Generic because `claude` is not the only binary this app has to find on a machine whose PATH it
 * cannot trust: `git.ts` resolves `git` the same way, for the same reason. Keeping one search list
 * means a directory added for one of them is searched for both, and only one place knows how a GUI
 * launch differs from a terminal.
 *
 * Never throws and never spawns: an unreadable directory is simply a directory without a match.
 */
export function resolveOnPath(names: string[], opts: ResolveOptions = {}): ClaudeCli {
  const platform = opts.platform ?? process.platform;
  const searched = claudeSearchDirs(opts);

  for (const dir of searched) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isExecutable(candidate, platform)) return { available: true, bin: candidate, searched };
    }
  }
  return { available: false, bin: null, searched };
}

/**
 * Where `claude` is, or the list of places it isn't.
 *
 * Never throws and never spawns: an unreadable directory is simply a directory without a match.
 */
export function resolveClaudeCli(opts: ResolveOptions = {}): ClaudeCli {
  return resolveOnPath(binaryNames(opts.platform ?? process.platform), opts);
}

/**
 * The PATH to hand the child process.
 *
 * The CLI shells out itself — to `git`, to `node`, to whatever a hook in the project runs — and it
 * inherits our environment. Passing the app's own truncated PATH through would leave the run
 * failing on tools the user plainly has, one layer further down and much harder to read. So the
 * child gets the same expanded list this module searched.
 */
export function claudeChildPath(opts: ResolveOptions = {}): string {
  const platform = opts.platform ?? process.platform;
  return claudeSearchDirs(opts).join(platform === "win32" ? ";" : ":");
}

/** The message a UI shows when the CLI isn't there — it names what was looked for, and where. */
export function cliNotFoundMessage(cli: ClaudeCli): string {
  return (
    "The `claude` CLI was not found. Looked for an executable named `claude` in " +
    `${cli.searched.length} directories, including ${cli.searched.slice(0, 3).join(", ")}. ` +
    "Install it from claude.com/download, or copy the prompt and run it in a session yourself."
  );
}
