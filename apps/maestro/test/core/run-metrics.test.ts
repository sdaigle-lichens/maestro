// `080` — the durable per-project run-metrics file. Driven through the REAL scripts: the hooks the
// installer copies into `<project>/.claude/scripts/` (SubagentStart/Stop log hook, SessionEnd
// cleanup), the plugin's `maestro-session-cleanup.sh` twin and `maestro-team-meeting.cjs brief`.
// Nothing is mocked. Folding arithmetic is also checked on the pure functions.
//
// Every spawn pins HOME at this test's tmp dir and SETS or DELETES CLAUDE_CODE_SESSION_ID — never
// inherits it (`064`; see test-maestro's references/hook-script-tests.md).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import {
  compact,
  foldRun,
  emptyMetrics,
  readMetrics,
  recordRun,
  renderMetricsDigest,
  metricsFileFor,
  type RunRecord,
  type MetricsFile,
} from "../../src/core/run-metrics.js";
import type { MaestroConfigV3 } from "../../src/core/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const PLUGIN_SCRIPTS = path.join(PLUGIN_ROOT, "scripts");

const succ = (from: string, to: string) =>
  ({ from, to, kind: "success", sourceHandle: "bottom", targetHandle: "top" }) as const;
const cond = (from: string, to: string, label: string) =>
  ({ from, to, kind: "condition", label, sourceHandle: "right", targetHandle: "top" }) as const;

function cfg(extra: Record<string, unknown> = {}): MaestroConfigV3 {
  return {
    version: 3,
    agents_available: ["backend", "frontend", "reviewer"],
    skills_available: [],
    workflow_instances: [
      { name: "backend", agent: "backend", loaded_skills: [], referenced_skills: [] },
      { name: "frontend", agent: "frontend", loaded_skills: [], referenced_skills: [] },
      { name: "reviewer", agent: "reviewer", loaded_skills: [], referenced_skills: [] },
    ],
    workflows: [
      {
        name: "build",
        nodes: [
          { id: "backend", type: "agent", instance: "backend", position: { x: 0, y: 100 } },
          { id: "review", type: "human_review", position: { x: 0, y: 200 } },
          { id: "frontend", type: "agent", instance: "frontend", position: { x: 0, y: 300 } },
          { id: "reviewer", type: "agent", instance: "reviewer", position: { x: 0, y: 400 } },
        ],
        edges: [
          succ("main-session", "backend"),
          succ("backend", "review"),
          succ("review", "frontend"),
          succ("frontend", "reviewer"),
          cond("reviewer", "frontend", "changes requested"),
        ],
      },
    ],
    rules: [],
    ...extra,
  } as unknown as MaestroConfigV3;
}

let tmp: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-080-")));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function installed(extra: Record<string, unknown> = {}): Promise<string> {
  const root = path.join(tmp, "p");
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeConfig(root, cfg(extra));
  await installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "report-defaults.sqlite"),
    path.join(tmp, "project-tags.sqlite"),
    path.join(tmp, "handoff-defaults.sqlite")
  );
  return root;
}

function env(root: string, sessionId: string | null): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: tmp };
  if (sessionId === null) delete e.CLAUDE_CODE_SESSION_ID;
  else e.CLAUDE_CODE_SESSION_ID = sessionId;
  return e;
}

function hook(root: string, script: string, payload: unknown, sessionId: string | null) {
  const r = spawnSync("node", [path.join(root, ".claude", "scripts", script)], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: env(root, sessionId),
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const sessDir = (root: string, id: string) => path.join(root, ".claude", "maestro_sessions", id);
const metricsPath = (root: string) => path.join(root, ".claude", "maestro-metrics", "metrics.json");
const readFile = (root: string): MetricsFile => JSON.parse(fs.readFileSync(metricsPath(root), "utf8"));

/** Write a session's session.json + log.jsonl directly (the shape the log hooks produce). */
function seedSession(
  root: string,
  id: string,
  opts: { workflow?: string; task?: string | null; log: Record<string, unknown>[] }
) {
  const d = sessDir(root, id);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(d, "session.json"),
    JSON.stringify({ workflow: opts.workflow ?? "build", run_id: `run-${id}`, active_task: opts.task ?? null })
  );
  fs.writeFileSync(path.join(d, "log.jsonl"), opts.log.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

const t = (mins: number, base = "2026-03-01T10:00:00.000Z") => new Date(Date.parse(base) + mins * 60_000).toISOString();

const disp = (ts: string, agent: string, agent_id: string) => ({ ts, kind: "dispatch", agent, agent_id });
const hand = (ts: string, origin: string, agent_id: string, status: string, label: string | null = null, extra = {}) => ({
  ts,
  kind: "handoff",
  origin,
  agent_id,
  status,
  label,
  ...extra,
});

const END = (root: string, id: string, reason?: string) =>
  hook(root, "maestro-session-cleanup.cjs", { cwd: root, session_id: id, ...(reason ? { hook_event_name: "SessionEnd", reason } : {}) }, null);

function run(over: Partial<RunRecord> & { id: string; ended_at: string }): RunRecord {
  return {
    workflow: "build",
    task: "001-a.md",
    started_at: over.ended_at,
    duration_ms: 60_000,
    agents: [{ agent: "backend", runs: 1, success: 1, failure: 0, loop_backs: 0, human_reviews: 0, duration_ms: 60_000, ctx_pct: 40 }],
    skills: [],
    handoffs: [{ agent: "backend", label: "success" }],
    loop_backs: [],
    human_reviews: [],
    ctx_pct: 40,
    team_meeting: false,
    outcome: "success",
    ...over,
  };
}

// ── recording ─────────────────────────────────────────────────────────────────────────────────

describe("recording a finished run", () => {
  it("the real SubagentStart/Stop hooks + SessionEnd leave a full record that outlives the session", async () => {
    const root = await installed();
    const S = "sess-rec-1";
    const sub = (type: string, id: string, event: string, msg?: string) =>
      hook(root, "maestro-subagent-log.cjs", {
        cwd: root,
        hook_event_name: event,
        agent_type: type,
        agent_id: id,
        ...(msg ? { last_assistant_message: msg } : {}),
      }, S);
    // Establish the workflow through the real CLI.
    const wf = spawnSync("node", [path.join(root, ".claude", "scripts", "maestro-set-session-workflow.cjs"), "build"], {
      encoding: "utf8",
      env: env(root, S),
    });
    expect(wf.status, wf.stderr).toBe(0);

    sub("backend", "a1", "SubagentStart");
    sub("backend", "a1", "SubagentStop", "done\nHANDOFF: success");
    sub("frontend", "a2", "SubagentStart");
    sub("frontend", "a2", "SubagentStop", "done\nHANDOFF: success");
    sub("reviewer", "a3", "SubagentStart");
    sub("reviewer", "a3", "SubagentStop", "no\nHANDOFF: changes requested");
    sub("frontend", "a4", "SubagentStart");
    sub("frontend", "a4", "SubagentStop", "done\nHANDOFF: success");
    sub("reviewer", "a5", "SubagentStart");
    sub("reviewer", "a5", "SubagentStop", "ok\nHANDOFF: success");

    expect(fs.existsSync(sessDir(root, S))).toBe(true);
    const end = END(root, S);
    expect(end.code, end.stderr).toBe(0);
    expect(fs.existsSync(sessDir(root, S))).toBe(false); // session gone ...

    const f = readFile(root); // ... record remains
    expect(f.version).toBe(1);
    expect(f.runs).toHaveLength(1);
    const r = f.runs[0]!;
    expect(r.workflow).toBe("build");
    expect(r.outcome).toBe("success");
    expect(r.team_meeting).toBe(false);
    expect(r.agents.map((a) => a.agent).sort()).toEqual(["backend", "frontend", "reviewer"]);
    const fe = r.agents.find((a) => a.agent === "frontend")!;
    expect(fe.runs).toBe(2);
    expect(r.handoffs.map((h) => `${h.agent}:${h.label}`)).toEqual([
      "backend:success",
      "frontend:success",
      "reviewer:changes requested",
      "frontend:success",
      "reviewer:success",
    ]);
    expect(r.loop_backs).toEqual([{ from: "reviewer", label: "changes requested", count: 1 }]);
    expect(r.duration_ms).toBeGreaterThanOrEqual(0);
    expect(typeof r.started_at).toBe("string");
  });

  it("is git-ignored: the metrics dir carries its own .gitignore and git agrees", async () => {
    const root = await installed();
    seedSession(root, "s1", { log: [disp(t(0), "backend", "x"), hand(t(1), "backend", "x", "success")] });
    END(root, "s1");
    expect(fs.existsSync(metricsPath(root))).toBe(true);
    const ci = spawnSync("git", ["check-ignore", "-q", metricsPath(root)], { cwd: root });
    expect(ci.status).toBe(0);
  });

  it("derives human-review stops, outcome, loop-backs, duration and ctx from the log", async () => {
    const root = await installed();
    seedSession(root, "s1", {
      log: [
        disp(t(0), "backend", "b1"),
        hand(t(2), "backend", "b1", "success", null, { ctx_pct: 31 }),
        disp(t(3), "frontend", "f1"), // next step after the review stop => approved
        hand(t(5), "frontend", "f1", "success", null, { ctx_pct: 55 }),
        disp(t(6), "reviewer", "r1"),
        hand(t(10), "reviewer", "r1", "success", null, { ctx_pct: 62 }),
      ],
    });
    END(root, "s1");
    const r = readFile(root).runs[0]!;
    expect(r.human_reviews).toEqual([{ after: "backend", outcome: "approved" }]);
    expect(r.duration_ms).toBe(10 * 60_000);
    expect(r.ctx_pct).toBe(62);
    expect(r.agents.find((a) => a.agent === "backend")!.duration_ms).toBe(2 * 60_000);
    expect(r.agents.find((a) => a.agent === "backend")!.human_reviews).toBe(1);
  });

  it("marks changes_requested when the review stop is followed by an earlier step re-running", async () => {
    const root = await installed();
    seedSession(root, "s1", {
      log: [
        disp(t(0), "backend", "b1"),
        hand(t(1), "backend", "b1", "success"),
        disp(t(2), "backend", "b2"), // review sent it back
        hand(t(3), "backend", "b2", "success"),
      ],
    });
    END(root, "s1");
    const r = readFile(root).runs[0]!;
    expect(r.human_reviews.map((h) => h.outcome)).toEqual(["changes_requested", "no_decision"]);
  });

  it("flags a failed run and records a task filename (basename only) when a task was active", async () => {
    const root = await installed();
    seedSession(root, "s1", {
      task: "/abs/somewhere/.claude/maestro-tasks/080-x.md",
      log: [disp(t(0), "backend", "b1"), hand(t(1), "backend", "b1", "failure")],
    });
    END(root, "s1");
    const r = readFile(root).runs[0]!;
    expect(r.outcome).toBe("failure");
    expect(r.task).toBe("080-x.md");
  });

  it("flags a team-meeting session and keeps meeting turns out of the workflow handoffs", async () => {
    const root = await installed();
    seedSession(root, "s1", {
      log: [
        { ts: t(0), kind: "dispatch", agent: "backend", agent_id: "m1", meeting: true },
        { ts: t(1), kind: "handoff", origin: "backend", agent_id: "m1", status: "success", meeting: true },
      ],
    });
    END(root, "s1");
    const r = readFile(root).runs[0]!;
    expect(r.team_meeting).toBe(true);
    expect(r.handoffs).toEqual([]);
    expect(r.agents.map((a) => a.agent)).toEqual(["backend"]);
  });

  it("records nothing for a session that ran no agent, and exits 0 with no session id at all", async () => {
    const root = await installed();
    seedSession(root, "empty", { log: [{ ts: t(0), kind: "tool", log: "Read(a.ts)" }] });
    expect(END(root, "empty").code).toBe(0);
    expect(fs.existsSync(metricsPath(root))).toBe(false);
    const noId = hook(root, "maestro-session-cleanup.cjs", { cwd: root }, null);
    expect(noId.code).toBe(0);
    expect(fs.existsSync(metricsPath(root))).toBe(false);
  });

  it("a corrupt metrics file never blocks SessionEnd and is replaced by a valid one", async () => {
    const root = await installed();
    fs.mkdirSync(path.dirname(metricsPath(root)), { recursive: true });
    fs.writeFileSync(metricsPath(root), "{ not json");
    seedSession(root, "s1", { log: [disp(t(0), "backend", "x"), hand(t(1), "backend", "x", "success")] });
    expect(END(root, "s1").code).toBe(0);
    expect(readFile(root).runs).toHaveLength(1);
  });

  it("a resumable SessionEnd keeps the session dir and re-ending replaces its record rather than duplicating it", async () => {
    const root = await installed();
    seedSession(root, "s1", { log: [disp(t(0), "backend", "x"), hand(t(1), "backend", "x", "success")] });
    expect(END(root, "s1", "resume").code).toBe(0);
    expect(fs.existsSync(sessDir(root, "s1"))).toBe(true);
    expect(readFile(root).runs).toHaveLength(1);
    expect(END(root, "s1", "clear").code).toBe(0);
    expect(fs.existsSync(sessDir(root, "s1"))).toBe(false);
    expect(readFile(root).runs).toHaveLength(1);
  });

  it("the plugin's shell twin records too", async () => {
    const root = await installed();
    seedSession(root, "s1", { log: [disp(t(0), "backend", "x"), hand(t(1), "backend", "x", "success")] });
    const res = spawnSync("bash", [path.join(PLUGIN_SCRIPTS, "maestro-session-cleanup.sh")], {
      input: JSON.stringify({ cwd: root, session_id: "s1" }),
      encoding: "utf8",
      env: env(root, null),
    });
    expect(res.status).toBe(0);
    expect(readFile(root).runs).toHaveLength(1);
    expect(fs.existsSync(sessDir(root, "s1"))).toBe(false);
  });

  it("a linked worktree records into the main checkout's metrics file", async () => {
    const root = await installed();
    execFileSync("git", ["-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "i"], { cwd: root });
    const wt = path.join(tmp, "p-task-9");
    execFileSync("git", ["worktree", "add", "-q", wt, "-b", "task-9"], { cwd: root });
    fs.mkdirSync(path.join(wt, ".claude"), { recursive: true });
    seedSession(wt, "s1", { log: [disp(t(0), "backend", "x"), hand(t(1), "backend", "x", "success")] });
    const r = spawnSync("node", [path.join(PLUGIN_SCRIPTS, "maestro-session-cleanup.cjs")], {
      input: JSON.stringify({ cwd: wt, session_id: "s1" }),
      encoding: "utf8",
      env: env(wt, null),
    });
    expect(r.status, r.stderr).toBe(0);
    expect(fs.existsSync(metricsPath(root))).toBe(true);
    expect(fs.existsSync(metricsPath(wt))).toBe(false);
  });
});

// ── post-mortem text stays out ─────────────────────────────────────────────────────────────────

describe("no Post-Mortem text is copied", () => {
  it("a task file's Post-Mortem and log output text never reach the metrics file; the record only names the task", async () => {
    const root = await installed();
    const SECRET = "SECRET-POSTMORTEM-PROSE-XYZZY";
    const LOGSECRET = "SECRET-LOG-OUTPUT-QWERTY";
    fs.mkdirSync(path.join(root, ".claude", "maestro-tasks"), { recursive: true });
    const taskFile = path.join(root, ".claude", "maestro-tasks", "042-thing.md");
    fs.writeFileSync(taskFile, `# t\n\n## Post-Mortem\n\n${SECRET}\n`);
    fs.writeFileSync(path.join(root, ".claude", "postmortems.log"), SECRET + "\n");
    seedSession(root, "s1", {
      task: taskFile,
      log: [
        { ...disp(t(0), "backend", "x"), input: LOGSECRET },
        { ...hand(t(1), "backend", "x", "success"), output: LOGSECRET, log: LOGSECRET },
      ],
    });
    END(root, "s1");
    const raw = fs.readFileSync(metricsPath(root), "utf8");
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain(LOGSECRET);
    expect(JSON.parse(raw).runs[0].task).toBe("042-thing.md");
    // The digest cites the task path so a reader can follow it, still without the prose.
    const digest = renderMetricsDigest(readFile(root))!;
    expect(digest).toContain(".claude/maestro-tasks/042-thing.md");
    expect(digest).not.toContain(SECRET);
  });
});

// ── folding past N ─────────────────────────────────────────────────────────────────────────────

describe("retention and folding", () => {
  it("keeps only the default 10 newest runs in full and folds the rest, via real SessionEnds", async () => {
    const root = await installed();
    for (let i = 0; i < 13; i++) {
      const id = `s${String(i).padStart(2, "0")}`;
      seedSession(root, id, {
        task: `t${i}x.md`,
        log: [disp(t(i * 10), "backend", "x"), hand(t(i * 10 + 1), "backend", "x", i % 4 === 0 ? "failure" : "success", null, { ctx_pct: 20 + i })],
      });
      expect(END(root, id).code).toBe(0);
    }
    const f = readFile(root);
    expect(f.runs).toHaveLength(10);
    expect(f.runs.map((r) => r.id)).toEqual(Array.from({ length: 10 }, (_, k) => `run-s${String(k + 3).padStart(2, "0")}`));
    const wf = f.totals.by_workflow["build"]!;
    expect(wf.runs).toBe(3);
    expect(wf.failure).toBe(1); // s00 failed; s01, s02 succeeded
    expect(wf.success).toBe(2);
    const ag = f.totals.by_agent["backend"]!;
    expect(ag.runs).toBe(3);
    expect(wf.avg_duration_ms).toBe(60_000);
    expect(wf.avg_ctx_pct).toBe(21); // peaks 20, 21, 22
    expect(wf.first_seen).toBe("2026-03-01");
    // lossy by design: no folded run's task survives anywhere in the file
    const raw = JSON.stringify(f);
    for (const gone of ["t0x.md", "t1x.md", "t2x.md"]) expect(raw).not.toContain(gone);
    expect(raw).toContain("t3x.md");
  });

  it("honours maestro.json metrics.recent_runs", async () => {
    const root = await installed({ metrics: { recent_runs: 2 } });
    for (let i = 0; i < 5; i++) {
      seedSession(root, `s${i}`, { log: [disp(t(i * 10), "backend", "x"), hand(t(i * 10 + 1), "backend", "x", "success")] });
      END(root, `s${i}`);
    }
    const f = readFile(root);
    expect(f.runs).toHaveLength(2);
    expect(f.totals.by_workflow["build"]!.runs).toBe(3);
  });

  it.each([0, -3, "7", null, 1.5])("an invalid recent_runs (%s) falls back to a sane window", async (bad) => {
    const root = await installed({ metrics: { recent_runs: bad } });
    for (let i = 0; i < 12; i++) {
      seedSession(root, `s${i}`, { log: [disp(t(i * 10), "backend", "x"), hand(t(i * 10 + 1), "backend", "x", "success")] });
      END(root, `s${i}`);
    }
    const f = readFile(root);
    const expected = bad === 1.5 ? 1 : 10;
    expect(f.runs).toHaveLength(expected);
    expect(f.runs.length + f.totals.by_workflow["build"]!.runs).toBe(12);
  });

  it("file size is bounded: 60 runs of one workflow and one agent leave one totals entry each", async () => {
    const root = await installed();
    for (let i = 0; i < 60; i++) {
      recordRun(root, run({ id: `r${i}`, ended_at: t(i) }), 5);
    }
    const f = readFile(root);
    expect(f.runs).toHaveLength(5);
    expect(Object.keys(f.totals.by_workflow)).toEqual(["build"]);
    expect(Object.keys(f.totals.by_agent)).toEqual(["backend"]);
    expect(f.totals.by_workflow["build"]!.runs).toBe(55);
  });
});

// ── fold correctness and idempotence (pure) ────────────────────────────────────────────────────

describe("folding is correct and idempotent", () => {
  const mk = (i: number, wf: string, outcome: "success" | "failure", extra: Partial<RunRecord> = {}): RunRecord =>
    run({
      id: `r${i}`,
      workflow: wf,
      outcome,
      ended_at: t(i),
      started_at: t(i - 1),
      duration_ms: 1000 * (i + 1),
      ctx_pct: i % 2 ? null : 10 * i,
      ...extra,
    });

  it("totals equal the sum of the folded runs, by workflow and by agent", () => {
    const runs = [
      mk(0, "a", "success", {
        loop_backs: [{ from: "reviewer", label: "x", count: 2 }],
        human_reviews: [{ after: "backend", outcome: "approved" }],
        agents: [
          { agent: "backend", runs: 2, success: 1, failure: 1, loop_backs: 2, human_reviews: 1, duration_ms: 500, ctx_pct: 30 },
          { agent: "reviewer", runs: 1, success: 1, failure: 0, loop_backs: 0, human_reviews: 0, duration_ms: 100, ctx_pct: null },
        ],
      }),
      mk(1, "a", "failure"),
      mk(2, "b", "success"),
      mk(3, "a", "success"),
      mk(4, "a", "success"),
    ];
    const f: MetricsFile = { ...emptyMetrics(), runs };
    const out = compact(f, 1);
    expect(out.runs.map((r) => r.id)).toEqual(["r4"]);
    const a = out.totals.by_workflow["a"]!;
    expect(a.runs).toBe(3); // r0, r1, r3 folded (r4 kept)
    expect(a.success).toBe(2);
    expect(a.failure).toBe(1);
    expect(a.loop_backs).toBe(2);
    expect(a.human_reviews).toBe(1);
    expect(a.duration_ms_sum).toBe(1000 + 2000 + 4000);
    expect(a.avg_duration_ms).toBe(Math.round(7000 / 3));
    expect(a.loop_back_rate).toBe(Math.round((2 / 3) * 1000) / 1000);
    expect(a.human_review_rate).toBe(Math.round((1 / 3) * 1000) / 1000);
    expect(a.ctx_runs).toBe(1); // only r0 (ctx 0) ... r1 null, r3 null
    expect(out.totals.by_workflow["b"]!.runs).toBe(1);
    const be = out.totals.by_agent["backend"]!;
    // r0 contributes 2 runs; r1, r2, r3 each contribute the default 1 => 5
    expect(be.runs).toBe(5);
    expect(be.success).toBe(1 + 1 + 1 + 1);
    expect(be.failure).toBe(1);
    expect(out.totals.by_agent["reviewer"]!.avg_ctx_pct).toBeNull();
    expect(a.first_seen).toBe("2026-03-01");
    expect(a.last_seen <= "2026-03-02").toBe(true);
  });

  it("running compaction again changes nothing (deep-equal), at the same or a larger window", () => {
    const runs = Array.from({ length: 9 }, (_, i) => mk(i, i % 2 ? "a" : "b", i % 3 ? "success" : "failure"));
    const once = compact({ ...emptyMetrics(), runs }, 4);
    const twice = compact(once, 4);
    expect(twice).toEqual(once);
    expect(compact(once, 10)).toEqual(once);
    // total conservation: kept + folded == original
    expect(once.runs.length + once.totals.by_workflow["a"]!.runs + once.totals.by_workflow["b"]!.runs).toBe(9);
  });

  it("compaction is order-independent: folding in two steps equals folding at once", () => {
    const runs = Array.from({ length: 8 }, (_, i) => mk(i, "a", i % 2 ? "success" : "failure"));
    const at6 = compact({ ...emptyMetrics(), runs }, 6);
    const stepped = compact(at6, 3);
    const direct = compact({ ...emptyMetrics(), runs }, 3);
    expect(stepped).toEqual(direct);
  });

  it("does not mutate its input and keeps the newest by ended_at even when given out of order", () => {
    const runs = [mk(5, "a", "success"), mk(1, "a", "success"), mk(3, "a", "success")];
    const input: MetricsFile = { ...emptyMetrics(), runs };
    const snapshot = structuredClone(input);
    const out = compact(input, 2);
    expect(input).toEqual(snapshot);
    expect(out.runs.map((r) => r.id)).toEqual(["r3", "r5"]);
  });

  it("foldRun drops the task link: nothing about it is stored in totals", () => {
    const m = emptyMetrics();
    foldRun(m.totals, mk(1, "a", "success", { task: "999-secret-task.md" }));
    expect(JSON.stringify(m)).not.toContain("999-secret-task");
  });

  it("recordRun with an existing id replaces it (no duplicate, no double fold)", async () => {
    const root = await installed();
    recordRun(root, run({ id: "dup", ended_at: t(0) }), 1);
    recordRun(root, run({ id: "dup", ended_at: t(1) }), 1);
    const f = readMetrics(root);
    expect(f.runs).toHaveLength(1);
    expect(Object.keys(f.totals.by_workflow)).toEqual([]);
  });
});

// ── concurrency ────────────────────────────────────────────────────────────────────────────────

function spawnAsync(file: string, payload: unknown, e: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    const c = spawn("node", [file], { env: e, stdio: ["pipe", "ignore", "ignore"] });
    c.on("close", (code) => resolve(code ?? -1));
    c.stdin.end(JSON.stringify(payload));
  });
}

describe("two sessions ending at the same time", () => {
  it("24 concurrent SessionEnd hooks lose no record and leave a valid file", async () => {
    const root = await installed({ metrics: { recent_runs: 100 } });
    const N = 24;
    for (let i = 0; i < N; i++) {
      seedSession(root, `c${i}`, {
        log: [disp(t(i), "backend", "x"), hand(t(i) , "backend", "x", "success")],
      });
    }
    const script = path.join(root, ".claude", "scripts", "maestro-session-cleanup.cjs");
    const codes = await Promise.all(
      Array.from({ length: N }, (_, i) => spawnAsync(script, { cwd: root, session_id: `c${i}` }, env(root, null)))
    );
    expect(codes.every((c) => c === 0)).toBe(true);
    const f = readFile(root); // parses => not corrupt
    expect(f.runs).toHaveLength(N);
    expect(new Set(f.runs.map((r) => r.id)).size).toBe(N);
    const dir = path.dirname(metricsPath(root));
    expect(fs.readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect(fs.existsSync(path.join(dir, "lock"))).toBe(false);
  }, 60_000);

  it("concurrent writers past the window still conserve every run (kept + folded == N)", async () => {
    const root = await installed({ metrics: { recent_runs: 5 } });
    const N = 16;
    for (let i = 0; i < N; i++) {
      seedSession(root, `c${i}`, { log: [disp(t(i), "backend", "x"), hand(t(i), "backend", "x", "success")] });
    }
    const script = path.join(root, ".claude", "scripts", "maestro-session-cleanup.cjs");
    await Promise.all(
      Array.from({ length: N }, (_, i) => spawnAsync(script, { cwd: root, session_id: `c${i}` }, env(root, null)))
    );
    const f = readFile(root);
    expect(f.runs).toHaveLength(5);
    expect(f.totals.by_workflow["build"]!.runs).toBe(N - 5);
    expect(f.totals.by_agent["backend"]!.runs).toBe(N - 5);
  }, 60_000);

  it("a stale lock left by a crashed writer is broken and recording proceeds", async () => {
    const root = await installed();
    const dir = path.dirname(metricsPath(root));
    const lock = path.join(dir, "lock");
    fs.mkdirSync(lock, { recursive: true });
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, old, old);
    seedSession(root, "s1", { log: [disp(t(0), "backend", "x"), hand(t(1), "backend", "x", "success")] });
    expect(END(root, "s1").code).toBe(0);
    expect(readFile(root).runs).toHaveLength(1);
    expect(fs.existsSync(lock)).toBe(false);
  });
});

// ── digest ─────────────────────────────────────────────────────────────────────────────────────

describe("the team-meeting evidence digest", () => {
  it("renders recent runs as detail and totals as trends (pure)", () => {
    expect(renderMetricsDigest(emptyMetrics())).toBeNull();
    const base = emptyMetrics();
    const runs = Array.from({ length: 4 }, (_, i) => run({ id: `r${i}`, ended_at: t(i), task: `0${i}-task.md` }));
    const out = compact({ ...base, runs }, 2);
    const md = renderMetricsDigest(out)!;
    expect(md).toContain("Recent runs (2");
    expect(md).toContain("02-task.md");
    expect(md).toContain("03-task.md");
    expect(md).not.toContain("00-task.md");
    expect(md).toContain("by workflow");
    expect(md).toContain("by agent");
    expect(md).toContain("| build | 2 |");
    expect(md).toContain("| backend | 2 |");
  });

  it("`maestro-team-meeting.cjs brief` includes the recent runs and the totals from the real file", async () => {
    const root = await installed({ metrics: { recent_runs: 2 } });
    const sh = (args: string[]) =>
      spawnSync("node", [path.join(PLUGIN_SCRIPTS, "maestro-team-meeting.cjs"), ...args, root], {
        encoding: "utf8",
        env: env(root, "sess-brief"),
      });
    // Render the orchestrator once so `start` does not refuse the project as stale.
    const rendered = spawnSync("node", [path.join(root, ".claude", "scripts", "maestro-render-orchestrator.cjs"), root], {
      encoding: "utf8",
      env: env(root, null),
    });
    expect(rendered.status, rendered.stderr).toBe(0);

    for (let i = 0; i < 4; i++) {
      seedSession(root, `m${i}`, {
        task: `0${i}-digest-task.md`,
        log: [disp(t(i * 10), "backend", "x"), hand(t(i * 10 + 1), "backend", "x", "success")],
      });
      END(root, `m${i}`);
    }
    expect(readFile(root).runs).toHaveLength(2);

    const start = sh(["start", "--mode", "review", "--participants", "backend"]);
    expect(start.status, start.stdout + start.stderr).toBe(0);
    const brief = sh(["brief"]);
    expect(brief.status, brief.stdout + brief.stderr).toBe(0);
    const out = JSON.parse(brief.stdout);
    expect(out.evidence.metrics).toBe(true);
    const text = fs.readFileSync(out.brief, "utf8");
    expect(text).toContain("Run metrics across sessions");
    expect(text).toContain("Recent runs (2");
    expect(text).toContain("02-digest-task.md");
    expect(text).toContain("03-digest-task.md");
    expect(text).toContain("by workflow");
    expect(text).toContain("| build | 2 |"); // the two folded runs
    expect(text).not.toContain("00-digest-task.md"); // folded: task link lost
  });

  it("brief without a metrics file reports metrics:false and still works", async () => {
    const root = await installed();
    spawnSync("node", [path.join(root, ".claude", "scripts", "maestro-render-orchestrator.cjs"), root], { env: env(root, null) });
    const sh = (args: string[]) =>
      spawnSync("node", [path.join(PLUGIN_SCRIPTS, "maestro-team-meeting.cjs"), ...args, root], {
        encoding: "utf8",
        env: env(root, "sess-brief2"),
      });
    expect(sh(["start", "--mode", "review", "--participants", "backend"]).status).toBe(0);
    const brief = sh(["brief"]);
    expect(brief.status, brief.stdout + brief.stderr).toBe(0);
    expect(JSON.parse(brief.stdout).evidence.metrics).toBe(false);
    expect(fs.existsSync(metricsFileFor(root))).toBe(false);
  });
});
