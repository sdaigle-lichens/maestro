// `075`: worktrees as Session Log viewing roots. Real git repos and real worktrees (made by hand
// with `git worktree add`, no Maestro involved) under os.tmpdir(); nothing mocked.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { parseWorktreeList, listWorktrees, resolveWorktreeRoot } from "../../src/core/worktree-list.js";
import { createWorktreeTabs, describeWorktrees, type WorktreeTabEvents } from "../../src/core/worktree-tabs.js";
import { tailSessionLogs } from "../../src/core/session-log.js";
import type { WorktreeTabState } from "../../src/core/contracts.js";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, "-c", "user.email=t@t", "-c", "user.name=t", ...args], { stdio: "ignore" });

const line = (log: string) => JSON.stringify({ ts: "2026-07-30T00:00:00Z", origin: "main", log });

function writeLog(root: string, id: string, ...logs: string[]) {
  const dir = path.join(root, ".claude", "maestro_sessions", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, "log.jsonl"), logs.map((l) => line(l) + "\n").join(""));
}

let tmp: string;
let main: string;
let wtA: string;
let wtB: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-wt-")));
  main = path.join(tmp, "repo");
  fs.mkdirSync(main);
  git(main, "init", "-q", "-b", "main");
  git(main, "commit", "-q", "--allow-empty", "-m", "init");
  wtA = path.join(tmp, "repo-a");
  wtB = path.join(tmp, "repo-b");
  git(main, "worktree", "add", "-q", "-b", "feat-a", wtA);
  git(main, "worktree", "add", "-q", "-b", "feat-b", wtB);
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("worktree list and viewing-root recognition", () => {
  it("parses porcelain output, main first", () => {
    const l = parseWorktreeList(
      "worktree /r\nHEAD abc\nbranch refs/heads/main\n\nworktree /r-a\nHEAD def\ndetached\nlocked\n\n"
    );
    expect(l.map((w) => [w.path, w.branch, w.isMain, w.detached, w.locked])).toEqual([
      ["/r", "main", true, false, false],
      ["/r-a", null, false, true, true],
    ]);
  });

  it("lists hand-made worktrees and accepts exactly those as viewing roots", () => {
    expect(listWorktrees(main).length).toBe(3);
    const ok = resolveWorktreeRoot(main, wtA);
    expect(ok.ok && ok.root).toBe(wtA);
    expect(resolveWorktreeRoot(main, wtB).ok).toBe(true);
  });

  it("rejects the main checkout, outside paths, relative paths, non-strings and no project", () => {
    const outside = path.join(tmp, "elsewhere");
    fs.mkdirSync(outside);
    for (const bad of [main, outside, "repo-a", 42, undefined]) {
      expect(resolveWorktreeRoot(main, bad)).toEqual({ ok: false, reason: "not-a-worktree" });
    }
    expect(resolveWorktreeRoot(null, wtA)).toEqual({ ok: false, reason: "no-project" });
  });

  it("rejects a worktree of a DIFFERENT repository", () => {
    const other = path.join(tmp, "other");
    fs.mkdirSync(other);
    git(other, "init", "-q", "-b", "main");
    git(other, "commit", "-q", "--allow-empty", "-m", "init");
    const otherWt = path.join(tmp, "other-wt");
    git(other, "worktree", "add", "-q", "-b", "x", otherWt);
    expect(resolveWorktreeRoot(main, otherWt).ok).toBe(false);
  });

  it("describeWorktrees reports hasLog per worktree and excludes the main checkout", () => {
    writeLog(wtA, "sess-aaa-111", "hi");
    const d = describeWorktrees(main);
    expect(d.map((w) => [w.path, w.hasLog, w.branch])).toEqual([
      [wtA, true, "feat-a"],
      [wtB, false, "feat-b"],
    ]);
    expect(describeWorktrees(null)).toEqual([]);
  });
});

function harness(getOpen: () => string | null) {
  const log: string[] = [];
  const states: Array<[string, WorktreeTabState]> = [];
  const events: WorktreeTabEvents = {
    state: (r, s) => states.push([r, s]),
    init: (r, id, e) => log.push(`init ${path.basename(r)} ${id} ${e.length}`),
    entry: (r, id, e) => log.push(`entry ${path.basename(r)} ${id} ${e.log}`),
    end: (r, id) => log.push(`end ${path.basename(r)} ${id}`),
  };
  return { log, states, tabs: createWorktreeTabs({ getOpenProject: getOpen, events, gitCheckMs: 0 }) };
}

describe("one tail per worktree tab", () => {
  it("each tab shows only its own session and updates live", () => {
    vi.useFakeTimers();
    writeLog(main, "sess-main-000", "main-line");
    writeLog(wtA, "sess-aaa-111", "a1");
    writeLog(wtB, "sess-bbb-222", "b1");
    const h = harness(() => main);
    expect(h.tabs.open(wtA)).toEqual({ ok: true, root: wtA, state: "live" });
    expect(h.tabs.open(wtB)).toEqual({ ok: true, root: wtB, state: "live" });
    writeLog(wtA, "sess-aaa-111", "a2");
    writeLog(wtB, "sess-bbb-222", "b2", "b3");
    vi.advanceTimersByTime(1000);
    expect(h.log).toEqual([
      "init repo-a sess-aaa-111 1",
      "init repo-b sess-bbb-222 1",
      "entry repo-a sess-aaa-111 a2",
      "entry repo-b sess-bbb-222 b2",
      "entry repo-b sess-bbb-222 b3",
    ]);
    expect(h.log.join()).not.toContain("main-line");
    h.tabs.closeAll();
  });

  it("open is idempotent and a rejected path opens nothing", () => {
    vi.useFakeTimers();
    const h = harness(() => main);
    expect(h.tabs.open(main)).toEqual({ ok: false, reason: "not-a-worktree" });
    expect(h.tabs.open(wtA).ok).toBe(true);
    expect(h.tabs.open(wtA).ok).toBe(true);
    expect(h.tabs.openRoots()).toEqual([wtA]);
    expect(h.states).toEqual([[wtA, "no-log"]]);
    h.tabs.closeAll();
  });

  it("a worktree with no log is no-log, never the main log, and goes live when one appears", () => {
    vi.useFakeTimers();
    writeLog(main, "sess-main-000", "main-line");
    const h = harness(() => main);
    h.tabs.open(wtA);
    vi.advanceTimersByTime(3000);
    expect(h.log).toEqual([]);
    writeLog(wtA, "sess-aaa-111", "a1");
    vi.advanceTimersByTime(1000);
    expect(h.log).toEqual(["init repo-a sess-aaa-111 1"]);
    expect(h.states).toEqual([
      [wtA, "no-log"],
      [wtA, "live"],
    ]);
    h.tabs.closeAll();
  });

  it("an open tab survives the open project switching, and cannot be re-opened afterwards", () => {
    vi.useFakeTimers();
    writeLog(wtA, "sess-aaa-111", "a1");
    let open: string | null = main;
    const h = harness(() => open);
    h.tabs.open(wtA);
    open = path.join(tmp, "some-other-project");
    fs.mkdirSync(open);
    writeLog(wtA, "sess-aaa-111", "a2");
    vi.advanceTimersByTime(1000);
    expect(h.log).toContain("entry repo-a sess-aaa-111 a2");
    expect(h.tabs.openRoots()).toEqual([wtA]);
    expect(h.tabs.open(wtB)).toEqual({ ok: false, reason: "not-a-worktree" });
    h.tabs.closeAll();
  });

  it("a removed worktree degrades to an explicit removed state and ends its sessions", () => {
    vi.useFakeTimers();
    writeLog(wtA, "sess-aaa-111", "a1");
    const h = harness(() => main);
    h.tabs.open(wtA);
    git(main, "worktree", "remove", "--force", wtA);
    vi.advanceTimersByTime(2000);
    expect(h.log).toContain("end repo-a sess-aaa-111");
    expect(h.states.at(-1)).toEqual([wtA, "removed"]);
    h.tabs.closeAll();
  });

  it("close stops the tail", () => {
    vi.useFakeTimers();
    writeLog(wtA, "sess-aaa-111", "a1");
    const h = harness(() => main);
    h.tabs.open(wtA);
    h.tabs.close(wtA);
    writeLog(wtA, "sess-aaa-111", "a2");
    vi.advanceTimersByTime(3000);
    expect(h.log).toEqual(["init repo-a sess-aaa-111 1"]);
  });
});

describe("tailSessionLogs skipSession", () => {
  it("does not init or end a skipped session", () => {
    vi.useFakeTimers();
    writeLog(main, "sess-a-111", "x");
    writeLog(main, "sess-b-222", "y");
    const seen: string[] = [];
    const stop = tailSessionLogs(
      () => [main],
      { init: (_r, id) => seen.push(`init ${id}`), end: (_r, id) => seen.push(`end ${id}`) },
      1000,
      (_r, id) => id === "sess-a-111"
    );
    vi.advanceTimersByTime(2000);
    stop();
    expect(seen).toEqual(["init sess-b-222"]);
  });
});
