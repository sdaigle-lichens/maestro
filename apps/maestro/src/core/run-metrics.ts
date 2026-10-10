// The durable per-project run-metrics file (`080`).
//
// A session's log.jsonl is deleted at its final SessionEnd, so nothing outlived a session except
// postmortems.log and the `## Post-Mortem` sections in task files. This module keeps one record per
// finished workflow run in <project>/.claude/maestro-metrics/metrics.json, written by the
// SessionEnd hooks (`recordSessionRun`, called BEFORE the session directory is removed).
//
// ── Retention ───────────────────────────────────────────────────────────────────────────────────
// The most recent N runs (`recent_runs` in maestro.json `metrics`, default 10) stay as full
// records in `runs`. A run that falls out of that window is FOLDED into `totals`, keyed by workflow
// and by agent, then dropped. One entry per workflow and per agent bounds the file without a byte
// limit. Folding is lossy by design: a folded run loses its `task` link. Compaction only ever moves
// the oldest overflow, so re-running it changes nothing (`compact` is idempotent).
//
// ── What is NOT here ────────────────────────────────────────────────────────────────────────────
// Post-Mortem prose. A full record only names its task file (`task`); the text stays in that task
// file's `## Post-Mortem` section. No log `output`/`input` text is copied either.
//
// ── Concurrency ─────────────────────────────────────────────────────────────────────────────────
// Two sessions can end at once. Every read-modify-write holds a lock directory (`mkdir` is atomic),
// breaks a lock older than LOCK_STALE_MS, and publishes by write-to-temp + rename, so a reader never
// sees a half-written file and no record is lost to a lost update.
//
// `fs`/`path` only — re-exported from the `maestro-session` bundle, which must stay free of
// `node:sqlite`.

import fs from "node:fs";
import path from "node:path";
import { bareAgentName } from "./success-path.js";
import { mainCheckoutRoot } from "./worktree.js";
import { sessionPathsFor } from "./session-paths.js";

export const METRICS_DIR_NAME = "maestro-metrics";
export const METRICS_FILE_NAME = "metrics.json";
export const DEFAULT_RECENT_RUNS = 10;
const LOCK_STALE_MS = 15_000;
const LOCK_WAIT_MS = 10_000;

export interface LoopBack {
  /** Bare agent whose condition HANDOFF label triggered the loop-back. */
  from: string;
  /** The condition edge's label, as reported in the HANDOFF line. */
  label: string;
  count: number;
}

export interface HumanReviewStop {
  /** Bare agent whose success handoff led into the human_review node. */
  after: string;
  /** approved = a later step ran; changes_requested = an earlier step re-ran; no_decision = nothing followed. */
  outcome: "approved" | "changes_requested" | "no_decision";
}

export interface RunAgent {
  agent: string;
  runs: number;
  success: number;
  failure: number;
  loop_backs: number;
  human_reviews: number;
  duration_ms: number;
  /** Peak recorded ctx_pct across this agent's handoffs, null when none was recorded. */
  ctx_pct: number | null;
}

export interface RunRecord {
  id: string;
  workflow: string;
  /** Bare maestro-task filename, if the run was started for one. Dropped when the run is folded. */
  task: string | null;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  agents: RunAgent[];
  skills: string[];
  /** One entry per agent HANDOFF, in order. */
  handoffs: Array<{ agent: string; label: string }>;
  loop_backs: LoopBack[];
  human_reviews: HumanReviewStop[];
  /** Peak recorded ctx_pct across the run, null when none was recorded. */
  ctx_pct: number | null;
  team_meeting: boolean;
  /** success when the last workflow agent handed off `success`; failure otherwise. */
  outcome: "success" | "failure";
}

/** Running totals for one workflow or one agent. Sums are exact; `avg_*` and `*_rate` derive from them. */
export interface Totals {
  runs: number;
  success: number;
  failure: number;
  loop_backs: number;
  human_reviews: number;
  duration_ms_sum: number;
  ctx_pct_sum: number;
  ctx_runs: number;
  avg_duration_ms: number;
  avg_ctx_pct: number | null;
  loop_back_rate: number;
  human_review_rate: number;
  first_seen: string;
  last_seen: string;
}

export interface MetricsFile {
  version: 1;
  runs: RunRecord[];
  totals: {
    by_workflow: Record<string, Totals>;
    by_agent: Record<string, Totals>;
  };
}

export function emptyMetrics(): MetricsFile {
  return { version: 1, runs: [], totals: { by_workflow: {}, by_agent: {} } };
}

// ── paths ─────────────────────────────────────────────────────────────────────────────────────

/** `<main checkout>/.claude/maestro-metrics/` — one per project, shared by its worktrees. */
export function metricsDirFor(projectRoot: string): string {
  return path.join(mainCheckoutRoot(projectRoot), ".claude", METRICS_DIR_NAME);
}

export function metricsFileFor(projectRoot: string): string {
  return path.join(metricsDirFor(projectRoot), METRICS_FILE_NAME);
}

// ── folding (pure) ─────────────────────────────────────────────────────────────────────────────

function day(ts: string): string {
  return typeof ts === "string" ? ts.slice(0, 10) : "";
}

function derive(t: Totals): Totals {
  t.avg_duration_ms = t.runs ? Math.round(t.duration_ms_sum / t.runs) : 0;
  t.avg_ctx_pct = t.ctx_runs ? Math.round((t.ctx_pct_sum / t.ctx_runs) * 10) / 10 : null;
  t.loop_back_rate = t.runs ? Math.round((t.loop_backs / t.runs) * 1000) / 1000 : 0;
  t.human_review_rate = t.runs ? Math.round((t.human_reviews / t.runs) * 1000) / 1000 : 0;
  return t;
}

function fresh(ts: string): Totals {
  return derive({
    runs: 0,
    success: 0,
    failure: 0,
    loop_backs: 0,
    human_reviews: 0,
    duration_ms_sum: 0,
    ctx_pct_sum: 0,
    ctx_runs: 0,
    avg_duration_ms: 0,
    avg_ctx_pct: null,
    loop_back_rate: 0,
    human_review_rate: 0,
    first_seen: ts,
    last_seen: ts,
  });
}

function add(
  map: Record<string, Totals>,
  key: string,
  seen: string,
  v: {
    runs: number;
    success: number;
    failure: number;
    loop_backs: number;
    human_reviews: number;
    duration_ms: number;
    ctx_pct: number | null;
  }
): void {
  const t = (map[key] ??= fresh(seen));
  t.runs += v.runs;
  t.success += v.success;
  t.failure += v.failure;
  t.loop_backs += v.loop_backs;
  t.human_reviews += v.human_reviews;
  t.duration_ms_sum += v.duration_ms;
  if (v.ctx_pct != null) {
    t.ctx_pct_sum += v.ctx_pct;
    t.ctx_runs += 1;
  }
  if (seen && (!t.first_seen || seen < t.first_seen)) t.first_seen = seen;
  if (seen && seen > t.last_seen) t.last_seen = seen;
  derive(t);
}

/** Fold one full record into the running totals (mutates `totals`). The record's task link is NOT kept. */
export function foldRun(totals: MetricsFile["totals"], run: RunRecord): void {
  const seen = day(run.started_at);
  add(totals.by_workflow, run.workflow, seen, {
    runs: 1,
    success: run.outcome === "success" ? 1 : 0,
    failure: run.outcome === "success" ? 0 : 1,
    loop_backs: run.loop_backs.reduce((n, l) => n + l.count, 0),
    human_reviews: run.human_reviews.length,
    duration_ms: run.duration_ms,
    ctx_pct: run.ctx_pct,
  });
  for (const a of run.agents) {
    add(totals.by_agent, a.agent, seen, {
      runs: a.runs,
      success: a.success,
      failure: a.failure,
      loop_backs: a.loop_backs,
      human_reviews: a.human_reviews,
      duration_ms: a.duration_ms,
      ctx_pct: a.ctx_pct,
    });
  }
}

/**
 * Keep the `keep` most recent runs in full and fold the rest. Pure and idempotent: a file already
 * within the window is returned unchanged, so compacting twice equals compacting once.
 */
export function compact(file: MetricsFile, keep: number): MetricsFile {
  const n = Math.max(1, Math.floor(Number.isFinite(keep) ? keep : DEFAULT_RECENT_RUNS));
  if (file.runs.length <= n) return file;
  const ordered = [...file.runs].sort((a, b) => (a.ended_at < b.ended_at ? -1 : a.ended_at > b.ended_at ? 1 : 0));
  const folded = ordered.slice(0, ordered.length - n);
  const totals = structuredClone(file.totals);
  for (const run of folded) foldRun(totals, run);
  return { version: 1, runs: ordered.slice(ordered.length - n), totals };
}

// ── building a record from a session's log (pure) ────────────────────────────────────────────────

interface LogEntry {
  ts?: string;
  origin?: string;
  kind?: string;
  agent?: string;
  agent_id?: string;
  status?: string;
  label?: string | null;
  meeting?: boolean;
  ctx_pct?: number;
  log?: string;
}

interface CfgLike {
  workflow_instances?: Array<{ name: string; agent: string }>;
  workflows?: Array<{
    name: string;
    nodes: Array<{ id: string; type: string; instance?: string; skill?: string }>;
    edges: Array<{ from: string; to: string; kind: string }>;
  }>;
}

/** Bare agent names along a workflow's success path (human_review / skill nodes skipped), plus the human-review links. */
function successOrder(cfg: CfgLike | null, workflow: string | null) {
  const wf = cfg?.workflows?.find((w) => w.name === workflow);
  const order: string[] = [];
  const reviewAfter: string[] = []; // bare agent preceding each human_review node
  const skillIds = new Set<string>();
  if (!wf) return { order, reviewAfter, skillIds };
  for (const n of wf.nodes ?? []) if (n.type === "skill" && n.skill) skillIds.add(n.skill);
  const agentOf = (id: string): string | null => {
    const n = wf.nodes.find((x) => x.id === id);
    if (!n || n.type !== "agent") return null;
    const inst = cfg?.workflow_instances?.find((i) => i.name === n.instance);
    return bareAgentName(inst?.agent ?? n.instance ?? "") || null;
  };
  let cur = "main-session";
  let lastAgent: string | null = null;
  const seen = new Set<string>();
  while (!seen.has(cur)) {
    seen.add(cur);
    const e = (wf.edges ?? []).find((x) => x.from === cur && x.kind === "success");
    if (!e) break;
    const node = wf.nodes.find((n) => n.id === e.to);
    if (node?.type === "human_review" && lastAgent) reviewAfter.push(lastAgent);
    const a = agentOf(e.to);
    if (a) {
      order.push(a);
      lastAgent = a;
    }
    cur = e.to;
  }
  return { order, reviewAfter, skillIds };
}

/**
 * One RunRecord from a session's parsed log and session.json, or null when the session ran nothing
 * worth recording (no dispatch, no handoff). No log text is copied — only agent names, labels,
 * counts, timestamps and ctx_pct.
 */
export function buildRunRecord(
  entries: unknown[],
  session: { workflow?: string | null; run_id?: string | null; active_task?: string | null } | null,
  cfg: CfgLike | null,
  sessionId: string
): RunRecord | null {
  const log = (entries ?? []).filter((e): e is LogEntry => !!e && typeof e === "object");
  const teamMeeting = log.some((e) => e.meeting === true);
  const dispatches = log.filter((e) => e.kind === "dispatch" && e.meeting !== true);
  const handoffs = log.filter((e) => e.kind === "handoff" && e.meeting !== true);
  const meetingTurns = log.filter((e) => e.kind === "handoff" && e.meeting === true);
  if (dispatches.length === 0 && handoffs.length === 0 && meetingTurns.length === 0) return null;

  const workflow = session?.workflow || "(none)";
  const { order, reviewAfter, skillIds } = successOrder(cfg, session?.workflow ?? null);
  const stamps = log.map((e) => e.ts).filter((t): t is string => typeof t === "string" && !Number.isNaN(Date.parse(t)));
  stamps.sort();
  const started_at = stamps[0] ?? new Date().toISOString();
  const ended_at = stamps[stamps.length - 1] ?? started_at;
  const duration_ms = Math.max(0, Date.parse(ended_at) - Date.parse(started_at));

  const dispatchById = new Map<string, LogEntry>();
  for (const d of dispatches) if (d.agent_id) dispatchById.set(d.agent_id, d);

  const agents = new Map<string, RunAgent>();
  const agentOfRun = (name: string): RunAgent => {
    let a = agents.get(name);
    if (!a) {
      a = {
        agent: name,
        runs: 0,
        success: 0,
        failure: 0,
        loop_backs: 0,
        human_reviews: 0,
        duration_ms: 0,
        ctx_pct: null,
      };
      agents.set(name, a);
    }
    return a;
  };
  for (const d of dispatches) {
    const name = bareAgentName(d.agent ?? "");
    if (name) agentOfRun(name).runs += 1;
  }
  // Meeting-only sessions record the participants so the totals show who took part.
  if (dispatches.length === 0 && handoffs.length === 0) {
    for (const m of meetingTurns) {
      const name = bareAgentName(m.origin ?? "");
      if (name) agentOfRun(name).runs += 1;
    }
  }

  const loopMap = new Map<string, LoopBack>();
  const handoffList: RunRecord["handoffs"] = [];
  const reviews: HumanReviewStop[] = [];
  for (const h of handoffs) {
    const name = bareAgentName(h.origin ?? "");
    if (!name) continue;
    const a = agentOfRun(name);
    const ok = h.status === "success";
    if (ok) a.success += 1;
    else a.failure += 1;
    if (typeof h.ctx_pct === "number") a.ctx_pct = Math.max(a.ctx_pct ?? 0, h.ctx_pct);
    const d = h.agent_id ? dispatchById.get(h.agent_id) : undefined;
    if (d?.ts && h.ts) a.duration_ms += Math.max(0, Date.parse(h.ts) - Date.parse(d.ts)) || 0;
    const label = h.label || (ok ? "success" : "(none)");
    handoffList.push({ agent: name, label });
    if (h.status === "condition" && h.label) {
      a.loop_backs += 1;
      const key = `${name}\u0000${h.label}`;
      const lb = loopMap.get(key) ?? { from: name, label: h.label, count: 0 };
      lb.count += 1;
      loopMap.set(key, lb);
    }
    // A human-review stop: this agent's success handoff leads into a human_review node. The next
    // dispatch tells the outcome — a later success-path step ran (approved) or this step or an
    // earlier one re-ran (changes requested).
    if (ok && reviewAfter.includes(name)) {
      const idx = log.indexOf(h);
      const next = log.slice(idx + 1).find((e) => e.kind === "dispatch" && e.meeting !== true);
      let outcome: HumanReviewStop["outcome"] = "no_decision";
      if (next) {
        const nextPos = order.indexOf(bareAgentName(next.agent ?? ""));
        outcome = nextPos > order.indexOf(name) ? "approved" : "changes_requested";
      }
      reviews.push({ after: name, outcome });
      a.human_reviews += 1;
    }
  }

  const skills = new Set<string>();
  for (const e of log) {
    const m = /^Skill\((.+)\)$/.exec(e.log ?? "");
    if (m && m[1] && skillIds.has(m[1])) skills.add(m[1]);
  }

  const ctxs = log.map((e) => e.ctx_pct).filter((n): n is number => typeof n === "number");
  const last = handoffs[handoffs.length - 1];
  return {
    id: session?.run_id || sessionId,
    workflow,
    task: session?.active_task ? path.basename(session.active_task) : null,
    started_at,
    ended_at,
    duration_ms,
    agents: [...agents.values()],
    skills: [...skills],
    handoffs: handoffList,
    loop_backs: [...loopMap.values()],
    human_reviews: reviews,
    ctx_pct: ctxs.length ? Math.max(...ctxs) : null,
    team_meeting: teamMeeting,
    outcome: last && last.status === "success" ? "success" : "failure",
  };
}

// ── the file (locked, atomic) ──────────────────────────────────────────────────────────────────

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Run `fn` holding the metrics lock. Never throws on contention beyond LOCK_WAIT_MS — then it proceeds. */
function withLock<T>(dir: string, fn: () => T): T {
  fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, "lock");
  const deadline = Date.now() + LOCK_WAIT_MS;
  let held = false;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      held = true;
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") break;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) {
          fs.rmSync(lock, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue; // released between the mkdir and the stat — retry at once
      }
      if (Date.now() > deadline) break;
      sleepSync(15 + Math.floor(Math.random() * 30));
    }
  }
  try {
    return fn();
  } finally {
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
}

/** The metrics file for a project, or an empty one when absent or unreadable. Never throws. */
export function readMetrics(projectRoot: string): MetricsFile {
  try {
    const v = JSON.parse(fs.readFileSync(metricsFileFor(projectRoot), "utf8")) as MetricsFile;
    if (v && v.version === 1 && Array.isArray(v.runs) && v.totals?.by_workflow && v.totals?.by_agent) return v;
  } catch {
    // absent or corrupt — start over from empty
  }
  return emptyMetrics();
}

/** How many full runs to keep: maestro.json `metrics.recent_runs`, else the default. */
export function recentRunsLimit(cfg: unknown): number {
  const n = (cfg as { metrics?: { recent_runs?: unknown } } | null)?.metrics?.recent_runs;
  return typeof n === "number" && Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_RECENT_RUNS;
}

/**
 * Append (or, for a run id already present, replace — a resumed session ends twice) one record,
 * compact, and publish atomically under the lock.
 */
export function recordRun(projectRoot: string, run: RunRecord, keep: number = DEFAULT_RECENT_RUNS): void {
  const dir = metricsDirFor(projectRoot);
  withLock(dir, () => {
    const gi = path.join(dir, ".gitignore");
    if (!fs.existsSync(gi)) fs.writeFileSync(gi, "*\n");
    const file = readMetrics(projectRoot);
    const runs = file.runs.filter((r) => r.id !== run.id);
    runs.push(run);
    const next = compact({ ...file, runs }, keep);
    const target = metricsFileFor(projectRoot);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
    fs.renameSync(tmp, target);
  });
}

/**
 * The SessionEnd entry point: read this session's log + session.json, build its record and store it.
 * Silent no-op when the session has nothing to record or cannot be resolved. Must run BEFORE the
 * session directory is removed.
 */
export function recordSessionRun(projectRoot: string, sessionId: unknown): boolean {
  const claudeDir = path.join(projectRoot, ".claude");
  const paths = sessionPathsFor(claudeDir, sessionId);
  if (!paths) return false;
  let raw: string;
  try {
    raw = fs.readFileSync(paths.log, "utf8");
  } catch {
    return false;
  }
  const entries: unknown[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // a partially written trailing line
    }
  }
  const readJson = (p: string): any => {
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      return null;
    }
  };
  const cfg = readJson(path.join(claudeDir, "maestro.json"));
  const run = buildRunRecord(entries, readJson(paths.state), cfg, paths.id);
  if (!run) return false;
  recordRun(projectRoot, run, recentRunsLimit(cfg));
  return true;
}

// ── digest ───────────────────────────────────────────────────────────────────────────────────────

function mins(ms: number): string {
  return ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}m` : `${Math.round(ms / 1000)}s`;
}

function totalsRow(name: string, t: Totals): string {
  const ctx = t.avg_ctx_pct == null ? "n/a" : `${t.avg_ctx_pct}%`;
  return (
    `| ${name} | ${t.runs} | ${t.success}/${t.failure} | ${Math.round(t.loop_back_rate * 100)}% | ` +
    `${Math.round(t.human_review_rate * 100)}% | ${mins(t.avg_duration_ms)} | ${ctx} | ${t.first_seen} - ${t.last_seen} |`
  );
}

/** Markdown for the team-meeting evidence: recent runs as detail, totals as trends. Null when empty. */
export function renderMetricsDigest(file: MetricsFile): string | null {
  const wf = Object.entries(file.totals.by_workflow);
  const ag = Object.entries(file.totals.by_agent);
  if (file.runs.length === 0 && wf.length === 0) return null;
  const L: string[] = [];
  if (file.runs.length > 0) {
    L.push(`#### Recent runs (${file.runs.length}, newest last)`, "");
    for (const r of file.runs) {
      const loops = r.loop_backs.map((l) => `${l.from}:${l.label} x${l.count}`).join(", ") || "none";
      const reviews = r.human_reviews.map((h) => `after ${h.after}: ${h.outcome}`).join(", ") || "none";
      const ctx = r.ctx_pct == null ? "n/a" : `${r.ctx_pct}%`;
      L.push(
        `- ${r.started_at.slice(0, 10)} \`${r.workflow}\`${r.team_meeting ? " (team meeting)" : ""} - ${r.outcome}, ` +
          `${mins(r.duration_ms)}, peak ctx ${ctx}; agents: ${r.agents.map((a) => `${a.agent} x${a.runs}`).join(", ") || "none"}; ` +
          `loop-backs: ${loops}; human review: ${reviews}` +
          (r.skills.length ? `; skills: ${r.skills.join(", ")}` : "") +
          (r.task ? `; task: \`.claude/maestro-tasks/${r.task}\`` : "")
      );
    }
    L.push("");
  }
  const header = [
    "| | runs | ok/fail | loop-backs per run | human reviews per run | avg duration | avg ctx | seen |",
    "|---|---|---|---|---|---|---|---|",
  ];
  if (wf.length > 0) {
    L.push("#### Totals of older runs, by workflow (folded, cross-session trends)", "", ...header);
    for (const [k, t] of wf) L.push(totalsRow(k, t));
    L.push("");
  }
  if (ag.length > 0) {
    L.push("#### Totals of older runs, by agent", "", ...header);
    for (const [k, t] of ag) L.push(totalsRow(k, t));
    L.push("");
  }
  return L.join("\n");
}
