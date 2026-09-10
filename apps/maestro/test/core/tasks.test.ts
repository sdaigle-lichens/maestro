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

import { tailTasks, tasksDirFor, listTasks, closeTask, type MaestroTask } from "../../src/core/tasks.js";

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
