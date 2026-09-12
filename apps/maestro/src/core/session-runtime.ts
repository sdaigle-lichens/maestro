// Node-touching helpers for the ephemeral session state under
// <project>/.claude/maestro_sessions/<session_id>/:
//   session.json  — { workflow, generated_instances, run_id }
//   log.jsonl     — append-only tool-call / dispatch / handoff log
//   tasks.json    — TaskCreate coverage for the session (written by maestro-validate-tasks)
//
// WHERE those paths come from, and which session id they belong to, is session-paths.ts's job
// (`064`) — this module only reads and writes. Before `064` all three were one fixed file per
// project and two concurrent sessions corrupted each other; see that file's header.
//
// PORTED FROM plugins/maestro/scripts/lib/maestro-session.cjs. Shared by the desktop
// app (which reads them) and the hook scripts (which write them) via the generated CJS bundle.

import fs from "node:fs";
import crypto from "node:crypto";
import type { MaestroSession } from "./types.js";
import { deriveUsage } from "./session-usage.js";
import { ensureSessionPaths, sessionPathsFor, SESSION_LOG_NAME, type SessionIdSource } from "./session-paths.js";

/** Hook scripts receive their payload on stdin. Unused by the desktop app; kept for the bundle. */
export function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}

export function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * `p` is nullable so a caller whose session id didn't resolve can pass the miss straight through
 * and get the same blank session an unreadable file gives — the degradation every reader of this
 * state already had, rather than a second branch at every call site.
 */
export function readSession(p: string | null): MaestroSession {
  return (p ? readJson<MaestroSession>(p) : null) ?? { workflow: null, generated_instances: [], run_id: null };
}

export function writeSession(p: string, session: MaestroSession): void {
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(session, null, 2));
  fs.renameSync(tmp, p);
}

/**
 * The run stamp channel files are marked with (`036`). Read-or-mint: a session that already has a
 * `run_id` keeps it (every caller in one run must agree), a session that doesn't gets one written
 * back immediately, so the very first `SubagentStart`/`SubagentStop` of a run can stamp against it.
 * `SessionEnd` deletes the session's whole directory, so the next run's first call here always
 * mints a fresh id — that is the whole freshness guarantee for channel delivery.
 */
export function ensureSessionRunId(p: string): string {
  const session = readSession(p);
  if (session.run_id) return session.run_id;
  const run_id = crypto.randomUUID();
  writeSession(p, { ...session, run_id });
  return run_id;
}

/**
 * Tool-call logs are append-only (one JSON object per line) so concurrent writers — e.g.
 * parallel subagents firing PreToolUse — can't clobber each other the way a read-modify-write
 * of a shared JSON array would. Do not "improve" this into a JSON array.
 */
export const SESSION_LOG_FILE = SESSION_LOG_NAME;

/**
 * The log file for ONE session, or `null` when `sessionId` is not a valid session id — the same
 * "no session, nothing to read" answer `resolveSessionPaths` gives, so a reader can hand the result
 * straight to its own tolerant file read.
 */
export function sessionLogPath(claudeDir: string, sessionId: unknown): string | null {
  return sessionPathsFor(claudeDir, sessionId)?.log ?? null;
}

/**
 * `payload` is the hook's own raw stdin payload (or, for the two `!`command`` gate scripts, simply
 * omitted — they run with no stdin at all). It does two jobs, which is exactly why `064` could
 * route every writer per-session WITHOUT touching a single call site:
 *
 *  - `transcript_path` → `deriveUsage` (see session-usage.ts) stamps `ctx_pct`/`ctx_model` onto the
 *    entry before it's written; anything short of a clean read (no payload, no path, unreadable
 *    file, no usage line) leaves the entry as given.
 *  - `session_id` → WHICH session's log this line belongs in. Omitted payload falls back to
 *    `CLAUDE_CODE_SESSION_ID`, which is how the two gate scripts still get their `kind:"phase"`
 *    marker written despite running with no stdin at all.
 *
 * No session id resolves ⇒ **silent no-op**. Never a throw, never a write to a shared file: a line
 * nobody can attribute is worth less than the corruption interleaving it would reintroduce.
 */
export function appendSessionLog(
  claudeDir: string,
  entry: unknown,
  payload?: SessionIdSource & { transcript_path?: string }
): void {
  const paths = ensureSessionPaths(claudeDir, payload);
  if (!paths) return;
  const usage = payload ? deriveUsage(payload) : undefined;
  const stamped = usage && entry && typeof entry === "object" ? { ...entry, ...usage } : entry;
  fs.appendFileSync(paths.log, JSON.stringify(stamped) + "\n");
}
