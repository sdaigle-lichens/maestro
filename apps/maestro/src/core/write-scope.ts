// What a run may WRITE, decided per tool call — the other half of `read-scope.ts`.
//
// Until this module existed the answer was a flag: `--permission-mode acceptEdits`, which a headless
// run needed because there was nobody to ask, and which granted write authority over *anything
// anywhere* under the working directory. For a create-* flow targeting a marketplace, that working
// directory is an entire repository the user did not think they were opening up.
//
// The Agent SDK's `canUseTool` replaces it with a decision this app makes for itself, and the whole
// decision is here so it can be read in one screen and tested without spawning anything:
//
//   • **The allowed set comes from the preview.** It is the paths `resolveCreateTarget` returned and
//     the confirmation dialog displayed, carried on the invocation the token names. The callback is
//     therefore incapable of being wider than what the user was shown — the same argument the token
//     itself makes about prompts, applied to paths.
//   • **A deny carries a reason.** The model reads denial messages and adapts; a bare "denied" wastes
//     the one channel there is for steering it back to the file it was started for.
//   • **The fall-through is a deny.** A tool this module has never heard of is refused rather than
//     allowed, so adding a tool to the session's tool set without thinking about its filesystem
//     reach fails loudly on the first call instead of quietly granting it.
//
// PURE — path arithmetic over strings. No `fs`, no spawn, no SDK. That is what lets it be unit
// tested exhaustively while the query it advises is verified in a real window.

import path from "node:path";
import { withinDirectory } from "./read-scope.js";
import type { PermissionAnswer } from "./contracts.js";

/**
 * Tools whose whole purpose is to modify the filesystem. Every one of them is checked against the
 * allowed paths; none of them is allowed unconditionally.
 *
 * Wider than the tool set a session is actually offered (`NotebookEdit` and `MultiEdit` are not),
 * and deliberately so: this list is what the check RECOGNISES, and a tool that arrives here because
 * someone widened the session's tools gets checked rather than falling through.
 */
export const WRITE_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"] as const;

/**
 * Tools that cannot write to the filesystem at all, and are therefore allowed without a path check.
 *
 * **This module bounds WRITES. It does not bound reads, and it is not the place to make it.** A
 * `Read` of anything at all is allowed here without the path being looked at — because reads are
 * auto-approved by the permission system and never raise a prompt at all, which is the whole reason
 * `read-scope.ts` exists to disclose the directory list up front. Bounding what a session may read
 * is a `PreToolUse` hook returning `permissionDecision: "ask"` (see SESSION-PANE-PLAN.md), which
 * routes an out-of-scope read into a prompt rather than silently allowing or silently failing it.
 * Adding a path check to the branch below would look like the fix and would not be one: it cannot
 * see the read the model has already been told it may make.
 *
 * `WebFetch`/`WebSearch` are here on the reasoning recorded in SESSION-PANE-PLAN.md: neither touches
 * the filesystem, authoring a skill usually means authoring about something external, and the
 * control on them is that the confirmation shows what a run can read rather than a blanket ban.
 */
export const READ_ONLY_TOOLS = ["Read", "Glob", "Grep", "TodoWrite", "WebSearch", "WebFetch"] as const;

/** The keys a tool input uses for the file it is about, in the order they are looked for. */
const PATH_KEYS = ["file_path", "notebook_path", "path", "filePath"] as const;

/**
 * The SDK's `PermissionResult`, narrowed to the two shapes this app ever returns.
 *
 * ONE UNION, TWO PRODUCERS. `PermissionAnswer` in `contracts.ts` is the same type under the name
 * the renderer knows it by — a person answering a prompt produces exactly what this function does,
 * which is what makes "one engine, two callers" a fact about the types rather than a claim. It
 * gained an optional `interrupt` on the deny arm when the pane's prompts arrived (Deny and Stop are
 * two controls); `decideWrite` has no reason to set it and never does. The fall-through is still a
 * deny, so `undefined` remains unrepresentable.
 */
export type WriteDecision = PermissionAnswer;

/** Pull the path a write tool is aimed at out of its input, or null when it names none. */
export function targetPathOf(input: Record<string, unknown>): string | null {
  for (const key of PATH_KEYS) {
    const value = input?.[key];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

/** How the allowed set reads in a denial message — absolute paths, because the model works in them. */
function listAllowed(writable: readonly string[]): string {
  if (writable.length === 0) return "nothing";
  if (writable.length === 1) return writable[0];
  return `${writable.slice(0, -1).join(", ")} and ${writable[writable.length - 1]}`;
}

export interface WriteScopeInput {
  /** The tool the model asked to use. */
  tool: string;
  /** Its input, as the SDK delivered it. Treated as untrusted shape, not as a typed payload. */
  input: Record<string, unknown>;
  /** Absolute paths the run may write. A directory means "anything under it". */
  writable: readonly string[];
  /** The run's working directory, so a relative `file_path` resolves the way the CLI would. */
  cwd: string;
}

/**
 * Allow or deny one tool call.
 *
 * Never returns `undefined` and never returns `null`: the SDK reads `null` as "the host answered
 * out of band", and a fall-through that produced one would block the tool call forever with nothing
 * on screen. The union above is the whole codomain, and the `default` below is a deny.
 */
export function decideWrite({ tool, input, writable, cwd }: WriteScopeInput): WriteDecision {
  if ((READ_ONLY_TOOLS as readonly string[]).includes(tool)) return { behavior: "allow" };

  if (!(WRITE_TOOLS as readonly string[]).includes(tool)) {
    // Not a tool this session offers. Reaching here means the model asked for something that was
    // supposed to be absent from its context, so the answer is a refusal that says exactly that
    // rather than a path check on a tool whose filesystem reach nobody has worked out.
    return {
      behavior: "deny",
      message:
        `This session does not offer the ${tool} tool. ` +
        `Use Read, Glob and Grep to look around, and Edit or Write to finish the file you were asked to write.`,
    };
  }

  if (writable.length === 0) {
    return {
      behavior: "deny",
      message:
        "This run carries no write authority — it was started to answer, not to author. " +
        "Say what should be written and where, and the user will do it from a surface that asks about writes.",
    };
  }

  const target = targetPathOf(input);
  if (!target) {
    return {
      behavior: "deny",
      message:
        `${tool} was called without a file path, so it cannot be checked against what this run may write ` +
        `(${listAllowed(writable)}).`,
    };
  }

  const resolved = path.resolve(cwd, target);
  // `withinDirectory` answers "same path, or inside it", which is both cases at once: a target that
  // is a FILE matches only itself, and a target that is a DIRECTORY matches anything under it. That
  // is exactly the distinction `ClaudeWriteTarget.path` already documents.
  if (writable.some((allowed) => withinDirectory(allowed, resolved))) return { behavior: "allow" };

  return {
    behavior: "deny",
    message:
      `${resolved} is outside what this run may write. It may write ${listAllowed(writable)} and nothing else. ` +
      `Finish the file you were asked to write; if something else needs changing, say so in your reply instead.`,
  };
}
