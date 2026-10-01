import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { reduceSessionLog, type SessionRecord } from "./session-log-context";
import type { SessionLogEntry } from "./maestro-session-log";
import type { WorktreeTabInfo, WorktreeTabState } from "../../../shared/ipc";

/**
 * `075`. Session Log tabs for the linked worktrees of the open project. Entirely separate from the
 * app-wide `log.subscribe` stream (`SessionLogProvider`): that stream wipes itself on `onReset`
 * and retargets with the open project, a worktree tab must do neither. So a tab's records live
 * here and are only dropped by an explicit close or an unrecoverable open failure, never by a
 * project switch or a main-log reset.
 */
export interface WorktreeTab {
  /** Absolute worktree root. Tab id and the `projectRoot` of its sessions. */
  path: string;
  branch: string | null;
  detached: boolean;
  /** "pending" until `open` answers. */
  state: WorktreeTabState | "pending";
  /** This worktree's own sessions, folded with the same reducer as the main log. */
  sessions: Map<string, SessionRecord>;
}

export type WorktreeTabsState = Map<string, WorktreeTab>;

export type WorktreeTabsEvent =
  | { type: "listed"; infos: WorktreeTabInfo[] }
  | { type: "state"; root: string; state: WorktreeTabState }
  | { type: "init"; root: string; sessionId: string; entries: SessionLogEntry[] }
  | { type: "entry"; root: string; sessionId: string; entry: SessionLogEntry }
  | { type: "end"; root: string; sessionId: string }
  | { type: "open-failed"; root: string }
  | { type: "closed"; root: string };

/** Label for a tab: branch, else a short detached marker, else the directory name. */
export function worktreeLabel(t: Pick<WorktreeTab, "path" | "branch" | "detached">): string {
  if (t.branch) return t.branch;
  const base = t.path.split(/[\\/]/).filter(Boolean).pop() ?? t.path;
  return t.detached ? `${base} (detached)` : base;
}

/**
 * Pure fold of one worktree-tab event. A listing adds tabs only for worktrees that have a log and
 * NEVER removes an already tracked tab: after a project switch the list describes the new project,
 * but a tab opened earlier is still streaming and must stay. Only `closed` / `open-failed` remove.
 */
export function reduceWorktreeTabs(prev: WorktreeTabsState, event: WorktreeTabsEvent): WorktreeTabsState {
  switch (event.type) {
    case "listed": {
      let next: WorktreeTabsState | null = null;
      for (const info of event.infos) {
        const existing = prev.get(info.path);
        if (!existing && !info.hasLog) continue;
        next ??= new Map(prev);
        next.set(info.path, {
          path: info.path,
          branch: info.branch,
          detached: info.detached,
          state: existing?.state ?? "pending",
          sessions: existing?.sessions ?? new Map(),
        });
      }
      return next ?? prev;
    }
    case "state": {
      const t = prev.get(event.root);
      if (!t || t.state === event.state) return prev;
      return new Map(prev).set(event.root, { ...t, state: event.state });
    }
    case "init":
    case "entry":
    case "end": {
      const t = prev.get(event.root);
      if (!t) return prev;
      const { root, ...rest } = event;
      const sessions = reduceSessionLog(t.sessions, { ...rest, projectRoot: root });
      if (sessions === t.sessions) return prev;
      return new Map(prev).set(root, { ...t, sessions });
    }
    case "open-failed": {
      const t = prev.get(event.root);
      // A tab that never opened has nothing to show and no fallback: drop it.
      if (!t || t.state !== "pending") return prev;
      const next = new Map(prev);
      next.delete(event.root);
      return next;
    }
    case "closed": {
      if (!prev.has(event.root)) return prev;
      const next = new Map(prev);
      next.delete(event.root);
      return next;
    }
  }
}

interface WorktreeLogContextValue {
  tabs: WorktreeTab[];
  /** Stop the tail and drop the tab (offered for removed worktrees). */
  close(path: string): void;
}

const WorktreeLogContext = createContext<WorktreeLogContextValue>({ tabs: [], close: () => {} });

const POLL_MS = 7000;

export function WorktreeLogProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reduceWorktreeTabs, new Map<string, WorktreeTab>());
  /** Roots with an `open` call issued; keeps polling from re-opening, and a close from being re-added mid-flight. */
  const opened = useRef(new Set<string>());

  useEffect(() => {
    // Subscribe BEFORE any open: init events are sent synchronously during `open`.
    const unsubscribe = window.maestro.worktreeLog.subscribe({
      onState: ({ root, state }) => dispatch({ type: "state", root, state }),
      onInit: ({ projectRoot, sessionId, entries }) =>
        dispatch({ type: "init", root: projectRoot, sessionId, entries }),
      onEntry: ({ projectRoot, sessionId, entry }) => dispatch({ type: "entry", root: projectRoot, sessionId, entry }),
      onEnd: ({ projectRoot, sessionId }) => dispatch({ type: "end", root: projectRoot, sessionId }),
    });

    let cancelled = false;
    const refresh = async (): Promise<void> => {
      let infos: WorktreeTabInfo[];
      try {
        infos = await window.maestro.worktreeLog.list();
      } catch {
        return; // a failed listing keeps the tabs we have
      }
      if (cancelled) return;
      dispatch({ type: "listed", infos });
      // Forget roots git no longer lists so a worktree re-added at the same path opens again. A
      // closed-but-still-listed root stays in the set (see `close`), so it is not re-added.
      const listed = new Set(infos.map((i) => i.path));
      for (const p of [...opened.current]) if (!listed.has(p)) opened.current.delete(p);
      for (const info of infos) {
        if (!info.hasLog || opened.current.has(info.path)) continue;
        opened.current.add(info.path);
        try {
          const res = await window.maestro.worktreeLog.open(info.path);
          if (cancelled) return;
          if (res.ok) {
            dispatch({ type: "state", root: res.root, state: res.state });
          } else {
            opened.current.delete(info.path);
            dispatch({ type: "open-failed", root: info.path });
          }
        } catch {
          opened.current.delete(info.path);
          dispatch({ type: "open-failed", root: info.path });
        }
      }
    };

    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    const offProject = window.maestro.project.onChanged(() => void refresh());
    return () => {
      cancelled = true;
      clearInterval(timer);
      offProject();
      unsubscribe();
    };
  }, []);

  const value = useMemo<WorktreeLogContextValue>(
    () => ({
      tabs: [...state.values()].sort((a, b) => a.path.localeCompare(b.path)),
      close: (path: string) => {
        opened.current.add(path); // do not re-open a worktree the user closed while it is still listed
        void window.maestro.worktreeLog.close(path).catch(() => {});
        dispatch({ type: "closed", root: path });
      },
    }),
    [state]
  );

  return <WorktreeLogContext.Provider value={value}>{children}</WorktreeLogContext.Provider>;
}

export function useWorktreeLog(): WorktreeLogContextValue {
  return useContext(WorktreeLogContext);
}
