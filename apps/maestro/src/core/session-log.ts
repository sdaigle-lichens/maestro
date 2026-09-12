// Reading and live-tailing a session's <project>/.claude/maestro_sessions/<id>/log.jsonl.
//
// PORTED FROM apps/ai-tools-manager/src/utils/maestro-session-log.ts and
// src/routes/api/session-log-stream.ts. The SSE route is gone — in the desktop app the main
// process owns the watcher and pushes entries to the renderer over IPC.
//
// The write side stays where it is: the hooks (maestro-session-log.js, maestro-subagent-log.js)
// append to this file from inside a Claude session. This module is strictly read-only, which is
// what keeps the append-only invariant safe under parallel subagents.

import fs from "node:fs";
import path from "node:path";
import { LEGACY_SESSION_FILES, listSessionIds, sessionPathsFor } from "./session-paths.js";

import type { SessionLogEntry } from "./contracts.js";
export type { SessionLogEntry };

/** The newest session log under `maestro_sessions/` by mtime, or `null` when there is none. */
function newestSessionLog(claudeDir: string): string | null {
  let best: { file: string; mtimeMs: number } | null = null;
  for (const id of listSessionIds(claudeDir)) {
    const file = sessionPathsFor(claudeDir, id)?.log;
    if (!file) continue;
    try {
      const { mtimeMs } = fs.statSync(file);
      if (!best || mtimeMs > best.mtimeMs) best = { file, mtimeMs };
    } catch {
      // A session directory with no log yet — it contributes nothing to "newest".
    }
  }
  return best?.file ?? null;
}

/**
 * The log file this reader should tail.
 *
 * `064` moved the log into a per-session directory, so "the project's log" is no longer a single
 * path. Naming a `sessionId` is the precise answer. Omitting it resolves to the most recently
 * written session — the honest single-session bridge, re-resolved on every poll so a session
 * starting after the tail does gets picked up — and falls back to the pre-`064` flat path when the
 * project has no session directories at all. Showing EVERY live session at once is `065`'s job;
 * this keeps the existing one-log view working rather than blanking it in the meantime.
 */
export function sessionLogFileFor(projectRoot: string, sessionId?: string | null): string {
  const claudeDir = path.join(projectRoot, ".claude");
  const legacy = path.join(claudeDir, LEGACY_SESSION_FILES[1]);
  if (sessionId != null) return sessionPathsFor(claudeDir, sessionId)?.log ?? legacy;
  return newestSessionLog(claudeDir) ?? legacy;
}

/** Parse a JSONL string into SessionLogEntry[], skipping malformed lines. */
export function parseLogLines(raw: string): SessionLogEntry[] {
  return raw
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as SessionLogEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is SessionLogEntry => !!e && typeof e.origin === "string");
}

export function readSessionLog(projectRoot: string): SessionLogEntry[] {
  if (!projectRoot) return [];
  try {
    return parseLogLines(fs.readFileSync(sessionLogFileFor(projectRoot), "utf8"));
  } catch {
    return [];
  }
}

export interface SessionLogTailEvents {
  /** Full snapshot on subscribe, and again whenever the file reappears. */
  init: (entries: SessionLogEntry[]) => void;
  /** One newly appended entry. */
  entry: (entry: SessionLogEntry) => void;
  /** The file went away — SessionEnd wiped it. */
  reset: () => void;
}

/**
 * Watch a project's session log and emit appended entries.
 *
 * Polls rather than relying solely on fs.watch: the file is created, appended to by several
 * processes, and deleted at SessionEnd, and fs.watch's behaviour across those transitions is
 * inconsistent (especially on Linux, where the watch is dropped when the inode goes away). The
 * poll is cheap — we track how many lines we have already emitted and only parse the tail.
 *
 * Returns an unsubscribe function.
 */
export function tailSessionLog(
  projectRoot: string,
  events: Partial<SessionLogTailEvents>,
  intervalMs = 1000
): () => void {
  let lineCount = 0;
  /**
   * Whether we have emitted entries a consumer would need to be told to drop — NOT whether the
   * file exists. That is why it is seeded from `snapshot.length > 0`: an empty-but-existing log
   * and an absent one are indistinguishable here, and deliberately so, since a `reset` for a view
   * that was already empty is a no-op. test/session-log.test.ts pins each transition.
   */
  let sawFile = false;
  let stopped = false;
  /**
   * WHICH file `lineCount` counts lines of (`064`). Before the per-session split there was one
   * path per project and this could not change; now `sessionLogFileFor` answers "the newest
   * session", re-resolved every poll, so the answer flips the moment a sibling session writes.
   * `lineCount` is a position in a file, not in a path — without tracking the path, a flip to a
   * LONGER sibling log emits `entries.slice(lineCount)` of the new file as if it were an append
   * to the old one, and the view renders one session's head spliced onto another's tail. (A flip
   * to a SHORTER one already resynced, via the truncation branch below, purely by luck.)
   */
  let currentFile: string | null = null;

  const read = (): { file: string; raw: string } => {
    const file = sessionLogFileFor(projectRoot);
    try {
      return { file, raw: fs.readFileSync(file, "utf8") };
    } catch {
      return { file, raw: "" };
    }
  };

  const first = read();
  currentFile = first.file;
  const snapshot = parseLogLines(first.raw);
  lineCount = snapshot.length;
  sawFile = snapshot.length > 0;
  events.init?.(snapshot);

  const timer = setInterval(() => {
    if (stopped) return;
    const { file, raw } = read();
    if (!raw) {
      // File is gone (SessionEnd) — emit reset once, then wait for a new session.
      if (sawFile) {
        sawFile = false;
        lineCount = 0;
        events.reset?.();
      }
      currentFile = file;
      return;
    }
    const entries = parseLogLines(raw);
    if (file !== currentFile || entries.length < lineCount) {
      // Either we re-resolved to a DIFFERENT session's log, or this one was truncated/replaced
      // underneath us. `lineCount` indexes the file we were reading, so in both cases resync
      // wholesale rather than emitting a tail spliced onto another file's entries.
      currentFile = file;
      lineCount = 0;
      if (sawFile) events.reset?.();
      events.init?.(entries);
      lineCount = entries.length;
      sawFile = entries.length > 0;
      return;
    }
    for (const entry of entries.slice(lineCount)) events.entry?.(entry);
    lineCount = entries.length;
    sawFile = true;
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export interface MultiSessionLogTailEvents {
  /** A session's log file appeared (first seen with content, or created empty). */
  init: (projectRoot: string, sessionId: string, entries: SessionLogEntry[]) => void;
  /** One newly appended entry for an already-`init`ed session. */
  entry: (projectRoot: string, sessionId: string, entry: SessionLogEntry) => void;
  /** The session's directory (or its project) went away, or the log shrank and is resyncing. */
  end: (projectRoot: string, sessionId: string) => void;
}

/**
 * Watch EVERY live session across EVERY project `getProjectRoots()` names, on one poll loop (`065`).
 *
 * `064` gave each session a permanent, unambiguous file — `sessionPathsFor(claudeDir, id).log` never
 * refers to a different session over its lifetime, unlike the pre-`064` "newest by mtime" path that
 * `tailSessionLog` above still has to guard against flipping underneath it. That is what makes the
 * per-session bookkeeping here a plain `Map<projectRoot, Map<sessionId, lineCount>>`: no path-identity
 * tracking, no resync-on-flip — a session's identity IS its map key, for its whole life.
 *
 * `getProjectRoots` is called fresh every tick rather than once at subscribe time, so a project
 * opened or forgotten after the tail started is picked up (or dropped) within one interval. The
 * caller is responsible for that list being an allow-list (current project + recent projects) —
 * this function reads only what it is given, never anything else on disk.
 *
 * Returns an unsubscribe function.
 */
export function tailSessionLogs(
  getProjectRoots: () => string[],
  events: Partial<MultiSessionLogTailEvents>,
  intervalMs = 1000
): () => void {
  /** projectRoot -> sessionId -> lines already emitted for that session. */
  const tracked = new Map<string, Map<string, number>>();
  let stopped = false;

  const poll = (): void => {
    if (stopped) return;
    const roots = [...new Set(getProjectRoots())];
    const rootSet = new Set(roots);

    // A project no longer in the allow-list (closed and not recent, or forgotten): every session
    // it was covering is gone from our vantage point, so it ends the same as a deleted directory.
    for (const root of [...tracked.keys()]) {
      if (rootSet.has(root)) continue;
      const sessions = tracked.get(root);
      if (sessions) for (const sessionId of sessions.keys()) events.end?.(root, sessionId);
      tracked.delete(root);
    }

    for (const root of roots) {
      const claudeDir = path.join(root, ".claude");
      // Absent project directory: listSessionIds already swallows the ENOENT and returns [] — one
      // failed readdir, no throw, no special-casing needed here.
      const liveIds = new Set(listSessionIds(claudeDir));
      let sessions = tracked.get(root);

      if (sessions) {
        for (const sessionId of [...sessions.keys()]) {
          if (liveIds.has(sessionId)) continue;
          sessions.delete(sessionId);
          events.end?.(root, sessionId);
        }
      }

      for (const sessionId of liveIds) {
        const paths = sessionPathsFor(claudeDir, sessionId);
        if (!paths) continue;
        let raw: string;
        try {
          raw = fs.readFileSync(paths.log, "utf8");
        } catch {
          // Directory exists but the log file has not been written yet — not live until it is.
          continue;
        }
        const entries = parseLogLines(raw);
        if (!sessions) {
          sessions = new Map();
          tracked.set(root, sessions);
        }
        const lineCount = sessions.get(sessionId);
        if (lineCount === undefined) {
          sessions.set(sessionId, entries.length);
          events.init?.(root, sessionId, entries);
          continue;
        }
        if (entries.length < lineCount) {
          // Truncated/replaced underneath us — resync wholesale rather than emit a negative tail.
          events.end?.(root, sessionId);
          sessions.set(sessionId, entries.length);
          events.init?.(root, sessionId, entries);
          continue;
        }
        if (entries.length > lineCount) {
          for (const entry of entries.slice(lineCount)) events.entry?.(root, sessionId, entry);
          sessions.set(sessionId, entries.length);
        }
      }

      if (sessions && sessions.size === 0) tracked.delete(root);
    }
  };

  poll();
  const timer = setInterval(poll, intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
