// Task claims (`066`): an explicit, attributable, self-expiring file lock over
// `<project>/.claude/maestro-tasks/claims/`, so two concurrent Claude Code sessions asking for
// "the next ready task" at the same moment cannot both take it. Driven directly against
// `src/core/claims.ts` — no mocking, real `fs` calls against a real tmp project — following
// per-session-state.test.ts's conventions for building fake `maestro_sessions/<id>/` directories
// and controlling `log.jsonl` mtimes with `fs.utimesSync` rather than sleeping.
//
// Liveness is conjunctive (session directory exists AND its log is within CLAIM_IDLE_CAP_MS), and
// dead claims are reaped ON READ: `readClaims` returns a dead claim once (`live: false`) and
// deletes its file in that same pass, so the NEXT read sees a clean slate. Several tests below pin
// that one-shot-then-gone shape explicitly, per the frontend handoff's note that this is real
// state, not a bug.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  claimsDirFor,
  claimPathFor,
  ensureClaimsDir,
  isSessionLive,
  readClaims,
  claimTask,
  releaseTask,
  deleteClaimIfAny,
  type ClaimFile,
} from "../../src/core/claims.js";
import { CLAIM_IDLE_CAP_MS } from "../../src/core/handoff-channels.js";

const SESSION_A = "sess-aaa-111";
const SESSION_B = "sess-bbb-222";

let tmp: string;
let projectRoot: string;
let claudeDir: string;
let tasksDir: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-066-"));
  projectRoot = path.join(tmp, "proj");
  claudeDir = path.join(projectRoot, ".claude");
  tasksDir = path.join(claudeDir, "maestro-tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const sessionDir = (id: string) => path.join(claudeDir, "maestro_sessions", id);
const logFile = (id: string) => path.join(sessionDir(id), "log.jsonl");

/**
 * Build a session directory with a log.jsonl at a given mtime — `null` mtime means "leave the
 * directory with no log at all" (a session that hasn't logged yet), `undefined` means "just
 * written, so its mtime is now" (live), and a `Date` sets that exact mtime via `fs.utimesSync`
 * rather than sleeping, mirroring per-session-state.test.ts's approach for the same problem.
 */
function makeSession(id: string, logMtime?: Date | null): void {
  fs.mkdirSync(sessionDir(id), { recursive: true });
  if (logMtime === null) return;
  const log = logFile(id);
  fs.writeFileSync(log, '{"kind":"tool_call"}\n');
  if (logMtime) fs.utimesSync(log, logMtime, logMtime);
}

function readClaimFile(filePath: string): ClaimFile {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

// ── isSessionLive / readClaims ───────────────────────────────────────────────

describe("isSessionLive (066)", () => {
  it("is dead when the session directory does not exist at all", () => {
    expect(isSessionLive(claudeDir, SESSION_A)).toBe(false);
  });

  it("is dead when the directory exists but has no log.jsonl yet", () => {
    makeSession(SESSION_A, null);
    expect(isSessionLive(claudeDir, SESSION_A)).toBe(false);
  });

  it("is live when log.jsonl's mtime is fresh", () => {
    makeSession(SESSION_A);
    expect(isSessionLive(claudeDir, SESSION_A)).toBe(true);
  });

  it("is dead when log.jsonl's mtime is older than CLAIM_IDLE_CAP_MS", () => {
    const now = Date.now();
    makeSession(SESSION_A, new Date(now - CLAIM_IDLE_CAP_MS - 60_000));
    expect(isSessionLive(claudeDir, SESSION_A, now)).toBe(false);
  });

  it("is live comfortably inside the cap boundary", () => {
    // Not an exact-millisecond boundary check: fs.utimesSync's precision is platform-dependent
    // (some filesystems truncate to whole seconds), so pin well inside/outside the 15-minute cap
    // rather than asserting the <= vs < edge exactly.
    const now = Date.now();
    makeSession(SESSION_A, new Date(now - CLAIM_IDLE_CAP_MS + 5_000));
    expect(isSessionLive(claudeDir, SESSION_A, now)).toBe(true);
  });

  it("is dead comfortably past the cap", () => {
    const now = Date.now();
    makeSession(SESSION_A, new Date(now - CLAIM_IDLE_CAP_MS - 5_000));
    expect(isSessionLive(claudeDir, SESSION_A, now)).toBe(false);
  });
});

describe("readClaims — dead via a removed session directory (066)", () => {
  it("reads a claim for a session with no directory as dead, once, then reaps it", () => {
    ensureClaimsDir(tasksDir);
    fs.writeFileSync(
      claimPathFor(tasksDir, "001-a.md"),
      JSON.stringify({ session_id: SESSION_A, claimed_at: new Date().toISOString(), project_root: projectRoot })
    );
    // No maestro_sessions/SESSION_A directory anywhere — the "clean SessionEnd" case.

    const first = readClaims(projectRoot, tasksDir);
    expect(first.get("001-a.md")).toEqual({
      sessionId: SESSION_A,
      claimedAt: expect.any(String),
      live: false,
    });
    expect(fs.existsSync(claimPathFor(tasksDir, "001-a.md"))).toBe(false); // reaped in the same pass

    const second = readClaims(projectRoot, tasksDir);
    expect(second.has("001-a.md")).toBe(false); // gone on the very next read
  });
});

describe("readClaims — dead via a stale log mtime (066)", () => {
  it("reads a claim as dead when its session's log has been idle past the cap, and reaps it", () => {
    const now = Date.now();
    makeSession(SESSION_A, new Date(now - CLAIM_IDLE_CAP_MS - 5 * 60_000)); // 20 minutes idle
    ensureClaimsDir(tasksDir);
    fs.writeFileSync(
      claimPathFor(tasksDir, "001-a.md"),
      JSON.stringify({ session_id: SESSION_A, claimed_at: new Date(now).toISOString(), project_root: projectRoot })
    );

    const claims = readClaims(projectRoot, tasksDir, now);
    expect(claims.get("001-a.md")).toMatchObject({ sessionId: SESSION_A, live: false });
    expect(fs.existsSync(claimPathFor(tasksDir, "001-a.md"))).toBe(false);
  });
});

describe("readClaims — live via a fresh log mtime (066)", () => {
  it("reads a claim as live when its session's log was touched recently, and does not reap it", () => {
    makeSession(SESSION_A); // fresh mtime
    ensureClaimsDir(tasksDir);
    const filePath = claimPathFor(tasksDir, "001-a.md");
    fs.writeFileSync(
      filePath,
      JSON.stringify({ session_id: SESSION_A, claimed_at: new Date().toISOString(), project_root: projectRoot })
    );

    const claims = readClaims(projectRoot, tasksDir);
    expect(claims.get("001-a.md")).toMatchObject({ sessionId: SESSION_A, live: true });
    expect(fs.existsSync(filePath)).toBe(true); // untouched — nothing to reap

    // And it stays live and in place on a second read.
    const again = readClaims(projectRoot, tasksDir);
    expect(again.get("001-a.md")).toMatchObject({ sessionId: SESSION_A, live: true });
  });
});

// ── claimTask: exclusive create ("wx") ───────────────────────────────────────

describe("claimTask — exclusive create semantics (066)", () => {
  it("a raw fs 'wx' create on the same path fails with EEXIST rather than silently overwriting", () => {
    ensureClaimsDir(tasksDir);
    const filePath = claimPathFor(tasksDir, "001-a.md");
    fs.writeFileSync(filePath, "first", { flag: "wx" });
    expect(() => fs.writeFileSync(filePath, "second", { flag: "wx" })).toThrow(
      expect.objectContaining({ code: "EEXIST" })
    );
    expect(fs.readFileSync(filePath, "utf8")).toBe("first"); // the loser never touched the winner's file
  });

  it("of two concurrent claims for the same task, exactly one wins and the loser is told, not thrown at", () => {
    makeSession(SESSION_A); // live, so it stays the winner when B's attempt reads it back
    const first = claimTask(projectRoot, tasksDir, "001-a.md", SESSION_A);
    const second = claimTask(projectRoot, tasksDir, "001-a.md", SESSION_B);

    expect(first).toEqual({ outcome: "claimed" });
    // The loser's call returns a normal value — never throws EEXIST up to the caller.
    expect(second.outcome).toBe("already-claimed");
    if (second.outcome === "already-claimed") {
      expect(second.claim.sessionId).toBe(SESSION_A);
      expect(second.claim.live).toBe(true);
    }

    // Only one claim file exists, and it is A's.
    const onDisk = readClaimFile(claimPathFor(tasksDir, "001-a.md"));
    expect(onDisk.session_id).toBe(SESSION_A);
  });

  it("racing three sessions for one task still yields exactly one winner", () => {
    makeSession(SESSION_A);
    const sessions = [SESSION_A, SESSION_B, "sess-ccc-333"];
    const results = sessions.map((id) => claimTask(projectRoot, tasksDir, "001-a.md", id));
    const winners = results.filter((r) => r.outcome === "claimed");
    expect(winners).toHaveLength(1);
    // Every loser names the same winner.
    const winnerId = readClaimFile(claimPathFor(tasksDir, "001-a.md")).session_id;
    for (const r of results) {
      if (r.outcome === "already-claimed") expect(r.claim.sessionId).toBe(winnerId);
    }
  });

  it("reaps a dead claim (missing session directory) before attempting the create, so a fresh session wins", () => {
    // SESSION_A "claimed" it and then its SessionEnd deleted the directory — no reap has happened yet.
    ensureClaimsDir(tasksDir);
    fs.writeFileSync(
      claimPathFor(tasksDir, "001-a.md"),
      JSON.stringify({ session_id: SESSION_A, claimed_at: new Date().toISOString(), project_root: projectRoot })
    );

    const result = claimTask(projectRoot, tasksDir, "001-a.md", SESSION_B);
    expect(result).toEqual({ outcome: "claimed" });
    expect(readClaimFile(claimPathFor(tasksDir, "001-a.md")).session_id).toBe(SESSION_B);
  });

  it("reaps a dead claim (stale log mtime) before attempting the create", () => {
    const now = Date.now();
    makeSession(SESSION_A, new Date(now - CLAIM_IDLE_CAP_MS - 60_000));
    ensureClaimsDir(tasksDir);
    fs.writeFileSync(
      claimPathFor(tasksDir, "001-a.md"),
      JSON.stringify({ session_id: SESSION_A, claimed_at: new Date(now).toISOString(), project_root: projectRoot })
    );

    const result = claimTask(projectRoot, tasksDir, "001-a.md", SESSION_B, now);
    expect(result).toEqual({ outcome: "claimed" });
    expect(readClaimFile(claimPathFor(tasksDir, "001-a.md")).session_id).toBe(SESSION_B);
  });

  it("does not reclaim a live claim held by another session", () => {
    makeSession(SESSION_A);
    claimTask(projectRoot, tasksDir, "001-a.md", SESSION_A);
    const attempt = claimTask(projectRoot, tasksDir, "001-a.md", SESSION_B);
    expect(attempt.outcome).toBe("already-claimed");
    expect(readClaimFile(claimPathFor(tasksDir, "001-a.md")).session_id).toBe(SESSION_A);
  });

  it("re-claiming the same task with the same session id is idempotent (its own live claim)", () => {
    makeSession(SESSION_A);
    const first = claimTask(projectRoot, tasksDir, "001-a.md", SESSION_A);
    const again = claimTask(projectRoot, tasksDir, "001-a.md", SESSION_A);
    expect(first).toEqual({ outcome: "claimed" });
    expect(again.outcome).toBe("already-claimed");
    if (again.outcome === "already-claimed") expect(again.claim.sessionId).toBe(SESSION_A);
  });
});

// ── release ───────────────────────────────────────────────────────────────

describe("releaseTask — refuses a foreign claim (066)", () => {
  it("leaves a claim held by a different session in place, untouched", () => {
    ensureClaimsDir(tasksDir);
    const filePath = claimPathFor(tasksDir, "001-a.md");
    const payload = { session_id: SESSION_A, claimed_at: new Date().toISOString(), project_root: projectRoot };
    fs.writeFileSync(filePath, JSON.stringify(payload));

    const result = releaseTask(tasksDir, "001-a.md", SESSION_B);

    expect(result).toBe("not-owner");
    expect(fs.existsSync(filePath)).toBe(true);
    expect(readClaimFile(filePath)).toEqual(payload); // byte-for-byte unchanged
  });

  it("removes the claim when the calling session id matches", () => {
    ensureClaimsDir(tasksDir);
    const filePath = claimPathFor(tasksDir, "001-a.md");
    fs.writeFileSync(
      filePath,
      JSON.stringify({ session_id: SESSION_A, claimed_at: new Date().toISOString(), project_root: projectRoot })
    );

    const result = releaseTask(tasksDir, "001-a.md", SESSION_A);

    expect(result).toBe("released");
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("reports 'no-claim' rather than 'released' or an error when nothing is claimed", () => {
    expect(releaseTask(tasksDir, "001-a.md", SESSION_A)).toBe("no-claim");
  });

  it("refuses a foreign claim even when that claim is dead — release never reaps", () => {
    // releaseTask trusts only ownership, not liveness — a dead FOREIGN claim is still not this
    // session's to remove; readClaims (not release) is what reaps dead claims.
    ensureClaimsDir(tasksDir);
    const filePath = claimPathFor(tasksDir, "001-a.md");
    fs.writeFileSync(
      filePath,
      JSON.stringify({ session_id: SESSION_A, claimed_at: new Date(0).toISOString(), project_root: projectRoot })
    );
    expect(releaseTask(tasksDir, "001-a.md", SESSION_B)).toBe("not-owner");
    expect(fs.existsSync(filePath)).toBe(true);
  });
});

describe("deleteClaimIfAny — unconditional (066)", () => {
  it("removes a claim regardless of which session holds it", () => {
    ensureClaimsDir(tasksDir);
    const filePath = claimPathFor(tasksDir, "001-a.md");
    fs.writeFileSync(
      filePath,
      JSON.stringify({ session_id: SESSION_A, claimed_at: new Date().toISOString(), project_root: projectRoot })
    );
    deleteClaimIfAny(tasksDir, "001-a.md");
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("is a silent no-op when there is nothing to delete", () => {
    expect(() => deleteClaimIfAny(tasksDir, "001-a.md")).not.toThrow();
  });
});

describe("ensureClaimsDir (066)", () => {
  it("creates the claims dir with a '*' .gitignore, mirroring ensureSessionsRoot", () => {
    const dir = ensureClaimsDir(tasksDir);
    expect(dir).toBe(claimsDirFor(tasksDir));
    expect(fs.readFileSync(path.join(dir, ".gitignore"), "utf8")).toBe("*\n");
  });

  it("does not clobber an existing .gitignore on a second call", () => {
    const dir = ensureClaimsDir(tasksDir);
    fs.writeFileSync(path.join(dir, ".gitignore"), "custom\n");
    ensureClaimsDir(tasksDir);
    expect(fs.readFileSync(path.join(dir, ".gitignore"), "utf8")).toBe("custom\n");
  });
});
