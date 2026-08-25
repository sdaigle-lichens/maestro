// Node-touching helpers for the ephemeral session files under <project>/.claude/:
//   maestro_session.json       — { workflow, generated_instances }
//   maestro_session.log.jsonl  — append-only tool-call / dispatch / handoff log
//
// PORTED FROM plugins/maestro/scripts/lib/maestro-session.cjs. Shared by the desktop
// app (which reads them) and the hook scripts (which write them) via the generated CJS bundle.

import fs from "node:fs";
import path from "node:path";
import type { MaestroSession } from "./types.js";

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
  return readJson<MaestroSession>(p) ?? { workflow: null, generated_instances: [] };
}

export function writeSession(p: string, session: MaestroSession): void {
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(session, null, 2));
  fs.renameSync(tmp, p);
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

export function appendSessionLog(claudeDir: string, entry: unknown): void {
  fs.appendFileSync(sessionLogPath(claudeDir), JSON.stringify(entry) + "\n");
}
