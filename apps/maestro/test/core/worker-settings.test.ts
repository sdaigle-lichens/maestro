// `181`: the worker runtime settings — the slice merge, readiness, the per-project lock, and the
// per-worker recorded settings the approval gate reads.

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { saveConfig } from "../../src/core/save.js";
import { blankConfig, mergeSlice, readConfig, writeConfig } from "../../src/core/config.js";
import { resolveManagerApproval } from "../../src/core/manager-approval.js";
import { resolveWorkerRuntime } from "../../src/core/worker-runtime.js";
import { computeWorkerReadiness, workerTokenExists, workerTokenPath } from "../../src/core/worker-readiness.js";
import { probeDockerDaemon } from "../../src/core/worker-launcher.js";
import { acquireWorkerLock, isProcessAlive, readLockOwner, workerLockDir } from "../../src/core/worker-lock.js";
import {
  addWorker,
  createEpic,
  managerApprovalForTask,
  readEpicState,
  recordedManagerApproval,
} from "../../src/core/epics.js";
import { gateManagerApproval } from "../../src/core/human-review-gate.js";
import { setTaskEpic } from "../../src/core/tasks.js";

const dirs: string[] = [];
const mk = (prefix = "ws181-") => {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(r);
  return r;
};
afterEach(() => {
  for (const r of dirs.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

describe("worker-runtime slice merge (181)", () => {
  it("writes only the two fields; host and false remove the keys", () => {
    const base = { ...blankConfig(), use_maestro_tasks: true, worker_model: "haiku" };
    const set = mergeSlice(base, {
      sliceType: "worker-runtime",
      slice: { worker_runtime: "docker", manager_approval: true },
    });
    expect(set.worker_runtime).toBe("docker");
    expect(set.manager_approval).toBe(true);
    expect(set.use_maestro_tasks).toBe(true);
    expect(set.worker_model).toBe("haiku");

    const cleared = mergeSlice(set, {
      sliceType: "worker-runtime",
      slice: { worker_runtime: "host", manager_approval: false },
    });
    expect("worker_runtime" in cleared).toBe(false);
    expect("manager_approval" in cleared).toBe(false);
    expect(cleared.worker_model).toBe("haiku");
  });

  it("saving Host never persists manager_approval", () => {
    const next = mergeSlice(blankConfig(), {
      sliceType: "worker-runtime",
      slice: { worker_runtime: "host", manager_approval: true },
    });
    expect("manager_approval" in next).toBe(false);
  });

  it("other slices leave both fields alone", () => {
    const base = { ...blankConfig(), worker_runtime: "docker" as const, manager_approval: true };
    const next = mergeSlice(base, { sliceType: "worker-model", slice: { worker_model: "opus" } });
    expect(next.worker_runtime).toBe("docker");
    expect(next.manager_approval).toBe(true);
  });

  it("survives saveConfig, a reload and a later save of another slice", async () => {
    const root = mk();
    writeConfig(root, blankConfig());
    await saveConfig(root, {
      sliceType: "worker-runtime",
      slice: { worker_runtime: "docker", manager_approval: true },
    });
    await saveConfig(root, { sliceType: "task-routing", slice: { use_maestro_tasks: true } });
    const cfg = readConfig(root);
    expect(resolveWorkerRuntime(cfg)).toBe("docker");
    expect(resolveManagerApproval(cfg)).toBe(true);
    await saveConfig(root, {
      sliceType: "worker-runtime",
      slice: { worker_runtime: "host", manager_approval: false },
    });
    const raw = JSON.parse(fs.readFileSync(path.join(root, ".claude", "maestro.json"), "utf8"));
    expect("worker_runtime" in raw).toBe(false);
    expect("manager_approval" in raw).toBe(false);
    expect(raw.use_maestro_tasks).toBe(true);
  });
});

describe("worker readiness (181)", () => {
  it("reports the daemon down and the token missing", async () => {
    const home = mk();
    const r = await computeWorkerReadiness({
      home,
      probeDocker: async () => ({ reachable: false, detail: "Cannot connect to the Docker daemon" }),
    });
    expect(r.docker.reachable).toBe(false);
    expect(r.token.exists).toBe(false);
    expect(r.token.path).toBe(workerTokenPath(home));
  });

  it("reports ready, and never reads the token contents", async () => {
    const home = mk();
    fs.mkdirSync(path.dirname(workerTokenPath(home)), { recursive: true });
    fs.writeFileSync(workerTokenPath(home), "SECRET-TOKEN-VALUE");
    const r = await computeWorkerReadiness({
      home,
      probeDocker: async () => ({ reachable: true, detail: "27.0.1" }),
    });
    expect(r.token.exists).toBe(true);
    expect(JSON.stringify(r)).not.toContain("SECRET-TOKEN-VALUE");
  });

  it("treats a throwing probe as not reachable and a directory as no token", async () => {
    const home = mk();
    fs.mkdirSync(workerTokenPath(home), { recursive: true });
    expect(workerTokenExists(home)).toBe(false);
    const r = await computeWorkerReadiness({
      home,
      probeDocker: async () => {
        throw new Error("boom\nsecond line");
      },
    });
    expect(r.docker).toEqual({ reachable: false, detail: "boom" });
  });
});

describe("worker image lock (181)", () => {
  const fakeClock = () => {
    let t = 1_000_000;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };

  it("lives under home, outside the project", () => {
    const home = mk();
    const project = mk();
    const dir = workerLockDir(home, project);
    expect(dir.startsWith(home + path.sep)).toBe(true);
    expect(dir.startsWith(project)).toBe(false);
  });

  it("a second build waits for the first, then takes it after release", () => {
    const dir = workerLockDir(mk(), mk());
    const clock = fakeClock();
    const first = acquireWorkerLock(dir, { kind: "build", now: clock.now });
    expect(first.ok).toBe(true);
    let waitedOn: unknown = "unset";
    let released = false;
    const second = acquireWorkerLock(dir, {
      kind: "build",
      now: clock.now,
      onWait: (o) => (waitedOn = o),
      sleep: (ms) => {
        clock.advance(ms);
        if (!released && first.ok) {
          first.release();
          released = true;
        }
      },
    });
    expect(second.ok && second.waited).toBe(true);
    expect((waitedOn as { kind: string }).kind).toBe("build");
    if (second.ok) second.release();
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("a build and a prune exclude each other", () => {
    const dir = workerLockDir(mk(), mk());
    const clock = fakeClock();
    const build = acquireWorkerLock(dir, { kind: "build", now: clock.now });
    expect(build.ok).toBe(true);
    const prune = acquireWorkerLock(dir, {
      kind: "prune",
      now: clock.now,
      timeoutMs: 2000,
      pollMs: 500,
      sleep: (ms) => clock.advance(ms),
    });
    expect(prune.ok).toBe(false);
    if (!prune.ok) expect(prune.message).toContain("worker image build");
  });

  it("takes over a lock whose owner is dead", () => {
    const dir = workerLockDir(mk(), mk());
    const dead = acquireWorkerLock(dir, { kind: "build", pid: 999999 });
    expect(dead.ok).toBe(true);
    let recovered: unknown = null;
    const next = acquireWorkerLock(dir, {
      kind: "prune",
      isAlive: () => false,
      onRecovered: (o) => (recovered = o),
    });
    expect(next.ok).toBe(true);
    expect((recovered as { pid: number }).pid).toBe(999999);
    expect(readLockOwner(dir)?.kind).toBe("prune");
  });

  it("takes over an ownerless directory only after the grace period", () => {
    const dir = workerLockDir(mk(), mk());
    fs.mkdirSync(dir, { recursive: true });
    const base = fs.statSync(dir).mtimeMs;
    const young = acquireWorkerLock(dir, {
      kind: "build",
      now: () => base + 100,
      timeoutMs: 0,
    });
    expect(young.ok).toBe(false);
    const old = acquireWorkerLock(dir, { kind: "build", now: () => base + 60_000 });
    expect(old.ok).toBe(true);
  });

  it("release removes only the holder's own lock", () => {
    const dir = workerLockDir(mk(), mk());
    const a = acquireWorkerLock(dir, { kind: "build" });
    expect(a.ok).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
    const b = acquireWorkerLock(dir, { kind: "build" });
    expect(b.ok).toBe(true);
    if (a.ok) a.release();
    expect(fs.existsSync(dir)).toBe(true);
    if (b.ok) b.release();
    expect(fs.existsSync(dir)).toBe(false);
  });
});

describe("recorded per-worker settings and the gate (181)", () => {
  const setup = () => {
    const root = mk();
    writeConfig(root, { ...blankConfig(), worker_runtime: "docker", manager_approval: true });
    const task = "001-a.md";
    fs.mkdirSync(path.join(root, ".claude", "maestro-tasks"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "maestro-tasks", task), "# a\n");
    createEpic(root, "e1");
    setTaskEpic(root, [task], "e1");
    return { root, task };
  };

  it("records the settings at launch and keeps them after the config changes", async () => {
    const { root, task } = setup();
    addWorker(root, "e1", "w1", task);
    await saveConfig(root, {
      sliceType: "worker-runtime",
      slice: { worker_runtime: "host", manager_approval: false },
    });
    addWorker(root, "e1", "w1", task); // a later add-worker refresh
    const w = readEpicState(root, "e1")!.workers[0]!;
    expect(w.runtime).toBe("docker");
    expect(w.manager_approval).toBe(true);
    expect(recordedManagerApproval(root, task)).toBe(true);
    // the live config now says off, the recorded worker keeps approval on
    expect(managerApprovalForTask(root, task, readConfig(root), true)).toBe(true);
  });

  it("an explicit launcher record wins over the project's current values", () => {
    const { root, task } = setup();
    addWorker(root, "e1", "w1", task, undefined, { runtime: "docker", manager_approval: false });
    expect(recordedManagerApproval(root, task)).toBe(false);
    expect(managerApprovalForTask(root, task, readConfig(root), true)).toBe(false);
  });

  it("no record falls back to the live config; a host worker is never covered", () => {
    const { root, task } = setup();
    expect(recordedManagerApproval(root, task)).toBeNull();
    expect(managerApprovalForTask(root, task, readConfig(root), true)).toBe(true);
    expect(managerApprovalForTask(root, task, readConfig(root), false)).toBe(false);
    expect(gateManagerApproval({ containerWorker: false, recorded: true, live: true })).toBe(false);
    expect(gateManagerApproval({ containerWorker: true, recorded: null, live: false })).toBe(false);
    expect(gateManagerApproval({ containerWorker: true, recorded: false, live: true })).toBe(false);
    expect(gateManagerApproval({ containerWorker: true, recorded: true, live: false })).toBe(true);
  });
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const LIB = path.join(REPO, "plugins/maestro/scripts/lib/maestro-worker-runtime.cjs");

describe("slice merge: every other key is untouched (181)", () => {
  it("a worker-runtime save changes exactly the two fields on disk", async () => {
    const root = mk();
    const base = {
      ...blankConfig(),
      use_maestro_tasks: true,
      worker_model: "haiku",
      project_tags: ["web"],
      workflow_instances: [],
    };
    writeConfig(root, base);
    const cfgPath = path.join(root, ".claude", "maestro.json");
    const before = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    await saveConfig(root, {
      sliceType: "worker-runtime",
      slice: { worker_runtime: "docker", manager_approval: true },
    });
    const after = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    expect(after).toEqual({ ...before, worker_runtime: "docker", manager_approval: true });
  });

  it("a malformed payload is stored as host / off, never as the raw value", () => {
    const asked = { version: 3, worker_runtime: "kubernetes", manager_approval: "yes" } as unknown as Parameters<
      typeof resolveWorkerRuntime
    >[0];
    expect(resolveWorkerRuntime(asked)).toBe("host");
    expect(resolveManagerApproval(asked as never)).toBe(false);
  });
});

describe("readiness against the real Docker CLI (181)", () => {
  it("daemon down: a real `docker info` that cannot connect is reported not reachable with its reason", async () => {
    const saved = process.env.DOCKER_HOST;
    process.env.DOCKER_HOST = "unix:///nonexistent-maestro-181/docker.sock";
    try {
      const home = mk();
      const probe = await probeDockerDaemon();
      expect(probe.reachable).toBe(false);
      expect(probe.detail.length).toBeGreaterThan(0);
      expect(probe.detail).not.toContain("\n");
      const r = await computeWorkerReadiness({ home, probeDocker: probeDockerDaemon });
      expect(r.docker.reachable).toBe(false);
      expect(r.token.exists).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.DOCKER_HOST;
      else process.env.DOCKER_HOST = saved;
    }
  });

  it("docker not on PATH: reported as not installed, not as a crash", async () => {
    const savedPath = process.env.PATH;
    process.env.PATH = mk("ws181-nopath-");
    try {
      const probe = await probeDockerDaemon();
      expect(probe).toEqual({ reachable: false, detail: "docker is not installed (not on PATH)" });
    } finally {
      process.env.PATH = savedPath;
    }
  });

  it("token missing while the daemon is down: both lines say so, and the token path is named", async () => {
    const saved = process.env.DOCKER_HOST;
    process.env.DOCKER_HOST = "unix:///nonexistent-maestro-181/docker.sock";
    try {
      const home = mk();
      const r = await computeWorkerReadiness({ home, probeDocker: probeDockerDaemon });
      expect(r.token).toEqual({ exists: false, path: workerTokenPath(home) });
      expect(r.docker.reachable).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.DOCKER_HOST;
      else process.env.DOCKER_HOST = saved;
    }
  });
});

describe("lock under real processes and a real filesystem (181)", () => {
  // Each child takes the shipped lock library (the same bundle the launcher runs), holds it for
  // 1.5s, and logs start/end. Overlap in the log would mean two holders at once.
  const CHILD = [
    'const fs = require("node:fs");',
    "const rt = require(process.env.LIB);",
    "const { LOCKDIR: dir, KIND: kind, LOG: log } = process.env;",
    "const lock = rt.acquireWorkerLock(dir, { kind, timeoutMs: 60000 });",
    "if (!lock.ok) { process.stderr.write(lock.message); process.exit(3); }",
    'const line = (event) => fs.appendFileSync(log, JSON.stringify({ kind, pid: process.pid, event, at: Date.now() }) + "\\n");',
    'line("start");',
    "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);",
    'line("end");',
    "lock.release();",
    "process.stdout.write(JSON.stringify({ waited: lock.waited }));",
  ].join("\n");

  const runChild = (env: Record<string, string>) =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ["-e", CHILD], {
        env: { ...process.env, LIB, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });

  it("two builds and a prune started at once never hold the lock together, and only the first did not wait", async () => {
    const home = mk();
    const project = mk();
    const dir = workerLockDir(home, project);
    const log = path.join(mk(), "events.jsonl");
    const env = { LOCKDIR: dir, LOG: log };
    const runs = await Promise.all([
      runChild({ ...env, KIND: "build" }),
      runChild({ ...env, KIND: "build" }),
      runChild({ ...env, KIND: "prune" }),
    ]);
    for (const r of runs) expect(r.code, r.stderr).toBe(0);
    const events = fs
      .readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { event: string; pid: number });
    expect(events.map((e) => e.event)).toEqual(["start", "end", "start", "end", "start", "end"]);
    expect(new Set(events.map((e) => e.pid)).size).toBe(3);
    const waited = runs.map((r) => (JSON.parse(r.stdout) as { waited: boolean }).waited);
    expect(waited.filter((w) => !w).length).toBe(1);
    expect(fs.existsSync(dir)).toBe(false);
  });

  it("a lock held by a process that really exited is recovered, with its real pid", () => {
    const dir = workerLockDir(mk(), mk());
    const dead = spawnSync(process.execPath, ["-e", ""]);
    const deadPid = dead.pid!;
    expect(isProcessAlive(deadPid)).toBe(false);
    expect(acquireWorkerLock(dir, { kind: "build", pid: deadPid }).ok).toBe(true);
    let recovered: { pid: number } | null = null;
    const next = acquireWorkerLock(dir, { kind: "prune", onRecovered: (o) => (recovered = o) });
    expect(next.ok).toBe(true);
    expect(recovered?.pid).toBe(deadPid);
  });

  it("a live holder's lock is never recovered, however old its directory", () => {
    const dir = workerLockDir(mk(), mk());
    const holder = acquireWorkerLock(dir, { kind: "build", pid: process.pid });
    expect(holder.ok).toBe(true);
    fs.utimesSync(dir, new Date(0), new Date(0));
    const other = acquireWorkerLock(dir, { kind: "build", timeoutMs: 0 });
    expect(other.ok).toBe(false);
    expect(readLockOwner(dir)?.pid).toBe(process.pid);
  });

  it("a fresh ownerless directory is not taken over as stale, even if an old one was judged first", () => {
    // Race: between judging an ownerless lock stale and renaming it, another process recovers it and
    // takes it. The rename then moves a LIVE lock, which must be put back, not deleted.
    const dir = workerLockDir(mk(), mk());
    fs.mkdirSync(dir, { recursive: true });
    const old = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(dir, old, old);
    const rival = { pid: process.pid, kind: "build", token: "rival-token", started_at: new Date().toISOString() };
    let calls = 0;
    const now = () => {
      // acquire reads the clock twice before its loop (started_at, started); the third call is the
      // ownerless staleness check, which is where the rival takes the lock.
      calls += 1;
      if (calls === 3) {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, "owner.json"), JSON.stringify(rival));
        fs.utimesSync(dir, old, old);
      }
      return Date.now();
    };
    const mine = acquireWorkerLock(dir, { kind: "build", now, timeoutMs: 0 });
    expect(mine.ok).toBe(false);
    expect(readLockOwner(dir)?.token).toBe("rival-token");
  });

  it("a stale takeover never removes a fresh ownerless directory that another process is mid-way through creating", () => {
    // Race: a dead holder's lock is judged stale; before the rename a new acquirer has `mkdir`ed the
    // directory but not yet written owner.json. The moved directory is not the one judged stale.
    const dir = workerLockDir(mk(), mk());
    const dead = spawnSync(process.execPath, ["-e", ""]);
    expect(acquireWorkerLock(dir, { kind: "build", pid: dead.pid! }).ok).toBe(true);
    let swapped = false;
    const next = acquireWorkerLock(dir, {
      kind: "build",
      timeoutMs: 0,
      isAlive: () => {
        if (!swapped) {
          swapped = true;
          fs.rmSync(dir, { recursive: true, force: true });
          fs.mkdirSync(dir);
        }
        return false;
      },
    });
    expect(next.ok).toBe(false);
    expect(fs.existsSync(dir)).toBe(true);
  });
});
