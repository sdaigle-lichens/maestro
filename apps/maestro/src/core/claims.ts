// Task claims (`066`) — an explicit, attributable, self-expiring file lock over
// `<project>/.claude/maestro-tasks/`, so two concurrent Claude Code sessions picking "the next
// ready task" at the same moment cannot both start the same file.
//
//   <project>/.claude/maestro-tasks/claims/
//     .gitignore              ← "*", written by ensureClaimsDir() on first create (same mechanism
//                                as ensureSessionsRoot() for maestro_sessions/)
//     <task-file>.md.json     ← { session_id, claimed_at, project_root }
//
// A claim is created by an EXCLUSIVE file create (`fs` flag "wx") — it either succeeds (this
// session won the race) or fails with EEXIST (someone else already has it; take the next ready
// task instead). EEXIST is not an error condition anywhere in this module.
//
// Liveness is derived, never trusted from the claim file's own content: a claim is live iff its
// session's directory under `maestro_sessions/` still exists AND that session's `log.jsonl` was
// modified within `CLAIM_IDLE_CAP_MS`. A clean `SessionEnd` deletes the whole directory, so that
// claim reads as dead immediately; a crashed session's directory lingers, so its claim ages out
// once nothing has touched the log for the cap. Dead claims are reclaimable, not errors — reading
// the queue drops them (best-effort, deleting the stale file so the next read doesn't redo the
// work) and the task reverts to plain `ready`.
//
// Claims are strictly DERIVED state: never written into status.json, and the done/ready/blocked
// enum + blockedBy cascade in tasks.ts / maestro-tasks.cjs stay exactly as they were. `listTasks`
// overlays a claim onto a task at read time; it never changes that task's `status`.

import fs from "node:fs";
import path from "node:path";

import { sessionPathsFor } from "./session-paths.js";
import { CLAIM_IDLE_CAP_MS } from "./handoff-channels.js";

export const CLAIMS_DIR_NAME = "claims";

/** `<tasksDir>/claims` — never used directly for I/O outside this module. */
export function claimsDirFor(tasksDir: string): string {
  return path.join(tasksDir, CLAIMS_DIR_NAME);
}

/** The path a claim for `filename` (e.g. "002-add-login.md") lives at. */
export function claimPathFor(tasksDir: string, filename: string): string {
  return path.join(claimsDirFor(tasksDir), `${path.basename(filename)}.json`);
}

/**
 * `ensureSessionsRoot`'s mechanism, replicated exactly: a `.gitignore` containing `*` written into
 * the directory the first time it's created ignores the directory's contents AND itself, needs no
 * re-install, and covers a project that installed before this claims directory existed. The install
 * manifest entry (`GITIGNORE_ENTRIES` in install.ts) is the other half, for brand-new installs.
 */
export function ensureClaimsDir(tasksDir: string): string {
  const dir = claimsDirFor(tasksDir);
  fs.mkdirSync(dir, { recursive: true });
  const ignore = path.join(dir, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n");
  return dir;
}

/** The shape written to `<claims>/<task-file>.json`. */
export interface ClaimFile {
  session_id: string;
  claimed_at: string;
  project_root: string;
}

/** The claim `listTasks` attaches to a `MaestroTask` — `null` when the task carries none. */
export interface TaskClaim {
  sessionId: string;
  claimedAt: string;
  live: boolean;
}

function readClaimFile(filePath: string): ClaimFile | null {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (
      data &&
      typeof data === "object" &&
      typeof (data as ClaimFile).session_id === "string" &&
      typeof (data as ClaimFile).claimed_at === "string"
    ) {
      return data as ClaimFile;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Live iff the claiming session's directory still exists AND its `log.jsonl` was modified within
 * `CLAIM_IDLE_CAP_MS`. A missing session directory (clean `SessionEnd`) is dead immediately; a
 * directory with no log yet is dead too — the spec's liveness test is conjunctive, not "innocent
 * until proven stale".
 */
export function isSessionLive(claudeDir: string, sessionId: string, now: number = Date.now()): boolean {
  const paths = sessionPathsFor(claudeDir, sessionId);
  if (!paths) return false;
  if (!fs.existsSync(paths.dir)) return false;
  try {
    const stat = fs.statSync(paths.log);
    return now - stat.mtimeMs <= CLAIM_IDLE_CAP_MS;
  } catch {
    return false;
  }
}

function listClaimFiles(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

/**
 * Every claim currently on disk under `tasksDir/claims/`, keyed by task filename — reaped on read:
 * a claim this call determines dead is still returned once (`live: false`, so a caller mid-read can
 * show it dying) and its file is best-effort deleted from disk in the same pass, so the NEXT read
 * (and the next `claimTask` attempt) sees a clean slate with no user action required.
 */
export function readClaims(
  projectRoot: string,
  tasksDir: string,
  now: number = Date.now()
): Map<string, TaskClaim> {
  const claudeDir = path.join(projectRoot, ".claude");
  const dir = claimsDirFor(tasksDir);
  const out = new Map<string, TaskClaim>();
  for (const fileName of listClaimFiles(dir)) {
    const filePath = path.join(dir, fileName);
    const claim = readClaimFile(filePath);
    if (!claim) continue;
    const filename = fileName.slice(0, -".json".length);
    const live = isSessionLive(claudeDir, claim.session_id, now);
    out.set(filename, { sessionId: claim.session_id, claimedAt: claim.claimed_at, live });
    if (!live) {
      try {
        fs.rmSync(filePath, { force: true });
      } catch {
        // Not worth failing the read over — the next read tries again.
      }
    }
  }
  return out;
}

export type ClaimResult =
  | { outcome: "claimed" }
  | { outcome: "already-claimed"; claim: TaskClaim };

/**
 * Claim `filename` for `sessionId`. Reaps a dead claim on this same file first (so a stale claim
 * from a crashed session never blocks a fresh one), then attempts an EXCLUSIVE create ("wx") —
 * EEXIST after the reap means a DIFFERENT, still-live session holds it, which is "already-claimed",
 * never an error.
 */
export function claimTask(
  projectRoot: string,
  tasksDir: string,
  filename: string,
  sessionId: string,
  now: number = Date.now()
): ClaimResult {
  const base = path.basename(filename);
  const dir = ensureClaimsDir(tasksDir);
  const filePath = path.join(dir, `${base}.json`);
  const claudeDir = path.join(projectRoot, ".claude");

  const existing = readClaimFile(filePath);
  if (existing) {
    if (isSessionLive(claudeDir, existing.session_id, now)) {
      return {
        outcome: "already-claimed",
        claim: { sessionId: existing.session_id, claimedAt: existing.claimed_at, live: true },
      };
    }
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // Fall through — the "wx" create below will surface EEXIST if this truly failed.
    }
  }

  const payload: ClaimFile = {
    session_id: sessionId,
    claimed_at: new Date(now).toISOString(),
    project_root: projectRoot,
  };
  try {
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
    return { outcome: "claimed" };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    const winner = readClaimFile(filePath);
    if (!winner) {
      // Vanishingly rare: the winner released/reaped between our EEXIST and this read. Treat as
      // won rather than leaving the caller with nothing — the file is gone, so nothing conflicts.
      return { outcome: "claimed" };
    }
    return {
      outcome: "already-claimed",
      claim: { sessionId: winner.session_id, claimedAt: winner.claimed_at, live: true },
    };
  }
}

export type ReleaseResult = "released" | "no-claim" | "not-owner";

/**
 * Release `filename`'s claim, but ONLY when it is currently held by `sessionId` — never deletes a
 * foreign session's claim, live or dead. Removing a live claim you don't own is exactly the bug
 * this whole mechanism exists to prevent.
 */
export function releaseTask(tasksDir: string, filename: string, sessionId: string): ReleaseResult {
  const filePath = claimPathFor(tasksDir, filename);
  const claim = readClaimFile(filePath);
  if (!claim) return "no-claim";
  if (claim.session_id !== sessionId) return "not-owner";
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // Best-effort — nothing else to do with an unlink failure here.
  }
  return "released";
}

/**
 * Unconditional delete of `filename`'s claim, whoever holds it — used when a task is marked done,
 * the same moment `closeTask`/`markDone` already knows the task is finished and any claim on it
 * (this session's own, almost always) has nothing left to protect.
 */
export function deleteClaimIfAny(tasksDir: string, filename: string): void {
  const filePath = claimPathFor(tasksDir, filename);
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // Nothing to clean up, or nothing worth failing over.
  }
}
