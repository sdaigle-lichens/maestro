// Keeps a worktree run out of the main checkout (`082`).
//
// A session that runs a task in its own git worktree (`074`, worktree.ts) is told, in prose, to work
// only inside that worktree. Prose is not enforcement: during task 080 byte-identical copies of two
// new source files appeared, untracked, in the main checkout and blocked the merge. Nothing in
// Maestro's hooks or scripts writes application source — they only ever write under `.claude/` —
// so the writer was an agent resolving a path against the main checkout (the same injected context
// that tells it where the shared queue lives hands it main-checkout absolute paths).
//
// This guard turns the prose into a refusal. For a session whose state records a worktree, a file
// write whose REAL path lands in the main checkout is denied unless it is inside the worktree or
// inside one of the shared-state directories the worktree design keeps in the main checkout (the
// task queue, the handoff channels, the session state). Everything else under the main checkout —
// application source, docs, `.claude/scripts`, `.claude/skills`, `.claude/rules` — is refused with a
// message naming the worktree path to use instead.
//
// `fs`/`path` only: the plugin's write-guard hook reaches it through the `maestro-session` bundle.
// A Bash command that redirects into the main checkout is out of reach of a path check on tool
// input; this covers the file-writing tools, which is what an agent writes source with.

import fs from "node:fs";
import path from "node:path";
import type { ChannelWriteVerdict } from "./channel-write-guard.js";

/** The `.claude/` subdirectories that stay in the main checkout while a task runs in a worktree. */
export const MAIN_CHECKOUT_SHARED_DIRS: readonly string[] = ["maestro-tasks", "channels", "maestro_sessions"];

const WRITE_TOOL_PATH_KEYS: Record<string, string> = {
  Write: "file_path",
  Edit: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
};

/** realpath of the deepest existing ancestor plus the not-yet-existing tail; null if unresolvable. */
function realResolve(p: string): string | null {
  let cur = path.resolve(p);
  const tail: string[] = [];
  for (;;) {
    let exists = true;
    try {
      fs.lstatSync(cur);
    } catch {
      exists = false;
    }
    if (exists) {
      try {
        return path.join(fs.realpathSync(cur), ...tail);
      } catch {
        return null;
      }
    }
    const parent = path.dirname(cur);
    if (parent === cur) return path.join(cur, ...tail);
    tail.unshift(path.basename(cur));
    cur = parent;
  }
}

const within = (target: string, root: string): boolean => target === root || target.startsWith(root + path.sep);

/**
 * Decide a file-writing tool call for a session that has a worktree. `worktree` is the
 * `{ path, main_root }` a session's `session.json` records; with none (or a non-writing tool) the
 * call is always allowed. Fails open on anything unresolvable except a target that provably lands
 * in the main checkout.
 */
export function checkWorktreeWrite(input: {
  cwd: string;
  toolName: string | null | undefined;
  toolInput: Record<string, unknown> | null | undefined;
  worktree: { path?: unknown; main_root?: unknown } | null | undefined;
}): ChannelWriteVerdict {
  const { cwd, toolName, toolInput, worktree } = input;
  const key = toolName ? WRITE_TOOL_PATH_KEYS[toolName] : undefined;
  if (!key || !worktree) return { allow: true };
  if (typeof worktree.path !== "string" || typeof worktree.main_root !== "string") return { allow: true };
  if (!worktree.path || !worktree.main_root) return { allow: true };

  const raw = toolInput?.[key];
  if (typeof raw !== "string" || raw === "") return { allow: true };

  const wt = realResolve(worktree.path);
  const main = realResolve(worktree.main_root);
  const target = realResolve(path.resolve(cwd || worktree.path, raw));
  if (!wt || !main || !target) return { allow: true };

  if (within(target, wt)) return { allow: true };
  if (!within(target, main)) return { allow: true };
  if (MAIN_CHECKOUT_SHARED_DIRS.some((d) => within(target, path.join(main, ".claude", d)))) return { allow: true };

  return {
    allow: false,
    reason:
      `Blocked: this session runs its task in the git worktree ${worktree.path}, and "${raw}" resolves to ${target}, ` +
      `inside the main checkout (${worktree.main_root}), which another session may be using and which a merge ` +
      `would later refuse to overwrite. Write the file at the same relative path under ${worktree.path} instead. ` +
      `Only ${MAIN_CHECKOUT_SHARED_DIRS.map((d) => `.claude/${d}/`).join(", ")} stay in the main checkout.`,
  };
}
