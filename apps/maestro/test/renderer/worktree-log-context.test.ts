// `075`. The worktree-tab fold is pure, so (like `session-log-context.test.ts`) it is tested
// without a DOM: what a listing, a main-log reset and a project switch do to the tabs.

import { describe, it, expect } from "vitest";
import {
  reduceWorktreeTabs,
  worktreeLabel,
  type WorktreeTabsState,
} from "../../src/renderer/src/utils/worktree-log-context.js";
import type { WorktreeTabInfo } from "../../src/shared/ipc.js";

const info = (path: string, hasLog: boolean, branch: string | null = "b"): WorktreeTabInfo => ({
  path,
  branch,
  head: null,
  detached: false,
  locked: false,
  prunable: false,
  hasLog,
});
const entry = { ts: "2026-01-01T00:00:00.000Z", origin: "x", log: "l" };

describe("reduceWorktreeTabs", () => {
  it("lists a tab only for worktrees that have a log", () => {
    const s = reduceWorktreeTabs(new Map(), { type: "listed", infos: [info("/w1", true), info("/w2", false)] });
    expect([...s.keys()]).toEqual(["/w1"]);
    expect(s.get("/w1")?.state).toBe("pending");
  });

  it("keeps each tab's sessions separate", () => {
    let s: WorktreeTabsState = reduceWorktreeTabs(new Map(), {
      type: "listed",
      infos: [info("/w1", true), info("/w2", true)],
    });
    s = reduceWorktreeTabs(s, { type: "init", root: "/w1", sessionId: "a", entries: [entry] });
    s = reduceWorktreeTabs(s, { type: "init", root: "/w2", sessionId: "b", entries: [] });
    s = reduceWorktreeTabs(s, { type: "entry", root: "/w2", sessionId: "b", entry });
    expect(s.get("/w1")?.sessions.size).toBe(1);
    expect([...s.get("/w2")!.sessions.values()][0].entries).toHaveLength(1);
    expect([...s.get("/w1")!.sessions.values()][0].projectRoot).toBe("/w1");
  });

  it("a later listing for another project never drops an already tracked tab or its sessions", () => {
    let s = reduceWorktreeTabs(new Map(), { type: "listed", infos: [info("/w1", true)] });
    s = reduceWorktreeTabs(s, { type: "init", root: "/w1", sessionId: "a", entries: [entry] });
    s = reduceWorktreeTabs(s, { type: "listed", infos: [] }); // project switched, new project has none
    expect(s.get("/w1")?.sessions.size).toBe(1);
  });

  it("keeps a tracked tab when its log disappears from the listing flag", () => {
    let s = reduceWorktreeTabs(new Map(), { type: "listed", infos: [info("/w1", true)] });
    s = reduceWorktreeTabs(s, { type: "listed", infos: [info("/w1", false)] });
    expect(s.has("/w1")).toBe(true);
  });

  it("applies state and keeps removed visible until closed", () => {
    let s = reduceWorktreeTabs(new Map(), { type: "listed", infos: [info("/w1", true)] });
    s = reduceWorktreeTabs(s, { type: "state", root: "/w1", state: "removed" });
    expect(s.get("/w1")?.state).toBe("removed");
    s = reduceWorktreeTabs(s, { type: "closed", root: "/w1" });
    expect(s.size).toBe(0);
  });

  it("drops a tab whose open was rejected, but not one already open", () => {
    let s = reduceWorktreeTabs(new Map(), { type: "listed", infos: [info("/w1", true), info("/w2", true)] });
    s = reduceWorktreeTabs(s, { type: "state", root: "/w2", state: "live" });
    s = reduceWorktreeTabs(s, { type: "open-failed", root: "/w1" });
    s = reduceWorktreeTabs(s, { type: "open-failed", root: "/w2" });
    expect([...s.keys()]).toEqual(["/w2"]);
  });

  it("ignores events for unknown tabs", () => {
    const s: WorktreeTabsState = new Map();
    expect(reduceWorktreeTabs(s, { type: "entry", root: "/nope", sessionId: "a", entry })).toBe(s);
  });
});

describe("worktreeLabel", () => {
  it("prefers the branch, then the directory name, marking detached", () => {
    expect(worktreeLabel({ path: "/a/wt", branch: "feat/x", detached: false })).toBe("feat/x");
    expect(worktreeLabel({ path: "/a/wt/", branch: null, detached: true })).toBe("wt (detached)");
  });
});
