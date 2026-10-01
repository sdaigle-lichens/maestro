// The decisions behind the session-sweep / delete / title IPC handlers (`070`), pulled out of
// src/main/ipc.ts so they are testable without Electron. Framework-free: no Electron, no React.
// ipc.ts supplies the project state and the retarget side effect; everything decided lives here.

import { dedupeProjectRoots } from "./session-log.js";
import {
  deleteSession,
  sweepStaleSessions,
  type DeleteSessionResult,
  type SessionRef,
  type SessionSweepOptions,
} from "./session-sweep.js";
import { resolveSessionTitles, sessionTitleKey } from "./session-title.js";

/** The slice of the main-process project state that decides which roots may be read. */
export interface ProjectRootsState {
  current: { root: string } | null;
  recent: Array<{ root: string }>;
}

/** The open project plus every recent one, deduped by real path. */
export function composeAllowedRoots(state: ProjectRootsState): string[] {
  const roots = state.current
    ? [state.current.root, ...state.recent.map((r) => r.root)]
    : state.recent.map((r) => r.root);
  return dedupeProjectRoots(roots);
}

/**
 * Titles for the asked-for sessions. Malformed refs are dropped; refs outside `allowedRoots` are
 * never resolved but still present, as `null`, so every asked-for key is in the result.
 */
export function titlesForRefs(
  allowedRoots: string[],
  list: unknown,
  env?: Record<string, string | undefined>
): Record<string, string | null> {
  const allowed = new Set(allowedRoots);
  const asked: SessionRef[] = [];
  const known: SessionRef[] = [];
  if (Array.isArray(list)) {
    for (const r of list) {
      if (!r || typeof r.projectRoot !== "string" || typeof r.sessionId !== "string") continue;
      asked.push(r);
      if (allowed.has(r.projectRoot)) known.push(r);
    }
  }
  const out: Record<string, string | null> = {};
  for (const r of asked) out[sessionTitleKey(r.projectRoot, r.sessionId)] = null;
  return Object.assign(out, env ? resolveSessionTitles(known, env) : resolveSessionTitles(known));
}

/** Sweep abandoned sessions; `retarget` runs once, and only when something was removed. */
export function sweepAndRetarget(allowedRoots: string[], retarget: () => void, options?: SessionSweepOptions): number {
  const { count } = sweepStaleSessions(allowedRoots, options);
  if (count > 0) retarget();
  return count;
}

/** Delete one session; `retarget` runs once, and only when it was actually removed. */
export function deleteAndRetarget(
  allowedRoots: string[],
  projectRoot: string,
  sessionId: string,
  retarget: () => void,
  options?: SessionSweepOptions
): DeleteSessionResult {
  const res = deleteSession(allowedRoots, projectRoot, sessionId, options);
  if (res.removed) retarget();
  return res;
}
