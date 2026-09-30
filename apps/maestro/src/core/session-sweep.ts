// Sweep of orphaned session directories (`068`).
//
// `<project>/.claude/maestro_sessions/<id>/` is removed by the SessionEnd hook alone
// (`removeSessionState`). A session that ends without SessionEnd — crash, kill, a terminal closed
// hard — leaves its directory forever, and its greyed tab lingers in /session-log. This module
// removes those orphans. Framework-free: no Electron, no React, so it is tested against temp
// projects (test/core/session-sweep.test.ts).
//
// ── How liveness is determined ─────────────────────────────────────────────────────────────────
//
// Claude Code exposes no "is session X still running" query, and a session may belong to ANOTHER
// project's Claude process (or a terminal) that this app cannot see. So the only evidence is on
// disk, and the rule is deliberately one-sided: a directory is deleted ONLY on positive evidence
// that it is abandoned; every other outcome is "live".
//
// A directory is a deletion candidate iff ALL of these hold:
//   1. its name is a valid session id (`isValidSessionId`) and it is a real directory (a symlink
//      is never followed or removed);
//   2. it is not the calling process's own session (`CLAUDE_CODE_SESSION_ID`) — the desktop app can
//      itself be launched from inside a Claude session;
//   3. its LAST ACTIVITY is older than `SESSION_SWEEP_IDLE_CAP_MS`, where last activity is the
//      newest mtime among the directory itself and every file directly in it (`log.jsonl` is
//      appended on every tool call; `session.json` / `tasks.json` are rewritten on workflow
//      steps; the directory mtime moves when a file is created or removed);
//
// Task claims (`066`) need no separate check: a claim is live only while its session's log is
// within 15 minutes, which is strictly inside rule 3's window, so a live claim can never coexist
// with a candidate directory.
//
// "Cannot tell" = live. Any of these keep the directory: a stat/readdir error, an mtime in the future (clock skew), an empty directory whose own mtime is fresh
// (a session that has just started and not logged yet), a directory the sweep cannot read.
//
// The idle cap is 24 hours, far longer than the 15-minute `CLAIM_IDLE_CAP_MS`: a claim expiring
// merely frees a task, but deleting a directory destroys `session.json` (the active workflow) of
// a session that may be parked for hours waiting on a human review. A crash leftover is just as
// removable a day later, so the conservative cap costs almost nothing.
//
// Only the SESSION DIRECTORIES are swept. The legacy pre-`064` flat files are not touched, and
// neither is `.gitignore` or anything else in `maestro_sessions/`.

import fs from "node:fs";
import path from "node:path";

import { CLAIM_IDLE_CAP_MS } from "./handoff-channels.js";
import {
  isValidSessionId,
  listSessionIds,
  sessionPathsFor,
  SESSION_ID_ENV,
  type SessionIdEnv,
} from "./session-paths.js";

/** A session directory untouched for this long is treated as abandoned. See the header. */
export const SESSION_SWEEP_IDLE_CAP_MS = 24 * 60 * 60 * 1000;

export interface SessionSweepOptions {
  /** Injected clock, for tests. */
  now?: number;
  /** Where the caller's own session id comes from. Defaults to `process.env`. */
  env?: SessionIdEnv;
  idleCapMs?: number;
}

export interface SessionSweepResult {
  /** Directories removed, as `{ projectRoot, sessionId }`. */
  removed: Array<{ projectRoot: string; sessionId: string }>;
  /** Count of removed directories — what the UI reports. */
  count: number;
}

/** Newest mtime (ms) of the directory and its direct children, or `null` when it cannot be read. */
function lastActivityMs(dir: string): number | null {
  try {
    let newest = fs.statSync(dir).mtimeMs;
    for (const name of fs.readdirSync(dir)) {
      try {
        newest = Math.max(newest, fs.lstatSync(path.join(dir, name)).mtimeMs);
      } catch {
        return null; // a child we cannot stat: cannot tell
      }
    }
    return newest;
  } catch {
    return null;
  }
}

/** True iff the directory may be deleted. Anything doubtful returns false. */
function isAbandoned(dir: string, now: number, idleCapMs: number): boolean {
  let st: fs.Stats;
  try {
    st = fs.lstatSync(dir);
  } catch {
    return false;
  }
  if (!st.isDirectory() || st.isSymbolicLink()) return false;
  const last = lastActivityMs(dir);
  if (last === null) return false;
  const idle = now - last;
  return idle > idleCapMs; // negative (future mtime) is never > cap
}

/**
 * Remove abandoned session directories from every project in `projectRoots`. Never throws: a
 * failure on one directory or project leaves it in place and moves on.
 */
export function sweepStaleSessions(projectRoots: string[], options: SessionSweepOptions = {}): SessionSweepResult {
  const now = options.now ?? Date.now();
  const idleCapMs = options.idleCapMs ?? SESSION_SWEEP_IDLE_CAP_MS;
  const env = options.env ?? (process.env as SessionIdEnv);
  const ownId = env?.[SESSION_ID_ENV];
  const removed: SessionSweepResult["removed"] = [];

  for (const projectRoot of [...new Set(projectRoots)]) {
    const claudeDir = path.join(projectRoot, ".claude");
    for (const sessionId of listSessionIds(claudeDir)) {
      if (!isValidSessionId(sessionId) || sessionId === ownId) continue;
      const paths = sessionPathsFor(claudeDir, sessionId);
      if (!paths || !isAbandoned(paths.dir, now, idleCapMs)) continue;
      try {
        fs.rmSync(paths.dir, { recursive: true, force: true });
        removed.push({ projectRoot, sessionId });
      } catch {
        // Cannot delete: it stays, and the next sweep tries again.
      }
    }
  }
  return { removed, count: removed.length };
}

// ── Explicit, per-session deletion (the x on a Session Log tab) ────────────────────────────────
//
// An explicit user action, so the 24h sweep cap does not apply — but it must still refuse a session
// that is genuinely running. "Running" uses the same activity measure as the sweep with the
// task-claim cap (15 minutes, CLAIM_IDLE_CAP_MS): the threshold that already decides whether a
// session's task claim is live. Same safety: valid id, real directory, never a symlink, never the
// caller's own session, and "cannot tell" is running.
//
// The renderer marks a tab "ended" only when the directory has vanished (clean SessionEnd), so a
// crashed session's tab stays "live" forever. `listDeletableSessions` is the backend's answer to
// "which tabs are not actually running", so the x is offered exactly where `deleteSession` accepts.

/** Idle time after which a session is considered not running for an explicit delete. */
export const SESSION_DELETE_IDLE_CAP_MS = CLAIM_IDLE_CAP_MS;

export type DeleteSessionResult =
  { removed: true } | { removed: false; reason: "invalid" | "not-found" | "running" | "own-session" | "failed" };

export interface SessionRef {
  projectRoot: string;
  sessionId: string;
}

export function deleteSession(
  allowedRoots: string[],
  projectRoot: string,
  sessionId: string,
  options: SessionSweepOptions = {}
): DeleteSessionResult {
  const now = options.now ?? Date.now();
  const idleCapMs = options.idleCapMs ?? SESSION_DELETE_IDLE_CAP_MS;
  const ownId = (options.env ?? (process.env as SessionIdEnv))?.[SESSION_ID_ENV];
  if (!allowedRoots.includes(projectRoot) || !isValidSessionId(sessionId)) {
    return { removed: false, reason: "invalid" };
  }
  if (sessionId === ownId) return { removed: false, reason: "own-session" };
  const paths = sessionPathsFor(path.join(projectRoot, ".claude"), sessionId);
  if (!paths) return { removed: false, reason: "invalid" };
  try {
    fs.lstatSync(paths.dir);
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT"
      ? { removed: false, reason: "not-found" }
      : { removed: false, reason: "running" };
  }
  if (!isAbandoned(paths.dir, now, idleCapMs)) return { removed: false, reason: "running" };
  try {
    fs.rmSync(paths.dir, { recursive: true, force: true });
    return { removed: true };
  } catch {
    return { removed: false, reason: "failed" };
  }
}

/** Sessions on disk that `deleteSession` would currently accept. */
export function listDeletableSessions(allowedRoots: string[], options: SessionSweepOptions = {}): SessionRef[] {
  const now = options.now ?? Date.now();
  const idleCapMs = options.idleCapMs ?? SESSION_DELETE_IDLE_CAP_MS;
  const ownId = (options.env ?? (process.env as SessionIdEnv))?.[SESSION_ID_ENV];
  const out: SessionRef[] = [];
  for (const projectRoot of [...new Set(allowedRoots)]) {
    const claudeDir = path.join(projectRoot, ".claude");
    for (const sessionId of listSessionIds(claudeDir)) {
      if (sessionId === ownId) continue;
      const paths = sessionPathsFor(claudeDir, sessionId);
      if (paths && isAbandoned(paths.dir, now, idleCapMs)) out.push({ projectRoot, sessionId });
    }
  }
  return out;
}
