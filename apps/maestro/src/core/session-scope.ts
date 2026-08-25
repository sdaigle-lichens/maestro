// What a live session may LOOK AT — the third permission surface, and the one the other two cannot
// reach.
//
// `write-scope.ts` bounds writes and says so in its own header: it returns `allow` for `Read`,
// `Glob` and `Grep` without ever inspecting the path, because reads are auto-approved by the
// permission system and never reach `canUseTool` at all. That is why `read-scope.ts` exists to
// DISCLOSE the directory list before a run starts — disclosure was the only control available.
//
// A pane session gets a second control, and it is not an extension of `decideWrite`. The SDK's
// `PreToolUse` hook fires for EVERY tool call, before the permission flow, and its
// `permissionDecision` can refuse one. So the bound on reads lives here, is applied by the hook
// `agent-sdk.ts` installs, and is deliberately a different module from the write decision:
// reaching for `decideWrite` first is the obvious wrong turn, because it looks like it already
// handles every tool.
//
// TWO DECISIONS, NOT THREE. `allow` and `out-of-scope`. This slice renders `out-of-scope` as a
// hook DENY with the reason on screen and in the model's context; `020` renders the same decision
// as `permissionDecision: "ask"`, which routes it into the prompt UI instead. Keeping the
// out-of-scope verdict distinct from the word "deny" is what makes that a one-line change in the
// hook rather than a rewrite of this file.
//
// PURE — path arithmetic over strings. No `fs`, no spawn, no SDK, exactly like its two siblings.

import path from "node:path";
import { withinDirectory } from "./read-scope.js";
import type { SessionGrantOption } from "./contracts.js";

/**
 * Tools whose reach is a filesystem path this module can check by inspecting `tool_input`.
 *
 * Wider than any one session's tool set on purpose — the same argument `WRITE_TOOLS` makes. A tool
 * that arrives here because somebody widened the offered set gets CHECKED rather than falling
 * through to an allow.
 *
 * `Bash` is not here and could not be: what `cd .. && cat` reaches is not visible in its input,
 * which is precisely why it is in `SESSION_DISALLOWED_TOOLS` and why this check is meaningful.
 */
export const BOUNDED_TOOLS = ["Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "Glob", "Grep"] as const;

/** Tools that touch no path at all, so there is nothing here to decide about them. */
export const UNBOUNDED_TOOLS = ["TodoWrite", "WebSearch", "WebFetch", "Skill", "AskUserQuestion"] as const;

/** The keys a tool input uses for the file it is about, in the order they are looked for. */
const FILE_KEYS = ["file_path", "notebook_path", "filePath"] as const;

/**
 * What one tool call is aimed at.
 *
 * `base` is the directory or file the call names. `pattern` is the extra half `Glob` and `Grep`
 * carry: a search rooted at an in-scope directory can still be told to match `../../../**`, and a
 * check that only looked at `path` would wave it through.
 */
export interface BoundaryTarget {
  base: string | null;
  pattern: string | null;
}

/** Pull the path(s) a bounded tool is aimed at out of its input. */
export function boundaryTargetOf(tool: string, input: Record<string, unknown>): BoundaryTarget {
  const str = (key: string): string | null => {
    const value = input?.[key];
    return typeof value === "string" && value.trim() !== "" ? value : null;
  };

  if (tool === "Glob" || tool === "Grep") {
    const pattern = str("pattern") ?? str("glob");
    return {
      base: str("path"),
      // Only the escaping half is interesting. A pattern that is relative and does not climb can
      // only match inside `base`, which is checked on its own line below.
      pattern: pattern && (path.isAbsolute(pattern) || pattern.split(/[\\/]/).includes("..")) ? pattern : null,
    };
  }

  for (const key of FILE_KEYS) {
    const value = str(key);
    if (value) return { base: value, pattern: null };
  }
  // `path` last: several tools use it as a secondary key, and a tool that named a file above has
  // already answered.
  return { base: str("path"), pattern: null };
}

/**
 * The verdict on one tool call.
 *
 * `out-of-scope` is not spelled "deny" on purpose — see the header. The hook decides what an
 * out-of-scope call BECOMES; this module decides only whether the session was told it could look
 * there.
 */
export type BoundaryDecision = { decision: "allow" } | { decision: "out-of-scope"; path: string; reason: string };

export interface BoundaryInput {
  tool: string;
  /** The tool input as the SDK delivered it. Untrusted shape, not a typed payload. */
  input: Record<string, unknown>;
  /** Absolute paths the session was started able to read. Everything under one of them is in. */
  directories: readonly string[];
  /** The session's working directory, so a relative path resolves the way the CLI would. */
  cwd: string;
}

/** How the readable set reads in a refusal — absolute paths, because the model works in them. */
function listReadable(directories: readonly string[]): string {
  if (directories.length === 0) return "nothing";
  if (directories.length === 1) return directories[0];
  return `${directories.slice(0, -1).join(", ")} and ${directories[directories.length - 1]}`;
}

/**
 * Decide whether one tool call stays inside what this session may see.
 *
 * The fall-through is an ALLOW, and that is the opposite of `decideWrite`'s — deliberately, because
 * the two answer different questions. `decideWrite` is the whole permission decision for a tool
 * call and must refuse anything it does not understand. This is a boundary on paths, running in
 * front of a permission model that still applies afterwards: a tool with no path in it has not
 * left the boundary, and refusing it here would be this module quietly becoming a second tool
 * allowlist, drifting from the one in `agent-sdk.ts`.
 */
export function decideBoundary({ tool, input, directories, cwd }: BoundaryInput): BoundaryDecision {
  if (!(BOUNDED_TOOLS as readonly string[]).includes(tool)) return { decision: "allow" };

  const { base, pattern } = boundaryTargetOf(tool, input);
  const inScope = (target: string): boolean =>
    directories.some((dir) => withinDirectory(dir, path.resolve(cwd, target)));

  // No path at all: `Glob`/`Grep` default to the working directory, which is in scope by
  // construction. A file tool that named nothing cannot be checked, and a call that cannot be
  // checked is not one to wave through.
  if (!base) {
    if (tool === "Glob" || tool === "Grep") {
      return !pattern || inScope(pattern) ? { decision: "allow" } : verdict(pattern);
    }
    return {
      decision: "out-of-scope",
      path: "",
      reason:
        `${tool} was called without a path, so it cannot be checked against what this session may read ` +
        `(${listReadable(directories)}).`,
    };
  }

  if (!inScope(base)) return verdict(base);
  // A search rooted inside the scope can still be pointed out of it by its pattern.
  if (pattern && !inScope(path.isAbsolute(pattern) ? pattern : path.join(base, pattern))) {
    return verdict(path.isAbsolute(pattern) ? pattern : path.join(base, pattern));
  }
  return { decision: "allow" };

  function verdict(target: string): BoundaryDecision {
    const resolved = path.resolve(cwd, target);
    return {
      decision: "out-of-scope",
      path: resolved,
      reason:
        `${resolved} is outside what this session may read. It can read ${listReadable(directories)} and nothing else. ` +
        `Work with what is in scope, or ask the user to open the directory you need.`,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE OTHER HALF OF THE BOUNDARY — "unless authorised".
//
// A refusal that cannot be overridden is not a boundary, it is a wall, and the case it gets wrong
// is the ordinary one: a user authoring a skill says "make it like my existing one", and their own
// global skills live outside the project and outside every marketplace. Denying that outright is
// wrong; granting it silently is worse. So the boundary above gains a way to be widened BY A
// PERSON, with three properties inherited from the decision this app already made once, for the
// chat's confirmation opt-out: it defaults to asking, it dies with the session, and it is visible
// and revocable from the header.
//
// This half is still pure. It decides WHAT COULD BE GRANTED — never whether anything is, which is
// the user's answer, and never whether the path exists, which needs `fs` and belongs to the caller.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How shallow a directory has to be before granting it is worth a second look.
 *
 * Two segments covers `/`, `/home`, `/home/alice`, `/Users/alice` and `C:\Users` — the filesystem
 * root, the container of every user, and a whole home directory. Lexical on purpose: no `os`, no
 * `fs`, nothing that makes this function answer differently on the machine it happens to run on.
 */
const BROAD_DEPTH = 2;

/** Path segments, ignoring the leading separator and any trailing one. */
function depthOf(dir: string): number {
  return path
    .resolve(dir)
    .split(/[\\/]/)
    .filter((s) => s !== "" && s !== ".").length;
}

/**
 * What a person could grant in answer to one out-of-scope read.
 *
 * `isDirectory` is the caller's answer, because it is the one thing here that needs the disk. It
 * decides the shape of the offer rather than merely its wording:
 *
 *   • **A file** gets two options — the file itself, and the directory containing it. That is the
 *     difference the prompt has to make obvious: one of them is `~/.claude/skills/foo/SKILL.md` and
 *     the other is every skill the user has ever written.
 *   • **A directory** gets one. "Just this file" is not a thing to offer about a directory, and
 *     climbing to its parent instead would answer a question nobody asked.
 *
 * Returns EMPTY when there is nothing to grant: no path (the uncheckable call the hook still
 * denies), or a path already inside the scope, which would be a button that changes nothing.
 */
export function grantOptionsFor(
  target: string,
  isDirectory: boolean,
  directories: readonly string[]
): SessionGrantOption[] {
  const resolved = String(target ?? "").trim();
  if (resolved === "" || !path.isAbsolute(resolved)) return [];
  if (directories.some((dir) => withinDirectory(dir, resolved))) return [];

  const options: SessionGrantOption[] = [];

  if (isDirectory) {
    options.push(directoryOption(resolved, directories));
  } else {
    options.push({
      scope: "file",
      path: resolved,
      label: "Allow this file",
      note: `Only ${path.basename(resolved)}, and only until this session ends. Nothing else in ${path.dirname(resolved)} becomes readable.`,
      broad: false,
    });
    const parent = path.dirname(resolved);
    // At the filesystem root the two options would name the same tree, and a second button that
    // does the same thing as the first is how a prompt stops being read.
    if (parent !== resolved && !directories.some((dir) => withinDirectory(dir, parent))) {
      options.push(directoryOption(parent, directories));
    }
  }

  return options;
}

/** The directory arm of the offer, with the sentence that says how much of the disk it is. */
function directoryOption(dir: string, directories: readonly string[]): SessionGrantOption {
  const shallow = depthOf(dir) <= BROAD_DEPTH;
  // A directory that CONTAINS something already in scope is not "one more directory": granting it
  // swallows the project (or a marketplace) and everything beside it on the way.
  const swallows = directories.filter((existing) => existing !== "" && withinDirectory(dir, existing));
  const broad = shallow || swallows.length > 0;

  return {
    scope: "directory",
    path: dir,
    label: "Allow this folder",
    note: broad
      ? `EVERYTHING under ${dir} becomes readable for the rest of this session` +
        (swallows.length > 0 ? `, including ${swallows.join(", ")} and whatever else sits beside it.` : ".") +
        " That is a lot more than the file that was asked about."
      : `Everything under ${dir} becomes readable, until this session ends.`,
    broad,
  };
}

/** Pick the option a `{ choice: "grant", scope }` answer names. Null when the prompt offered none. */
export function grantOptionFor(
  options: readonly SessionGrantOption[],
  scope: string | null | undefined
): SessionGrantOption | null {
  return options.find((option) => option.scope === scope) ?? null;
}
