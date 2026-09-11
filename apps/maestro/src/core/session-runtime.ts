// Node-touching helpers for the ephemeral session files under <project>/.claude/:
//   maestro_session.json       — { workflow, generated_instances }
//   maestro_session.log.jsonl  — append-only tool-call / dispatch / handoff log
//
// PORTED FROM plugins/maestro/scripts/lib/maestro-session.cjs. Shared by the desktop
// app (which reads them) and the hook scripts (which write them) via the generated CJS bundle.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { MaestroSession } from "./types.js";
import { deriveUsage } from "./session-usage.js";

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

export function readSession(p: string): MaestroSession {
  return readJson<MaestroSession>(p) ?? { workflow: null, generated_instances: [], run_id: null };
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
 * `SessionEnd` deletes `maestro_session.json` entirely, so the next run's first call here always
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
export const SESSION_LOG_FILE = "maestro_session.log.jsonl";

export function sessionLogPath(claudeDir: string): string {
  return path.join(claudeDir, SESSION_LOG_FILE);
}

/**
 * `payload` is the hook's own raw stdin payload (or, for the two `!`command`` gate scripts, simply
 * omitted — they run with no stdin at all). When it carries a `transcript_path`, `deriveUsage` (see
 * session-usage.ts) stamps `ctx_pct`/`ctx_model` onto the entry before it's written; anything short
 * of a clean read (no payload, no path, unreadable file, no usage line) leaves the entry as given.
 */
export function appendSessionLog(claudeDir: string, entry: unknown, payload?: { transcript_path?: string }): void {
  const usage = payload ? deriveUsage(payload) : undefined;
  const stamped = usage && entry && typeof entry === "object" ? { ...entry, ...usage } : entry;
  fs.appendFileSync(sessionLogPath(claudeDir), JSON.stringify(stamped) + "\n");
}
