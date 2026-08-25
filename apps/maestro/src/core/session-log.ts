// Reading and live-tailing <project>/.claude/maestro_session.log.jsonl.
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
import { SESSION_LOG_FILE } from "./session-runtime.js";

import type { SessionLogEntry } from "./contracts.js";
export type { SessionLogEntry };

export function sessionLogFileFor(projectRoot: string): string {
  return path.join(projectRoot, ".claude", SESSION_LOG_FILE);
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

  const read = (): string => {
    try {
      return fs.readFileSync(sessionLogFileFor(projectRoot), "utf8");
    } catch {
      return "";
    }
  };

  const snapshot = parseLogLines(read());
  lineCount = snapshot.length;
  sawFile = snapshot.length > 0;
  events.init?.(snapshot);

  const timer = setInterval(() => {
    if (stopped) return;
    const raw = read();
    if (!raw) {
      // File is gone (SessionEnd) — emit reset once, then wait for a new session.
      if (sawFile) {
        sawFile = false;
        lineCount = 0;
        events.reset?.();
      }
      return;
    }
    const entries = parseLogLines(raw);
    if (entries.length < lineCount) {
      // Truncated/replaced underneath us — resync rather than emit a negative tail.
      lineCount = 0;
      events.reset?.();
      events.init?.(entries);
      lineCount = entries.length;
      sawFile = true;
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
