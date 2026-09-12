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
