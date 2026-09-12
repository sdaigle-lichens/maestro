// Which Claude Code session am I, and where does that session's ephemeral state live (`064`).
//
// Every piece of Maestro's ephemeral state used to be ONE fixed file per project
// (`maestro_session.log.jsonl`, `maestro_session.json`, `maestro_session_tasks.json`), so two
// Claude Code sessions running against the same project corrupted each other silently: interleaved
// logs, one session's `SessionEnd` deleting the other's, an active workflow overwritten so the next
// `SubagentStart` injected the WRONG workflow's skills, one `run_id` shared by two runs, and
// `resumeTarget` able to resume a foreign session's `agent_id`. Each session now gets its own
// directory holding all three:
//
//   <project>/.claude/maestro_sessions/
//     .gitignore            ← "*", written when the directory is first created
//     <session_id>/
//       log.jsonl           ← was maestro_session.log.jsonl
//       session.json        ← was maestro_session.json   { workflow, generated_instances, run_id }
//       tasks.json          ← was maestro_session_tasks.json
//
// A directory per session rather than `<session_id>.jsonl`: all three files move together, and the
// log alone would have left the other two defects standing.
//
// ── Resolving "which session am I" is one concern with two sources ──────────────────────────────
//
// 1. `payload.session_id`, when the caller is a hook with a stdin payload. **A subagent's hook
//    payload carries the MAIN session's `session_id`** — verified by probing `PreToolUse` (main),
//    `SubagentStart`, the subagent's own `PreToolUse` and `SubagentStop`: all four identical. One
//    workflow run is therefore one directory, and a subagent's tool calls land in it.
// 2. `CLAUDE_CODE_SESSION_ID`, for the scripts that run with no stdin at all (the two `!`command``
//    gate scripts, and the CLIs the orchestrator invokes by path). Verified set at every one of
//    those four probe points and EQUAL to the payload's `session_id` every time, so the fallback
//    agrees with the authoritative source rather than merely being available.
// 3. Neither → `null`, and every caller degrades safely on its own terms (silent no-op, today's
//    empty answer, or the full-injection safe direction).
//
// Deliberately NOT keyed on `CLAUDE_CODE_CHILD_SESSION`: that is set in the main session too, so it
// separates nothing.
//
// ── An id is VALIDATED, never sanitised ────────────────────────────────────────────────────────
//
// Accept `^[A-Za-z0-9_-]{1,128}$` and treat anything else as "no session". Sanitising a bad id into
// a legal one could collide with a real session's directory, which is worse than not writing — and
// the pattern excludes `.`, `/` and `\` outright, so `..`, a path separator, an absolute path and
// the empty string are all rejected before any path is built.

import fs from "node:fs";
import path from "node:path";

/** The directory under `.claude/` holding one subdirectory per session. */
export const SESSIONS_DIR_NAME = "maestro_sessions";

export const SESSION_LOG_NAME = "log.jsonl";
export const SESSION_STATE_NAME = "session.json";
export const SESSION_TASKS_NAME = "tasks.json";

/** The environment variable the no-stdin callers resolve from. */
export const SESSION_ID_ENV = "CLAUDE_CODE_SESSION_ID";

/**
 * The three flat files this replaced. Still deleted by `SessionEnd` and by uninstall, because a
 * project that ran a pre-`064` runtime has them sitting in `.claude/` with nothing else to remove
 * them.
 */
export const LEGACY_SESSION_FILES = [
  "maestro_session.json",
  "maestro_session.log.jsonl",
  "maestro_session_tasks.json",
] as const;

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** A payload shape carrying a session id — every hook's stdin payload, and nothing else. */
export interface SessionIdSource {
  session_id?: unknown;
}

/** Environment shape, so a caller (and a test) can hand in something other than `process.env`. */
export interface SessionIdEnv {
  CLAUDE_CODE_SESSION_ID?: string | undefined;
}

/** All four files a session directory can hold, plus the directory itself. Pure path shapes. */
export interface SessionPaths {
  id: string;
  /** `<claudeDir>/maestro_sessions/<id>` */
  dir: string;
  /** `<claudeDir>/maestro_sessions/<id>/log.jsonl` */
  log: string;
  /** `<claudeDir>/maestro_sessions/<id>/session.json` */
  state: string;
  /** `<claudeDir>/maestro_sessions/<id>/tasks.json` */
  tasks: string;
}

/** Validated, never sanitised — see the header. */
export function isValidSessionId(id: unknown): id is string {
  return typeof id === "string" && SESSION_ID_RE.test(id);
}

/**
 * The session id for this caller: the payload's `session_id`, else `CLAUDE_CODE_SESSION_ID`, else
 * `null`. An id that fails validation from EITHER source is `null` rather than falling through to
 * the other — a caller handed a malformed payload id should not silently write into whatever the
 * environment happens to say.
 */
export function resolveSessionId(
  payload?: SessionIdSource | null,
  env: SessionIdEnv = process.env as SessionIdEnv
): string | null {
  if (payload && typeof payload === "object" && payload.session_id !== undefined && payload.session_id !== null) {
    return isValidSessionId(payload.session_id) ? payload.session_id : null;
  }
  const fromEnv = env?.[SESSION_ID_ENV];
  return isValidSessionId(fromEnv) ? fromEnv : null;
}

/** `<claudeDir>/maestro_sessions` — the parent of every session directory. */
export function sessionsRoot(claudeDir: string): string {
  return path.join(claudeDir, SESSIONS_DIR_NAME);
}

/** The path shapes for `id`, or `null` when `id` is not a valid session id. Touches no disk. */
export function sessionPathsFor(claudeDir: string, id: unknown): SessionPaths | null {
  if (!claudeDir || !isValidSessionId(id)) return null;
  const dir = path.join(sessionsRoot(claudeDir), id);
  return {
    id,
    dir,
    log: path.join(dir, SESSION_LOG_NAME),
    state: path.join(dir, SESSION_STATE_NAME),
    tasks: path.join(dir, SESSION_TASKS_NAME),
  };
}

/**
 * READ path: resolve the calling session's paths without creating anything on disk. `null` when no
 * id resolves — every reader degrades to its own "nothing to read" answer rather than guessing.
 */
export function resolveSessionPaths(
  claudeDir: string,
  payload?: SessionIdSource | null,
  env?: SessionIdEnv
): SessionPaths | null {
  return sessionPathsFor(claudeDir, resolveSessionId(payload, env));
}

/**
 * The `.gitignore` that makes this work on a project installed BEFORE `064`.
 *
 * `GITIGNORE_ENTRIES` in install.ts is only ever appended at install time, so every existing
 * project would leak `maestro_sessions/` into git until someone re-installed. A `.gitignore`
 * containing `*` written by the code that creates the directory ignores the directory's contents
 * AND itself, needs no re-install, and works everywhere. The manifest entry exists too, for new
 * installs — belt and braces in the other direction.
 */
export function ensureSessionsRoot(claudeDir: string): string {
  const root = sessionsRoot(claudeDir);
  fs.mkdirSync(root, { recursive: true });
  const ignore = path.join(root, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n");
  return root;
}

/**
 * WRITE path: resolve the calling session's paths and create the directory (and the sessions root's
 * `.gitignore`) if absent. `null` when no id resolves — nothing is created on disk in that case,
 * which is what makes "reject a bad id" cost nothing.
 */
export function ensureSessionPaths(
  claudeDir: string,
  payload?: SessionIdSource | null,
  env?: SessionIdEnv
): SessionPaths | null {
  const paths = resolveSessionPaths(claudeDir, payload, env);
  if (!paths) return null;
  ensureSessionsRoot(claudeDir);
  fs.mkdirSync(paths.dir, { recursive: true });
  return paths;
}

/** Every session id with a directory under `maestro_sessions/`, sorted. `[]` when there are none. */
export function listSessionIds(claudeDir: string): string[] {
  let names: fs.Dirent[];
  try {
    names = fs.readdirSync(sessionsRoot(claudeDir), { withFileTypes: true });
  } catch {
    return [];
  }
  return names
    .filter((d) => d.isDirectory() && isValidSessionId(d.name))
    .map((d) => d.name)
    .sort();
}

/**
 * `SessionEnd`'s removal: ONLY the ending session's own directory, plus the three legacy flat files
 * a pre-`064` runtime may have left behind. A sibling session's directory is never touched — that
 * is the whole point of the split. With no id resolving, nothing is removed at all: a `SessionEnd`
 * that cannot say which session it is has no business deleting anyone's state.
 *
 * Returns the paths it actually removed, for the callers that report.
 */
export function removeSessionState(claudeDir: string, sessionId: unknown): string[] {
  const paths = sessionPathsFor(claudeDir, sessionId);
  if (!paths) return [];
  const removed: string[] = [];
  for (const target of [paths.dir, ...LEGACY_SESSION_FILES.map((f) => path.join(claudeDir, f))]) {
    try {
      if (!fs.existsSync(target)) continue;
      fs.rmSync(target, { recursive: true, force: true });
      removed.push(target);
    } catch {
      // A session file we cannot delete is not worth failing the session's exit over.
    }
  }
  return removed;
}
