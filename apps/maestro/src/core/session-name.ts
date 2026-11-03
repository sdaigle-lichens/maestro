// A deterministic name for every Maestro session (`113`), applied as the session title by hooks.
//
// Manager and worker sessions find each other by NAME (ListAgents / SendMessage), and the epic and
// task claims record those names. An auto-generated name changes when a session is stopped and
// restarted, so a recorded name went stale and the user had to redirect messages by hand. The name
// is now derived from the session id, which `claude --resume` keeps:
//
//   worker   maestro-<id8>        (the first /maestro entrance)
//   manager  maestro-mgr-<id8>    (the first /maestro-manager entrance)
//
// `id8` is the first eight characters of the session id. No epic slug: it is not known at entry,
// and renaming later would re-stale every name already recorded.
//
// Where it is kept and who applies it:
//
//   - `noteEntrance` records the name in the session's own session.json. The FIRST entrance wins and
//     is never overwritten, so a session that ran /maestro and then /maestro-manager keeps one name.
//   - `titleFor` is what the hooks emit as `hookSpecificOutput.sessionTitle` (same effect as
//     /rename). Only SessionStart and UserPromptSubmit outputs accept that field, so the
//     UserPromptExpansion and PreToolUse(Skill) entrances only record; the next UserPromptSubmit
//     applies it once, and every SessionStart re-applies it. When a final SessionEnd swept the
//     session directory, SessionStart re-derives the name from the claim (keyed by session id) or the
//     epic (`maestro[-mgr]-<id8>` as manager or worker) that recorded it.
//   - A custom title the user set (`--name`, `/rename`) arrives as the payload's `session_title`. It
//     is respected: recorded as the name instead, and never overwritten by a hook.
//   - `storedName` is what the epic and claim CLIs record in preference to a passed-in name.
//
// No session id, an invalid one, or no `.claude/maestro.json` means nothing happens at all: the
// hooks fire in every project the plugin is enabled in, and a non-Maestro project must not grow a
// `maestro_sessions/` directory. `fs`/`path` only — this ships inside maestro-session.cjs, which
// must stay free of `node:sqlite`.

import fs from "node:fs";
import path from "node:path";

import type { MaestroSession, SessionNameRole } from "./types.js";
import { claimsDirFor } from "./claims.js";
import { readJson, writeSession } from "./session-runtime.js";
import { ensureSessionPaths, isValidSessionId, resolveSessionId, sessionPathsFor } from "./session-paths.js";
import { mainCheckoutRoot } from "./worktree.js";

export type { SessionNameRole } from "./types.js";

/** The hook payload fields `titleFor` reads. Every field is optional and untrusted. */
export interface SessionNamePayload {
  hook_event_name?: unknown;
  session_id?: unknown;
  /** The session's custom title, present on SessionStart / UserPromptSubmit when one is set. */
  session_title?: unknown;
  /** SessionStart: startup | resume | clear | compact | fork. */
  source?: unknown;
  /** UserPromptSubmit: the submitted prompt text. */
  prompt?: unknown;
}

/** What a session's session.json says about its name, or null when it records none. */
export interface StoredSessionName {
  name: string;
  role: SessionNameRole | null;
  custom: boolean;
  applied: boolean;
}

const MANAGER_PREFIX = "maestro-mgr-";
const WORKER_PREFIX = "maestro-";

/** `maestro-<id8>` for a worker, `maestro-mgr-<id8>` for a manager. Null for an invalid session id. */
export function sessionNameFor(sessionId: unknown, role: SessionNameRole): string | null {
  if (!isValidSessionId(sessionId)) return null;
  const id8 = sessionId.slice(0, 8);
  return `${role === "manager" ? MANAGER_PREFIX : WORKER_PREFIX}${id8}`;
}

/**
 * The role a skill or command name enters as, or null when it is neither entrance. Tolerant of a
 * leading `/` and a plugin namespace (`maestro:maestro-manager`), then an exact match — the same
 * tolerance the other entrance hooks use for their command names.
 */
export function entranceRoleFor(name: unknown): SessionNameRole | null {
  if (typeof name !== "string") return null;
  const bare = name.trim().replace(/^\//, "").split(":").pop() ?? "";
  if (bare === "maestro") return "worker";
  if (bare === "maestro-manager") return "manager";
  return null;
}

/**
 * The entrance a typed prompt starts with (`/maestro ...`, `/maestro-manager ...`), or null. Needed
 * because UserPromptSubmit fires BEFORE the UserPromptExpansion of the same prompt: without it the
 * first prompt of a typed `/maestro` would find no name recorded yet and apply nothing.
 */
export function promptEntranceRole(prompt: unknown): SessionNameRole | null {
  if (typeof prompt !== "string") return null;
  const first = prompt.trimStart().split(/\s/, 1)[0] ?? "";
  return first.startsWith("/") ? entranceRoleFor(first) : null;
}

function hasMaestroConfig(claudeDir: string): boolean {
  try {
    return fs.statSync(path.join(claudeDir, "maestro.json")).isFile();
  } catch {
    return false;
  }
}

function readState(statePath: string): Partial<MaestroSession> {
  const data = readJson<Partial<MaestroSession>>(statePath);
  return data && typeof data === "object" && !Array.isArray(data) ? data : {};
}

function storedFrom(state: Partial<MaestroSession>): StoredSessionName | null {
  const name = typeof state.session_name === "string" ? state.session_name.trim() : "";
  if (!name) return null;
  const role =
    state.session_name_role === "manager" || state.session_name_role === "worker" ? state.session_name_role : null;
  return { name, role, custom: state.session_name_custom === true, applied: state.session_name_applied === true };
}

/** Merge `patch` into the session's session.json, creating the directory if needed. */
function patchState(claudeDir: string, sessionId: string, patch: Partial<MaestroSession>): void {
  const paths = ensureSessionPaths(claudeDir, { session_id: sessionId });
  if (!paths) return;
  const state = readState(paths.state);
  writeSession(paths.state, { ...state, ...patch } as MaestroSession);
}

/** The full name record in `sessionId`'s session.json, or null when none is recorded. */
export function storedSessionName(claudeDir: string, sessionId: unknown): StoredSessionName | null {
  const paths = sessionPathsFor(claudeDir, sessionId);
  if (!paths) return null;
  return storedFrom(readState(paths.state));
}

/** The name recorded in `sessionId`'s session.json, or null. What the epic and claim CLIs prefer. */
export function storedName(claudeDir: string, sessionId: unknown): string | null {
  return storedSessionName(claudeDir, sessionId)?.name ?? null;
}

/**
 * Record `role`'s derived name for this session, unless a name is already recorded (the first
 * entrance wins, and a custom title recorded earlier is kept). Returns the session's name after the
 * call, or null when nothing applies (invalid id, no maestro.json).
 */
export function noteEntrance(claudeDir: string, sessionId: unknown, role: SessionNameRole): string | null {
  if (!isValidSessionId(sessionId) || !hasMaestroConfig(claudeDir)) return null;
  const existing = storedName(claudeDir, sessionId);
  if (existing) return existing;
  const name = sessionNameFor(sessionId, role);
  if (!name) return null;
  patchState(claudeDir, sessionId, { session_name: name, session_name_role: role, session_name_applied: false });
  return name;
}

function listJson(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}

function listDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function roleOfName(name: string): SessionNameRole {
  return name.startsWith(MANAGER_PREFIX) ? "manager" : "worker";
}

/**
 * The name this session was recorded under before its directory was swept, or null. Looked up in
 * the main checkout's queue and epics, in this order:
 *
 *   1. a task claim held by this session id that recorded a `session_name` (covers a custom name);
 *   2. an epic whose manager is `maestro-mgr-<id8>`;
 *   3. an epic with a worker named `maestro-<id8>`.
 */
export function rederiveSessionName(
  claudeDir: string,
  sessionId: unknown
): { name: string; role: SessionNameRole } | null {
  if (!isValidSessionId(sessionId)) return null;
  const root = mainCheckoutRoot(path.dirname(claudeDir));

  const claims = claimsDirFor(path.join(root, ".claude", "maestro-tasks"));
  for (const file of listJson(claims)) {
    const claim = readJson<{ session_id?: unknown; session_name?: unknown }>(path.join(claims, file));
    if (!claim || claim.session_id !== sessionId) continue;
    if (typeof claim.session_name === "string" && claim.session_name.trim()) {
      const name = claim.session_name.trim();
      return { name, role: roleOfName(name) };
    }
  }

  const manager = sessionNameFor(sessionId, "manager");
  const worker = sessionNameFor(sessionId, "worker");
  const epicsRoot = path.join(root, ".claude", "epics");
  let asWorker: string | null = null;
  for (const slug of listDirs(epicsRoot)) {
    const state = readJson<{ manager?: { name?: unknown } | null; workers?: unknown }>(
      path.join(epicsRoot, slug, "state.json")
    );
    if (!state) continue;
    if (manager && state.manager?.name === manager) return { name: manager, role: "manager" };
    const workers = Array.isArray(state.workers) ? (state.workers as { name?: unknown }[]) : [];
    if (worker && workers.some((w) => w && w.name === worker)) asWorker = worker;
  }
  return asWorker ? { name: asWorker, role: "worker" } : null;
}

function customTitleOf(payload: SessionNamePayload): string | null {
  return typeof payload.session_title === "string" && payload.session_title.trim()
    ? payload.session_title.trim()
    : null;
}

/**
 * The `sessionTitle` a SessionStart or UserPromptSubmit hook should emit, or null for none. Records
 * as a side effect: a custom title as the name, the applied flag, and a re-derived name.
 *
 *   - Not a Maestro session (no name recorded, nothing to re-derive): null, nothing written.
 *   - A custom `session_title` that differs from the recorded name: recorded as the name; null.
 *   - UserPromptSubmit: the recorded name, the first time only.
 *   - SessionStart: the recorded name every time; with no name recorded, the re-derived one.
 */
export function titleFor(claudeDir: string, payload: SessionNamePayload | null | undefined): string | null {
  if (!payload || typeof payload !== "object") return null;
  const event = payload.hook_event_name;
  if (event !== "SessionStart" && event !== "UserPromptSubmit") return null;
  const sessionId = resolveSessionId(payload);
  if (!sessionId || !hasMaestroConfig(claudeDir)) return null;

  const custom = customTitleOf(payload);
  const stored = storedSessionName(claudeDir, sessionId);

  if (!stored && event === "SessionStart") {
    const found = rederiveSessionName(claudeDir, sessionId);
    if (!found) return null;
    if (custom) {
      patchState(claudeDir, sessionId, {
        session_name: custom,
        session_name_role: found.role,
        session_name_custom: custom !== found.name,
        session_name_applied: true,
      });
      return null;
    }
    patchState(claudeDir, sessionId, {
      session_name: found.name,
      session_name_role: found.role,
      session_name_applied: true,
    });
    return found.name;
  }
  if (!stored) return null;

  if (custom && custom !== stored.name) {
    patchState(claudeDir, sessionId, { session_name: custom, session_name_custom: true, session_name_applied: true });
    return null;
  }
  if (custom === stored.name) {
    // Already the title: nothing to emit. Mark it applied so UserPromptSubmit stops trying.
    if (!stored.applied) patchState(claudeDir, sessionId, { session_name_applied: true });
    return null;
  }

  // UserPromptSubmit applies it once; SessionStart re-applies it every time.
  if (event === "UserPromptSubmit" && stored.applied) return null;
  if (!stored.applied) patchState(claudeDir, sessionId, { session_name_applied: true });
  return stored.name;
}
