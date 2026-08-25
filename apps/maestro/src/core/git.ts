// Initialising a repository for a brand-new marketplace, from the app rather than from a prompt.
//
// This used to be a sentence in a prompt string — the scaffold wrote the manifest and the README
// and then told a model to "set up git", so whether the directory ended up a repository depended on
// whether a run happened and did as it was told. Making a repository is exactly as deterministic as
// making a directory, so it belongs with the rest of the scaffolding; moving it here is what takes
// the last shell command out of the create-* system.
//
// It is `execFile`, never a shell: the argument vector is built here, nothing is interpolated into
// a command line, and a marketplace name or an owner's surname with a quote in it cannot become
// syntax. The user is never asked to run anything either — the confirmation for THIS work is the
// Create button.
//
// What it deliberately does NOT do: remotes, private-repo credentials, auto-update. Those need
// decisions and secrets the app does not have, and they stay conversational.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { resolveOnPath, type ResolveOptions } from "./claude-cli.js";
import type { GitPort } from "./contracts.js";

/** Windows resolves a shim; everywhere else the binary is just `git`. */
function gitNames(platform: NodeJS.Platform): string[] {
  return platform === "win32" ? ["git.exe", "git.cmd", "git"] : ["git"];
}

/** The `git` this machine has, resolved with `fs` against the same expanded list `claude` uses. */
export function nodeGit(opts: ResolveOptions = {}): GitPort {
  const platform = opts.platform ?? process.platform;
  const found = resolveOnPath(gitNames(platform), opts);

  /**
   * One git invocation. `label` rather than the argv in the error, because the argv can carry a
   * `-c user.email=…` and an error message is not the place to reprint someone's address.
   */
  const run = (label: string, args: string[], cwd: string): string => {
    try {
      // The same environment resolution was decided against, so a test that points HOME at an
      // empty directory gets a git that genuinely has no global config — and the identity fallback
      // below is exercised rather than shadowed by the developer's own `~/.gitconfig`.
      return execFileSync(found.bin!, args, {
        cwd,
        env: opts.env ?? process.env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      const detail = (e.stderr ?? "").trim() || e.message || "unknown error";
      throw new Error(`\`git ${label}\` failed: ${detail}`);
    }
  };

  /** True when git already knows who the user is — global, system or repo-local, it does not matter. */
  const configured = (key: string, cwd: string): boolean => {
    try {
      return run(`config ${key}`, ["config", "--get", key], cwd).trim() !== "";
    } catch {
      return false; // `--get` on an unset key exits 1; unset is the answer, not an error
    }
  };

  return {
    availability: () =>
      found.available
        ? { available: true, reason: "" }
        : {
            available: false,
            reason:
              "`git` was not found. Looked for it in " +
              `${found.searched.length} directories, including ${found.searched.slice(0, 3).join(", ")}.`,
          },

    init(dir) {
      // `-b` arrived in git 2.28. Naming the branch is worth a retry rather than a version probe:
      // the fallback costs one failed exec on an old git and still leaves a repository behind.
      try {
        run("init", ["init", "-q", "-b", "main"], dir);
      } catch {
        run("init", ["init", "-q"], dir);
      }
      return path.join(dir, ".git");
    },

    commit(dir, message, author) {
      run("add", ["add", "-A"], dir);
      // The marketplace's own owner stands in when the machine has no git identity — otherwise the
      // commit fails with "please tell me who you are" on a fresh machine and the repository this
      // just made gets rolled back for want of a name the form already collected. A user who HAS
      // configured one keeps it: their identity is not ours to override.
      const identity: string[] = [];
      if (!configured("user.name", dir)) identity.push("-c", `user.name=${author.name}`);
      if (!configured("user.email", dir)) identity.push("-c", `user.email=${author.email}`);
      run("commit", [...identity, "commit", "-q", "-m", message], dir);
    },
  };
}
