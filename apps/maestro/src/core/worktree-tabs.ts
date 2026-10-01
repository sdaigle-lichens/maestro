// `075`: one session-log tail per (window, worktree tab), framework-free.
//
// A tab is opened for a worktree root that `resolveWorktreeRoot` accepted. Once open it OWNS its
// root: the open project changing does not touch it (a worktree tab is not following the open
// project). It reads only `<root>/.claude/maestro_sessions/*/log.jsonl`, never the main checkout's,
// so a tab can only ever show its own worktree's sessions. The tab degrades visibly instead of
// falling back: `removed` when the worktree is gone, `no-log` when it exists with no session log.

import fs from "node:fs";
import path from "node:path";
import { tailSessionLogs } from "./session-log.js";
import { linkedWorktrees, listWorktrees, samePath, resolveWorktreeRoot, type WorktreeLister } from "./worktree-list.js";
import { listSessionIds, sessionPathsFor } from "./session-paths.js";
import type { SessionLogEntry, WorktreeOpenResult, WorktreeTabInfo, WorktreeTabState } from "./contracts.js";

export type { WorktreeTabState };

/** True when `root` has at least one session log of its own. */
export function worktreeHasLog(root: string): boolean {
  const claudeDir = path.join(root, ".claude");
  return listSessionIds(claudeDir).some((id) => {
    const log = sessionPathsFor(claudeDir, id)?.log;
    return !!log && fs.existsSync(log);
  });
}

/** The linked worktrees of the open project with whether each has a log; `[]` with no project. */
export function describeWorktrees(openProject: string | null, list: WorktreeLister = listWorktrees): WorktreeTabInfo[] {
  if (!openProject) return [];
  return linkedWorktrees(openProject, list).map((w) => ({
    path: w.path,
    branch: w.branch,
    head: w.head,
    detached: w.detached,
    locked: w.locked,
    prunable: w.prunable,
    hasLog: !w.prunable && worktreeHasLog(w.path),
  }));
}

export interface WorktreeTabEvents {
  /** State of `root` changed (also emitted once on open). */
  state: (root: string, state: WorktreeTabState) => void;
  init: (root: string, sessionId: string, entries: SessionLogEntry[]) => void;
  entry: (root: string, sessionId: string, entry: SessionLogEntry) => void;
  end: (root: string, sessionId: string) => void;
}

export interface WorktreeTabsOptions {
  /** The currently open project root, read fresh at open time only. */
  getOpenProject: () => string | null;
  events: WorktreeTabEvents;
  list?: WorktreeLister;
  intervalMs?: number;
  /** How often (ms) git is asked whether a tab's worktree still exists. The directory check runs every tick. */
  gitCheckMs?: number;
}

interface Tab {
  /** The project that owned the worktree when the tab was opened; used only for the removed check. */
  owner: string;
  sessions: Set<string>;
  state: WorktreeTabState;
  removed: boolean;
  lastGitCheck: number;
  stopTail: () => void;
  timer: ReturnType<typeof setInterval>;
}

export interface WorktreeTabs {
  /** Open (idempotent) a tab for `requested`. A rejected path opens nothing. */
  open(requested: unknown): WorktreeOpenResult;
  close(root: string): void;
  closeAll(): void;
  /** Roots of the tabs currently open. */
  openRoots(): string[];
}

export function createWorktreeTabs(opts: WorktreeTabsOptions): WorktreeTabs {
  const list = opts.list ?? listWorktrees;
  const interval = opts.intervalMs ?? 1000;
  const gitCheckMs = opts.gitCheckMs ?? 5000;
  const tabs = new Map<string, Tab>();

  const stateOf = (t: Tab): WorktreeTabState => (t.removed ? "removed" : t.sessions.size > 0 ? "live" : "no-log");

  const refresh = (root: string, t: Tab): void => {
    const next = stateOf(t);
    if (next === t.state) return;
    t.state = next;
    opts.events.state(root, next);
  };

  const checkRemoved = (root: string, t: Tab): void => {
    if (t.removed) return;
    let gone = !fs.existsSync(root);
    const now = Date.now();
    if (!gone && now - t.lastGitCheck >= gitCheckMs) {
      t.lastGitCheck = now;
      const entries = list(t.owner);
      // An empty answer means git failed; ambiguous is not removed.
      if (entries.length > 0) gone = !entries.some((w) => !w.isMain && samePath(w.path, root));
    }
    if (gone) t.removed = true;
  };

  const api: WorktreeTabs = {
    open(requested) {
      const owner = opts.getOpenProject();
      const res = resolveWorktreeRoot(owner, requested, list);
      if (!res.ok) return { ok: false, reason: res.reason };
      const root = res.root;
      const existing = tabs.get(root);
      if (existing) return { ok: true, root, state: existing.state };

      const tab: Tab = {
        owner: owner as string,
        sessions: new Set(),
        state: "no-log",
        removed: false,
        lastGitCheck: Date.now(),
        stopTail: () => {},
        timer: undefined as unknown as ReturnType<typeof setInterval>,
      };
      tabs.set(root, tab);
      // Once removed the root list is empty, so the tail ends every session it was showing.
      tab.stopTail = tailSessionLogs(
        () => (tab.removed ? [] : [root]),
        {
          init: (_r, id, entries) => {
            tab.sessions.add(id);
            opts.events.init(root, id, entries);
            refresh(root, tab);
          },
          entry: (_r, id, entry) => opts.events.entry(root, id, entry),
          end: (_r, id) => {
            tab.sessions.delete(id);
            opts.events.end(root, id);
            refresh(root, tab);
          },
        },
        interval
      );
      tab.timer = setInterval(() => {
        checkRemoved(root, tab);
        refresh(root, tab);
      }, interval);
      tab.state = stateOf(tab);
      opts.events.state(root, tab.state);
      return { ok: true, root, state: tab.state };
    },
    close(root) {
      const t = tabs.get(root);
      if (!t) return;
      t.stopTail();
      clearInterval(t.timer);
      tabs.delete(root);
    },
    closeAll() {
      for (const r of [...tabs.keys()]) api.close(r);
    },
    openRoots: () => [...tabs.keys()],
  };
  return api;
}
