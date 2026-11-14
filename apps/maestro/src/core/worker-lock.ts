// The per-project worker-image lock (`181`).
//
// Two sessions of one project (or two epic managers) can run the launcher's `image` build and `prune`
// at the same time; a build racing a build wastes minutes building the same tag twice, and a prune
// racing a build can remove the image the build just made. One exclusive lock per project serialises
// them: `image` and a real (non dry-run) `prune` take it, and the waiter re-checks the world once it
// holds the lock (the second build then finds the image and reuses it).
//
// The lock is a directory created with `mkdir` (atomic, exclusive) holding `owner.json`. It lives
// under the host user's home (`~/.config/maestro/locks/`), never in the repository and never in any
// directory a worker container mounts (the repo, the worktree, `~/.config/maestro/approvals`), so a
// worker cannot see, take or release it. The key is the project's `projectLabelFor` of its MAIN
// checkout, so a worktree and a second manager of the same project share one lock.
//
// A lock whose owner process is gone is stale and is taken over. `fs`/`path`/`crypto` only (through
// `worker-runtime.ts`): it rides the `maestro-worker-runtime` bundle, copied into projects, and every
// wait is a synchronous sleep, because the launcher is a synchronous script.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { projectLabelFor } from "./worker-runtime.js";

export type WorkerLockKind = "build" | "prune";

export interface WorkerLockOwner {
  pid: number;
  kind: WorkerLockKind;
  /** Random per acquisition: release only removes a lock that is still this holder's. */
  token: string;
  started_at: string;
}

export const WORKER_LOCK_REL = path.join(".config", "maestro", "locks");
/** How long a waiter waits before giving up (a cold image build can take many minutes). */
export const WORKER_LOCK_TIMEOUT_MS = 45 * 60 * 1000;
export const WORKER_LOCK_POLL_MS = 500;
/** A lock directory with no readable owner file this old is a crash between `mkdir` and the write. */
export const WORKER_LOCK_OWNERLESS_GRACE_MS = 5000;

/** The lock directory of a project (pass its main checkout root). Always under `home`. */
export function workerLockDir(home: string, projectRoot: string): string {
  return path.join(home, WORKER_LOCK_REL, `worker-image-${projectLabelFor(projectRoot)}`);
}

export interface WorkerLockOptions {
  kind: WorkerLockKind;
  pid?: number;
  timeoutMs?: number;
  pollMs?: number;
  ownerlessGraceMs?: number;
  now?: () => number;
  /** Block for `ms`. Defaults to a synchronous sleep. */
  sleep?: (ms: number) => void;
  /** Is a process alive? Defaults to `process.kill(pid, 0)`. */
  isAlive?: (pid: number) => boolean;
  /** Called once, before the first wait, with the holder (null when it could not be read). */
  onWait?: (owner: WorkerLockOwner | null) => void;
  /** Called when a stale lock was taken over, with the dead holder. */
  onRecovered?: (owner: WorkerLockOwner | null) => void;
}

export type WorkerLockResult =
  | { ok: true; /** True when this call waited for another holder first. */ waited: boolean; release: () => void }
  | { ok: false; message: string };

export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists but belongs to someone else. Only ESRCH means gone.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function ownerFile(dir: string): string {
  return path.join(dir, "owner.json");
}

export function readLockOwner(dir: string): WorkerLockOwner | null {
  try {
    const o = JSON.parse(fs.readFileSync(ownerFile(dir), "utf8")) as Partial<WorkerLockOwner>;
    if (typeof o.pid !== "number" || typeof o.token !== "string") return null;
    return {
      pid: o.pid,
      token: o.token,
      kind: o.kind === "prune" ? "prune" : "build",
      started_at: typeof o.started_at === "string" ? o.started_at : "",
    };
  } catch {
    return null;
  }
}

/** Words for what a waiter is waiting on. */
export function describeLockHolder(owner: WorkerLockOwner | null): string {
  if (!owner) return "another worker image build or prune of this project";
  return `a worker image ${owner.kind} of this project (pid ${owner.pid})`;
}

function tryCreate(dir: string, owner: WorkerLockOwner): boolean {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  try {
    fs.mkdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
  try {
    fs.writeFileSync(ownerFile(dir), JSON.stringify(owner));
  } catch (err) {
    // A stale-takeover rename moved our brand-new directory away before the owner file landed: we
    // do not hold the lock, so report contention and let the loop try again.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
  return true;
}

/**
 * Move a stale lock out of the way. Rename is atomic, so of several waiters only one removes it. If
 * the directory we moved turns out to hold a different, newer lock than the stale one we judged
 * (someone else recovered and re-took it between our read and our rename), it is put back.
 */
function breakStale(dir: string, seen: WorkerLockOwner | null, graceMs: number, nowMs: number): boolean {
  const moved = `${dir}.stale-${crypto.randomBytes(4).toString("hex")}`;
  try {
    fs.renameSync(dir, moved);
  } catch {
    return false;
  }
  // Is what we moved still the very lock we judged stale? An owner: same token. Ownerless: still
  // ownerless and still older than the grace. Anything else (a rival's live lock, a fresh directory
  // another process is mid-way through creating) goes back.
  const found = readLockOwner(moved);
  let same: boolean;
  if (seen) same = found !== null && found.token === seen.token;
  else {
    try {
      same = found === null && nowMs - fs.statSync(moved).mtimeMs >= graceMs;
    } catch {
      same = false;
    }
  }
  if (!same) {
    try {
      fs.renameSync(moved, dir);
      return false;
    } catch {
      // the lock was taken again meanwhile: the moved one is just garbage now
    }
  }
  fs.rmSync(moved, { recursive: true, force: true });
  return same;
}

/**
 * Take the project's worker-image lock, waiting for a live holder. Never throws on contention: a
 * timeout is `{ ok: false, message }`. The returned `release` removes the lock only while it is still
 * this acquisition's.
 */
export function acquireWorkerLock(dir: string, opts: WorkerLockOptions): WorkerLockResult {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? sleepSync;
  const alive = opts.isAlive ?? isProcessAlive;
  const timeoutMs = opts.timeoutMs ?? WORKER_LOCK_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? WORKER_LOCK_POLL_MS;
  const grace = opts.ownerlessGraceMs ?? WORKER_LOCK_OWNERLESS_GRACE_MS;
  const me: WorkerLockOwner = {
    pid: opts.pid ?? process.pid,
    kind: opts.kind,
    token: crypto.randomBytes(8).toString("hex"),
    started_at: new Date(now()).toISOString(),
  };
  const started = now();
  let waited = false;
  for (;;) {
    if (tryCreate(dir, me)) {
      const release = () => {
        if (readLockOwner(dir)?.token === me.token) fs.rmSync(dir, { recursive: true, force: true });
      };
      return { ok: true, waited, release };
    }
    const owner = readLockOwner(dir);
    let stale = false;
    if (owner) stale = !alive(owner.pid);
    else {
      try {
        stale = now() - fs.statSync(dir).mtimeMs >= grace;
      } catch {
        continue; // released between the mkdir and the stat: try again at once
      }
    }
    if (stale) {
      if (breakStale(dir, owner, grace, now())) opts.onRecovered?.(owner);
      continue;
    }
    if (now() - started >= timeoutMs)
      return {
        ok: false,
        message: `timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${describeLockHolder(owner)}; try again when it finishes`,
      };
    if (!waited) opts.onWait?.(owner);
    waited = true;
    sleep(pollMs);
  }
}
