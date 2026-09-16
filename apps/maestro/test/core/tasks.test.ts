// The task-queue tail's lifecycle (062): a status flip in status.json, a brand-new task file
// appearing, and a task file's own content changing must all surface as an `update` — because
// `tailTasks` re-derives the full list with `listTasks` on every poll and only pushes when the
// serialized result changed, there is no separate code path per kind of change to individually
// verify; these tests pin that they all in fact flow through the one fingerprint comparison.
//
// Mirrors test/core/session-log.test.ts's shape for tailSessionLog, adapted to a directory of
// task files + status.json instead of a single append-only log.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  tailTasks,
  tasksDirFor,
  listTasks,
  closeTask,
  deleteTask,
  extractPostMortemSection,
  claimTask,
  claimsDirFor,
  type MaestroTask,
} from "../../src/core/tasks.js";

const TICK = 1000;

let tmp: string;
let dir: string;

function writeTask(filename: string, title: string, blockedBy: string[] = []) {
  const body = blockedBy.length
    ? `# ${title}\n\n## Blocked by\n\n${blockedBy.map((b) => `- \`${b}\``).join("\n")}\n`
    : `# ${title}\n\n## Blocked by\n\nNone\n`;
  fs.writeFileSync(path.join(dir, filename), body);
}

beforeEach(() => {
  vi.useFakeTimers();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-task-tail-"));
  dir = tasksDirFor(tmp);
  fs.mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Collect every callback the tail fires, in order, plus a snapshot of filenames per push. */
function record() {
  const events: string[] = [];
  const snapshots: string[][] = [];
  return {
    events,
    snapshots,
    handlers: {
      init: (tasks: MaestroTask[]) => {
        events.push("init");
        snapshots.push(tasks.map((t) => `${t.filename}:${t.status}`));
      },
      update: (tasks: MaestroTask[]) => {
        events.push("update");
        snapshots.push(tasks.map((t) => `${t.filename}:${t.status}`));
      },
    },
  };
}

describe("tailTasks", () => {
  it("emits a snapshot immediately, mirroring listTasks", () => {
    writeTask("001-a.md", "A");
    const r = record();
    const stop = tailTasks(tmp, r.handlers, TICK);
    try {
      expect(r.events).toEqual(["init"]);
      expect(r.snapshots[0]).toEqual(["001-a.md:ready"]);
    } finally {
      stop();
    }
  });

  it("pushes an update when an external status.json edit closes a task", () => {
    writeTask("001-a.md", "A");
    const r = record();
    const stop = tailTasks(tmp, r.handlers, TICK);
    try {
      expect(r.events).toEqual(["init"]);

      // Simulate the CLI/hook (or a hand edit) writing status.json directly, bypassing closeTask.
      fs.writeFileSync(
        path.join(dir, "status.json"),
        JSON.stringify({ "001-a.md": { status: "done", blockedBy: [] } })
      );
      vi.advanceTimersByTime(TICK);

      expect(r.events).toEqual(["init", "update"]);
      expect(r.snapshots[1]).toEqual(["001-a.md:done"]);
    } finally {
      stop();
    }
  });

  it("pushes an update when a new task file is dropped into the queue directory", () => {
    writeTask("001-a.md", "A");
    const r = record();
    const stop = tailTasks(tmp, r.handlers, TICK);
    try {
      expect(r.events).toEqual(["init"]);
      expect(r.snapshots[0]).toEqual(["001-a.md:ready"]);

      // Simulate /to-maestro-tasks or maestro-write-tasks.cjs dropping a new file mid-session.
      writeTask("002-b.md", "B");
      vi.advanceTimersByTime(TICK);

      expect(r.events).toEqual(["init", "update"]);
      expect(r.snapshots[1]).toEqual(["001-a.md:ready", "002-b.md:ready"]);
    } finally {
      stop();
    }
  });

  it("cascades a closed blocker to ready on the very next poll", () => {
    writeTask("001-a.md", "A");
    writeTask("002-b.md", "B", ["001-a.md"]);
    const r = record();
    const stop = tailTasks(tmp, r.handlers, TICK);
    try {
      expect(r.snapshots[0]).toEqual(["001-a.md:ready", "002-b.md:blocked"]);

      closeTask(tmp, "001-a.md");
      vi.advanceTimersByTime(TICK);

      expect(r.events).toEqual(["init", "update"]);
      expect(r.snapshots[1]).toEqual(["001-a.md:done", "002-b.md:ready"]);
    } finally {
      stop();
    }
  });

  it("does not push when nothing on disk changed", () => {
    writeTask("001-a.md", "A");
    const r = record();
    const stop = tailTasks(tmp, r.handlers, TICK);
    try {
      vi.advanceTimersByTime(TICK * 5);
      expect(r.events).toEqual(["init"]);
    } finally {
      stop();
    }
  });

  it("stops polling once unsubscribed", () => {
    writeTask("001-a.md", "A");
    const r = record();
    tailTasks(tmp, r.handlers, TICK)();

    writeTask("002-b.md", "B");
    vi.advanceTimersByTime(TICK * 5);

    expect(r.events).toEqual(["init"]);
  });

  it("reflects the in-app Close button's own write on the next poll, same as an external one", () => {
    writeTask("001-a.md", "A");
    const r = record();
    const stop = tailTasks(tmp, r.handlers, TICK);
    try {
      // The in-app Close button calls closeTask directly (not through the tail); the tail must
      // still pick up the resulting status.json write on its next poll rather than needing a
      // second, unrelated change to trigger a refresh.
      closeTask(tmp, "001-a.md");
      vi.advanceTimersByTime(TICK);
      expect(r.events).toEqual(["init", "update"]);
      expect(r.snapshots[1]).toEqual(["001-a.md:done"]);
    } finally {
      stop();
    }
  });

  it("has no tasks and no update when the queue directory does not exist yet", () => {
    fs.rmSync(dir, { recursive: true, force: true });
    const r = record();
    const stop = tailTasks(tmp, r.handlers, TICK);
    try {
      expect(r.events).toEqual(["init"]);
      expect(r.snapshots[0]).toEqual([]);

      // A project that never had a queue, then gets one via /to-maestro-tasks.
      fs.mkdirSync(dir, { recursive: true });
      writeTask("001-a.md", "A");
      vi.advanceTimersByTime(TICK);
      expect(r.events).toEqual(["init", "update"]);
      expect(r.snapshots[1]).toEqual(["001-a.md:ready"]);
    } finally {
      stop();
    }
  });
});

describe("listTasks / closeTask (previously untested)", () => {
  it("computes the ready/blocked/done cascade from status.json and blockedBy", () => {
    writeTask("001-a.md", "A");
    writeTask("002-b.md", "B", ["001-a.md"]);
    expect(listTasks(tmp).map((t) => `${t.filename}:${t.status}`)).toEqual(["001-a.md:ready", "002-b.md:blocked"]);
  });

  it("closeTask marks the file done and cascades dependents to ready", () => {
    writeTask("001-a.md", "A");
    writeTask("002-b.md", "B", ["001-a.md"]);
    const after = closeTask(tmp, "001-a.md");
    expect(after.map((t) => `${t.filename}:${t.status}`)).toEqual(["001-a.md:done", "002-b.md:ready"]);
  });
});

// `066`: claims are strictly derived/overlay state — attached to a MaestroTask at read time, never
// folded into buildStatusMap's ready/blocked/done computation. These pin that the cascade this
// file already covers above is byte-for-byte identical whether or not a claim exists on the task,
// using the SAME writeTask/listTasks/closeTask helpers rather than duplicating their setup.
describe("the status cascade is unaffected by a claim (066)", () => {
  it("a claimed task still reads as ready, with the same cascade as its unclaimed sibling", () => {
    writeTask("001-a.md", "A");
    writeTask("002-b.md", "B", ["001-a.md"]);

    const unclaimed = listTasks(tmp).map((t) => `${t.filename}:${t.status}`);
    expect(unclaimed).toEqual(["001-a.md:ready", "002-b.md:blocked"]);

    // A live session (directory + fresh log), so the claim below reads live and survives more than
    // one listTasks() read rather than being reaped on the very read that observes it.
    const sessionDir = path.join(tmp, ".claude", "maestro_sessions", "sess-claimer-1");
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, "log.jsonl"), '{"kind":"tool_call"}\n');

    const result = claimTask(tmp, tasksDirFor(tmp), "001-a.md", "sess-claimer-1");
    expect(result).toEqual({ outcome: "claimed" });

    const claimed = listTasks(tmp);
    // Status/blockedBy cascade: identical to the unclaimed read above.
    expect(claimed.map((t) => `${t.filename}:${t.status}`)).toEqual(unclaimed);
    expect(claimed.find((t) => t.filename === "002-b.md")?.blockedBy).toEqual(["001-a.md"]);
    // The overlay itself: the claimed task now carries a live claim, its blocked sibling does not.
    const a = claimed.find((t) => t.filename === "001-a.md");
    expect(a?.status).toBe("ready");
    expect(a?.claim).toEqual({ sessionId: "sess-claimer-1", claimedAt: expect.any(String), live: true });
    expect(claimed.find((t) => t.filename === "002-b.md")?.claim).toBeNull();

    // And it is still there, still live, still not affecting the cascade, on a second read.
    const again = listTasks(tmp);
    expect(again.map((t) => `${t.filename}:${t.status}`)).toEqual(unclaimed);
    expect(again.find((t) => t.filename === "001-a.md")?.claim).toMatchObject({ live: true });
  });

  it("closeTask's cascade is identical with or without a claim present, and releases the claim it closes", () => {
    // Baseline, no claim involved at all — exactly the assertion the preceding test already makes.
    writeTask("001-a.md", "A");
    writeTask("002-b.md", "B", ["001-a.md"]);
    const baseline = closeTask(tmp, "001-a.md").map((t) => `${t.filename}:${t.status}`);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    // Same scenario, but 001-a.md is claimed before it closes.
    writeTask("001-a.md", "A");
    writeTask("002-b.md", "B", ["001-a.md"]);
    claimTask(tmp, tasksDirFor(tmp), "001-a.md", "sess-claimer-1");

    const after = closeTask(tmp, "001-a.md");
    expect(after.map((t) => `${t.filename}:${t.status}`)).toEqual(baseline);
    expect(after.map((t) => `${t.filename}:${t.status}`)).toEqual(["001-a.md:done", "002-b.md:ready"]);

    // A done task has nothing left for a claim to protect — closeTask released it.
    expect(after.find((t) => t.filename === "001-a.md")?.claim).toBeNull();
    expect(fs.existsSync(path.join(claimsDirFor(tasksDirFor(tmp)), "001-a.md.json"))).toBe(false);
  });
});

describe("extractPostMortemSection", () => {
  it("returns null when the file has no Post-Mortem section", () => {
    expect(extractPostMortemSection("# A\n\n## Blocked by\n\nNone\n")).toBeNull();
  });

  it("returns the section, heading included, stopping before the next heading", () => {
    const content =
      "# A\n\n## Blocked by\n\nNone\n\n## Post-Mortem\n\n- **Problem:** flaky test\n  **Fix:** none\n\n## Not part of it\n\nother stuff\n";
    expect(extractPostMortemSection(content)).toBe(
      "## Post-Mortem\n\n- **Problem:** flaky test\n  **Fix:** none"
    );
  });

  it("returns the section when it is the file's last section", () => {
    const content = "# A\n\n## Post-Mortem\n\n- **Problem:** wrong assumption\n  **Fix:** none\n";
    expect(extractPostMortemSection(content)).toBe("## Post-Mortem\n\n- **Problem:** wrong assumption\n  **Fix:** none");
  });
});

describe("deleteTask", () => {
  it("removes the task file and drops it from status.json and listTasks", () => {
    writeTask("001-a.md", "A");
    writeTask("002-b.md", "B", ["001-a.md"]);
    const after = deleteTask(tmp, "001-a.md");
    expect(after.map((t) => t.filename)).toEqual(["002-b.md"]);
    expect(fs.existsSync(path.join(dir, "001-a.md"))).toBe(false);
  });

  it("cascades a deleted blocker to ready, same as a done one", () => {
    writeTask("001-a.md", "A");
    writeTask("002-b.md", "B", ["001-a.md"]);
    const after = deleteTask(tmp, "001-a.md");
    expect(after.map((t) => `${t.filename}:${t.status}`)).toEqual(["002-b.md:ready"]);
  });

  it("releases the deleted task's claim", () => {
    writeTask("001-a.md", "A");
    claimTask(tmp, tasksDirFor(tmp), "001-a.md", "sess-claimer-1");
    deleteTask(tmp, "001-a.md");
    expect(fs.existsSync(path.join(claimsDirFor(tasksDirFor(tmp)), "001-a.md.json"))).toBe(false);
  });

  it("extracts a Post-Mortem section into .claude/postmortems.log before removing the file", () => {
    fs.writeFileSync(
      path.join(dir, "001-a.md"),
      "# A\n\n## Blocked by\n\nNone\n\n## Post-Mortem\n\n- **Problem:** flaky test\n  **Fix:** none\n"
    );
    deleteTask(tmp, "001-a.md");

    const logPath = path.join(tmp, ".claude", "postmortems.log");
    expect(fs.existsSync(logPath)).toBe(true);
    const logContent = fs.readFileSync(logPath, "utf8");
    expect(logContent).toContain("## A (001-a.md)");
    expect(logContent).toContain("**Problem:** flaky test");
  });

  it("writes nothing to postmortems.log when the task has no Post-Mortem section", () => {
    writeTask("001-a.md", "A");
    deleteTask(tmp, "001-a.md");
    expect(fs.existsSync(path.join(tmp, ".claude", "postmortems.log"))).toBe(false);
  });

  it("is a no-op returning the current list when the file does not exist", () => {
    writeTask("001-a.md", "A");
    const after = deleteTask(tmp, "999-missing.md");
    expect(after.map((t) => t.filename)).toEqual(["001-a.md"]);
  });
});
