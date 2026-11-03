// Session heartbeat (`141`) — answers "is this Maestro session still open?" for task claims and the
// worktree decision, whether the session is busy, waiting on the user, or running only inline steps.
//
// The log (`log.jsonl`) is only written by tool calls, so a session blocked on AskUserQuestion, or
// one that dispatches nothing, used to look dead after `CLAIM_IDLE_CAP_MS`. Two constraints shape
// the replacement:
//
//   - The Bash sandbox has its own PID namespace, so the claim CLI can never check another session's
//     claude PID itself. Liveness has to be readable from disk.
//   - No hook fires while a session is blocked on the user, so a hook-written timestamp cannot stay
//     fresh while it waits.
//
// So a SessionStart hook (`maestro-session-heartbeat.js`, which runs OUTSIDE the sandbox) spawns a
// detached process that watches the claude process and, every `HEARTBEAT_INTERVAL_MS`, touches
// `heartbeat` in every directory of the session. When claude is gone it sets that file's mtime to 0
// (dead at once for `isSessionLive`) and exits. A later SessionStart for the same session (resume,
// compact) writes its own pid into `heartbeat.pid`, and the older process stops at its next tick, so
// there is exactly one heartbeat per session. The session directory disappearing (a final
// SessionEnd) stops it too, and it never recreates the directory.
//
// The liveness rule itself (`heartbeatVerdict`) is used by `isSessionLive` in claims.ts; its
// hand-written twin lives in `maestro-task-status.cjs`.

import fs from "node:fs";
import path from "node:path";

import { HEARTBEAT_INTERVAL_ENV, HEARTBEAT_INTERVAL_MS, HEARTBEAT_STALE_MS } from "./handoff-channels.js";
import {
  SESSION_HEARTBEAT_NAME,
  SESSION_HEARTBEAT_PID_NAME,
  sessionDirsFor,
  sessionPathsFor,
} from "./session-paths.js";

/**
 * The heartbeat's say on whether the session in `dir` is live: `true`/`false` when a `heartbeat`
 * file exists (fresh within `HEARTBEAT_STALE_MS` or not), `null` when there is none — the caller
 * then falls back to the log rule. A heartbeat that exists but is stale is dead even if the log is
 * fresh: that is what makes an ended session reclaimable at once.
 */
export function heartbeatVerdict(dir: string, now: number = Date.now()): boolean | null {
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(path.join(dir, SESSION_HEARTBEAT_NAME)).mtimeMs;
  } catch {
    return null;
  }
  return now - mtimeMs <= HEARTBEAT_STALE_MS;
}

/** The tick interval: `MAESTRO_HEARTBEAT_INTERVAL_MS` when it is a positive number, else the default. */
export function heartbeatIntervalMs(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env[HEARTBEAT_INTERVAL_ENV]);
  return Number.isFinite(raw) && raw > 0 ? raw : HEARTBEAT_INTERVAL_MS;
}

/** Where one tick looks, re-resolved every tick: a worktree move relocates the session's state. */
export interface HeartbeatTargets {
  /** `heartbeat.pid` in the directory the session's paths resolve to, or null for a bad id. */
  pidFile: string | null;
  /** Every directory of the session (`sessionDirsFor`) — existing or not; the tick filters. */
  sessionDirs: string[];
}

export function heartbeatTargets(claudeDir: string, sessionId: string): HeartbeatTargets {
  const paths = sessionPathsFor(claudeDir, sessionId);
  return {
    pidFile: paths ? path.join(paths.dir, SESSION_HEARTBEAT_PID_NAME) : null,
    sessionDirs: sessionDirsFor(claudeDir, sessionId),
  };
}

/** Record `pid` as the one heartbeat owning the session. Best-effort; the directory must exist. */
export function writeHeartbeatPid(pidFile: string, pid: number): boolean {
  try {
    fs.writeFileSync(pidFile, `${pid}\n`);
    return true;
  } catch {
    return false;
  }
}

export interface HeartbeatTickInput {
  /** Is the watched claude process still running? */
  parentAlive: boolean;
  /** This heartbeat process's own pid. */
  ownPid: number;
  /** `heartbeat.pid` to check ownership against (see {@link heartbeatTargets}). */
  pidFile: string | null;
  /** Every directory of the session; only the ones that exist are touched. */
  sessionDirs: string[];
  /** Injected clock (ms). */
  now: number;
}

export type HeartbeatTickResult = "continue" | "stop";

function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Set `<dir>/heartbeat`'s mtime to `atMs`, creating the file if the directory exists. */
function stamp(dir: string, atMs: number): void {
  const file = path.join(dir, SESSION_HEARTBEAT_NAME);
  try {
    fs.closeSync(fs.openSync(file, "a"));
    const t = new Date(atMs);
    fs.utimesSync(file, t, t);
  } catch {
    // Best-effort: the next tick tries again.
  }
}

/**
 * One heartbeat step. Order matters:
 *
 *   1. No session directory left (a final SessionEnd removed it) → `stop`, touching nothing, so
 *      the directory is never recreated.
 *   2. `heartbeat.pid` names another process (a later SessionStart took over) → `stop`, touching
 *      nothing. A missing or unreadable pid file is not a takeover: every heartbeat writes its pid
 *      before its first tick, so it can only be missing mid-move.
 *   3. Parent gone → set every `heartbeat` to mtime 0 (dead at once) → `stop`.
 *   4. Otherwise touch every `heartbeat` at `now` → `continue`.
 */
export function heartbeatTick(input: HeartbeatTickInput): HeartbeatTickResult {
  const dirs = input.sessionDirs.filter(isDir);
  if (dirs.length === 0) return "stop";
  if (input.pidFile) {
    let owner: number | null = null;
    try {
      owner = Number.parseInt(fs.readFileSync(input.pidFile, "utf8").trim(), 10);
    } catch {
      owner = null;
    }
    if (owner !== null && Number.isFinite(owner) && owner !== input.ownPid) return "stop";
  }
  if (!input.parentAlive) {
    for (const dir of dirs) stamp(dir, 0);
    return "stop";
  }
  for (const dir of dirs) stamp(dir, input.now);
  return "continue";
}

// ── The process being watched ───────────────────────────────────────────────────────────────────

/** True while `pid` exists. EPERM (exists, owned by someone else) counts as alive. */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface ProcessInfo {
  ppid: number;
  /** The executable's short name (`comm`). */
  name: string;
  /** Linux only: the process start time (clock ticks since boot), to tell a reused pid apart. */
  startTime: string | null;
}

/**
 * `ppid`/name/start time of `pid` from `/proc/<pid>/stat` (Linux); null elsewhere or when there is
 * no such process. Spawning `ps` for other platforms is the hook script's job, not core's: core
 * modules reachable from the preview path must never start a process (`test/isolation.test.ts`).
 */
export function processInfo(pid: number): ProcessInfo | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const open = stat.indexOf("(");
    const close = stat.lastIndexOf(")");
    if (open < 0 || close < open) return null;
    const rest = stat
      .slice(close + 2)
      .trim()
      .split(" ");
    // After the `(comm)` field: [0] state, [1] ppid, … [19] starttime (field 22 of proc(5)).
    return { ppid: Number(rest[1]), name: stat.slice(open + 1, close), startTime: rest[19] ?? null };
  } catch {
    return null;
  }
}

/** Parse `ps -o ppid=,comm= -p <pid>` output (the non-Linux fallback the hook script runs). */
export function parsePsLine(out: string): ProcessInfo | null {
  const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(out);
  return m ? { ppid: Number(m[1]), name: path.basename(m[2]!), startTime: null } : null;
}

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "mksh", "ash", "fish", "busybox"]);

/**
 * The claude process to watch, starting from the hook's parent. The plugin registers the hook in
 * exec form (`command: "node"`), so the parent IS claude; a project-local registration is a
 * command string, which Claude Code may run through a shell that exits with the hook. Shells are
 * skipped (at most a few levels); when nothing can be read, `startPid` is the answer.
 */
export function watchedPid(startPid: number, infoOf: (pid: number) => ProcessInfo | null = processInfo): number {
  let pid = startPid;
  for (let i = 0; i < 4; i++) {
    const info = infoOf(pid);
    if (!info || !SHELLS.has(info.name) || !Number.isInteger(info.ppid) || info.ppid <= 1) return pid;
    pid = info.ppid;
  }
  return pid;
}

/**
 * A liveness probe for `pid` that also notices pid reuse where the platform allows it: on Linux the
 * process's start time is recorded now and must still match later.
 */
export function parentProbe(pid: number, infoOf: (pid: number) => ProcessInfo | null = processInfo): () => boolean {
  const startTime = infoOf(pid)?.startTime ?? null;
  return () => {
    if (!isProcessAlive(pid)) return false;
    if (startTime === null) return true;
    const now = infoOf(pid);
    return now === null || now.startTime === null || now.startTime === startTime;
  };
}
