import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { SessionLogEntry } from "./maestro-session-log";

/**
 * `065`. One log-tail subscription (see `main/ipc.ts`'s `startTail`) now covers every LIVE session
 * across every project the app knows about (current + recent), not one flat log for one project.
 * A session is tracked here from the moment its `onInit` arrives until it is dropped — either by
 * this provider's own ended-tab cap, by the user closing it (`dismiss`), or by a wholesale
 * `onReset` (a project switch/forget always retargets the whole tail, so the old set is wiped and
 * rebuilt from a fresh burst of `onInit`s rather than trimmed session-by-session).
 */
export interface SessionRecord {
  projectRoot: string;
  sessionId: string;
  entries: SessionLogEntry[];
  status: "live" | "ended";
  /**
   * Wall-clock time this provider first learned about the session (its `onInit`). Used as the
   * tab-label fallback when the log is still empty and as the ended-tab eviction order.
   *
   * Not the same as the session directory's own creation time — nothing in the IPC contract
   * exposes that (see `SessionLogInitEvent`), so this is the closest available proxy on the
   * renderer side. Usually indistinguishable in practice: `tailSessionLogs` polls at most a second
   * behind the file appearing.
   */
  firstSeenAt: number;
  /** Set once, when `status` flips to "ended". Null while live. */
  endedAt: number | null;
}

/** Ended sessions kept around (greyed, entries intact) after their process stops — oldest first out. */
const MAX_RETAINED_ENDED = 3;

/** Composite identity for a session, stable across its whole life. */
export function sessionKey(s: Pick<SessionRecord, "projectRoot" | "sessionId">): string {
  return `${s.projectRoot}::${s.sessionId}`;
}

/** Earliest known moment for this session: its first entry's `ts`, else `firstSeenAt`. */
export function startedAt(s: SessionRecord): number {
  const first = s.entries[0];
  if (first) {
    const parsed = Date.parse(first.ts);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return s.firstSeenAt;
}

/** Most recent activity for this session: its last entry's `ts`, else `startedAt`. */
export function lastActivityAt(s: SessionRecord): number {
  const last = s.entries[s.entries.length - 1];
  if (last) {
    const parsed = Date.parse(last.ts);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return startedAt(s);
}

export type SessionLogTailEvent =
  | { type: "init"; projectRoot: string; sessionId: string; entries: SessionLogEntry[] }
  | { type: "entry"; projectRoot: string; sessionId: string; entry: SessionLogEntry }
  | { type: "end"; projectRoot: string; sessionId: string }
  | { type: "reset" };

/**
 * Pure fold of one tail event into the tracked-session map — the entire ended-tab retention/cap
 * and reset semantics, with no React and no IPC. Exported (and `pickSelection` below) so this
 * codebase's plain-node vitest setup (no DOM/component harness — see `test/renderer/`) can exercise
 * the `065` stateful rules directly: what a burst of init/entry/end/reset events produces, without
 * needing to render anything.
 */
export function reduceSessionLog(
  sessions: Map<string, SessionRecord>,
  event: SessionLogTailEvent,
  now: () => number = Date.now
): Map<string, SessionRecord> {
  switch (event.type) {
    case "reset":
      // Wholesale target change — see the `onReset` doc comment on the provider below.
      return new Map();

    case "init": {
      const key = sessionKey(event);
      const next = new Map(sessions);
      next.set(key, {
        projectRoot: event.projectRoot,
        sessionId: event.sessionId,
        entries: event.entries,
        status: "live",
        firstSeenAt: now(),
        endedAt: null,
      });
      return next;
    }

    case "entry": {
      const key = sessionKey(event);
      const existing = sessions.get(key);
      // An entry for a session we never saw `onInit` for shouldn't happen (the tail always inits
      // before it appends), but ignore defensively rather than fabricate a record.
      if (!existing) return sessions;
      const next = new Map(sessions);
      next.set(key, { ...existing, entries: [...existing.entries, event.entry], status: "live" });
      return next;
    }

    case "end": {
      const key = sessionKey(event);
      const existing = sessions.get(key);
      if (!existing) return sessions;
      const next = new Map(sessions);
      next.set(key, { ...existing, status: "ended", endedAt: now() });

      // Cap retained ended sessions globally (across every project), dropping the oldest first.
      const ended = [...next.values()].filter((s) => s.status === "ended");
      if (ended.length > MAX_RETAINED_ENDED) {
        ended
          .sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))
          .slice(0, ended.length - MAX_RETAINED_ENDED)
          .forEach((s) => next.delete(sessionKey(s)));
      }
      return next;
    }
  }
}

/**
 * Which session key should be selected, given the previous selection — the `065` stable-selection
 * rule as a pure function: a tab appearing, or the currently-selected tab ending, must never move
 * the selection away from it. Only re-picks when `currentKey` no longer names a tracked session
 * (evicted by the cap above, closed by the user, or wiped by a reset), preferring the most
 * recently active LIVE session and falling back to the most recently active session of any status
 * when none are live (there is no separate "all sessions ended" empty state — see `session-log.tsx`).
 */
export function pickSelection(sessions: SessionRecord[], currentKey: string | null): string | null {
  if (currentKey && sessions.some((s) => sessionKey(s) === currentKey)) return currentKey;
  const live = sessions.filter((s) => s.status === "live");
  const pool = live.length > 0 ? live : sessions;
  if (pool.length === 0) return null;
  return sessionKey(pool.reduce((best, s) => (lastActivityAt(s) > lastActivityAt(best) ? s : best)));
}

interface SessionLogContextValue {
  /** Every session this window currently knows about — live and retained-ended. Unordered; group/sort in the consumer. */
  sessions: SessionRecord[];
  connected: boolean;
  /** Drop a session's tab outright (used for the user closing an ended tab). No-op if already gone. */
  dismiss(projectRoot: string, sessionId: string): void;
}

const SessionLogContext = createContext<SessionLogContextValue>({
  sessions: [],
  connected: false,
  dismiss: () => {},
});

export function SessionLogProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<Map<string, SessionRecord>>(new Map());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // Every branch below just shapes the raw IPC payload into a `SessionLogTailEvent` and folds it
    // through the pure `reduceSessionLog` — see that function for the actual retention/cap/reset
    // rules (kept there, not here, so they're testable without React or IPC).
    const unsubscribe = window.maestro.log.subscribe({
      onInit: ({ projectRoot, sessionId, entries }) => {
        setSessions((prev) => reduceSessionLog(prev, { type: "init", projectRoot, sessionId, entries }));
      },
      onEntry: ({ projectRoot, sessionId, entry }) => {
        setSessions((prev) => reduceSessionLog(prev, { type: "entry", projectRoot, sessionId, entry }));
      },
      onEnd: ({ projectRoot, sessionId }) => {
        setSessions((prev) => reduceSessionLog(prev, { type: "end", projectRoot, sessionId }));
      },
      onReset: () => {
        // Wholesale target change (fresh subscribe, or a project opened/forgotten forced a
        // retarget) — drop everything and let the `onInit` burst that immediately follows
        // repopulate it. This is also how an ended tab is dropped when its project is forgotten:
        // the retarget wipes it here, and it is not among the sessions the following inits name.
        setSessions((prev) => reduceSessionLog(prev, { type: "reset" }));
        setConnected(true);
      },
    });
    return () => {
      unsubscribe();
      setConnected(false);
    };
  }, []);

  const dismiss = useMemo(
    () =>
      (projectRoot: string, sessionId: string): void => {
        const key = sessionKey({ projectRoot, sessionId });
        setSessions((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
      },
    []
  );

  const value = useMemo<SessionLogContextValue>(
    () => ({ sessions: [...sessions.values()], connected, dismiss }),
    [sessions, connected, dismiss]
  );

  return <SessionLogContext.Provider value={value}>{children}</SessionLogContext.Provider>;
}

export function useSessionLog(): SessionLogContextValue {
  return useContext(SessionLogContext);
}
