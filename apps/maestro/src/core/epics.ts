// Epics (`084`): a named group of tasks coordinated by one resumable manager session.
//
//   <main checkout>/.claude/epics/<slug>/
//     EPIC.md          human-readable: goal, scope, decisions. Written once, then edited by hand.
//     state.json       machine-readable: manager session NAME, worker session NAMES, and a log of
//                      report and acknowledgement entries. Never an address, never a task list.
//     inbox/NNN-<task>.md   one durable report per finished task of the epic.
//
// What the module deliberately does NOT hold:
//   - A task list. A task belongs to an epic through the `epic` field of its entry in the task
//     tracker (status.json); `setTaskEpic` in tasks.ts owns that field. The tracker stays the one
//     source of truth, and `showEpic` derives membership from it on every call.
//   - A session address. Addresses are per process and change on restart. Names are stored; a
//     manager or worker finds the live session again by name through the agent listing.
//
// Concurrency: the manager and every worker write here and to the tracker. Every write to
// state.json happens under a short lock directory, reads the file immediately before writing, and
// changes only its own entry (a log append, the manager field, one worker), so a concurrent
// writer's entries survive. `fs`/`path` only: this is bundled for scripts that run under bare node.

import fs from "node:fs";
import path from "node:path";

import { mainCheckoutRoot } from "./worktree.js";
import { readTaskTracker, setTaskEpic, tasksDirFor, type SetEpicResult } from "./tasks.js";
import { readClaims } from "./claims.js";

export const EPICS_DIR = path.join(".claude", "epics");
const EPIC_FILE = "EPIC.md";
const STATE_FILE = "state.json";
const INBOX_DIR = "inbox";
const LOCK_DIR = ".lock";
const LOCK_WAIT_MS = 5000;
const LOCK_STALE_MS = 15000;

export interface EpicWorker {
  /** Session name, as the agent listing reports it. */
  name: string;
  /** The task it was last known to work on, if recorded. */
  task?: string;
  added_at: string;
}

export interface EpicReportEntry {
  kind: "report";
  /** `r001`, `r002`, ... unique within the epic. */
  id: string;
  task: string;
  /** Path of the report file relative to the epic directory. */
  file: string;
  at: string;
  /** Name of the reporting session, when it knew its own. */
  from?: string;
}

export interface EpicAckEntry {
  kind: "ack";
  id: string;
  at: string;
  by?: string;
}

export type EpicLogEntry = EpicReportEntry | EpicAckEntry;

export interface EpicState {
  slug: string;
  created_at: string;
  manager: { name: string; set_at: string } | null;
  workers: EpicWorker[];
  log: EpicLogEntry[];
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isValidEpicSlug(slug: string): boolean {
  return SLUG.test(slug);
}

/** `<main checkout>/.claude/epics/<slug>`, or null for an invalid slug (never a path escape). */
export function epicDirFor(projectRoot: string, slug: string): string | null {
  if (!isValidEpicSlug(slug)) return null;
  return path.join(mainCheckoutRoot(projectRoot), EPICS_DIR, slug);
}

function now(): string {
  return new Date().toISOString();
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Run `fn` while holding the epic's lock directory. A lock older than LOCK_STALE_MS is broken. */
function withLock<T>(dir: string, fn: () => T): T {
  const lock = path.join(dir, LOCK_DIR);
  const start = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS) fs.rmSync(lock, { recursive: true, force: true });
      } catch {
        // released between our mkdir and this stat: retry
      }
      if (Date.now() - start > LOCK_WAIT_MS) throw new Error(`epic is locked by another writer (${lock})`);
      sleepSync(15);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

export function readEpicState(projectRoot: string, slug: string): EpicState | null {
  const dir = epicDirFor(projectRoot, slug);
  if (!dir) return null;
  try {
    const data: unknown = JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), "utf8"));
    if (!data || typeof data !== "object") return null;
    const s = data as Partial<EpicState>;
    return {
      slug,
      created_at: typeof s.created_at === "string" ? s.created_at : "",
      manager: s.manager && typeof s.manager.name === "string" ? s.manager : null,
      workers: Array.isArray(s.workers) ? s.workers : [],
      log: Array.isArray(s.log) ? s.log : [],
    };
  } catch {
    return null;
  }
}

function writeEpicState(dir: string, state: EpicState): void {
  const target = path.join(dir, STATE_FILE);
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(tmp, target);
}

/** Read-modify-write under the lock: `fn` receives the state as it is on disk right now. */
function updateState<T>(projectRoot: string, slug: string, fn: (state: EpicState) => T): T {
  const dir = epicDirFor(projectRoot, slug);
  if (!dir || !fs.existsSync(path.join(dir, STATE_FILE))) throw new Error(`no epic "${slug}"`);
  return withLock(dir, () => {
    const state = readEpicState(projectRoot, slug);
    if (!state) throw new Error(`epic "${slug}" has an unreadable ${STATE_FILE}`);
    const result = fn(state);
    writeEpicState(dir, state);
    return result;
  });
}

export interface CreateEpicOptions {
  goal?: string;
  manager?: string;
}

/** Create the epic directory, its EPIC.md and state.json. Refuses an existing epic or a bad slug. */
export function createEpic(projectRoot: string, slug: string, options: CreateEpicOptions = {}): { dir: string } {
  const dir = epicDirFor(projectRoot, slug);
  if (!dir)
    throw new Error(
      `"${slug}" is not a valid epic name (lowercase letters, digits and dashes, starting with a letter or digit)`
    );
  if (fs.existsSync(path.join(dir, STATE_FILE))) throw new Error(`epic "${slug}" already exists`);
  fs.mkdirSync(path.join(dir, INBOX_DIR), { recursive: true });
  const goal = options.goal?.trim() || "_State the goal of this epic._";
  const epicMd = path.join(dir, EPIC_FILE);
  if (!fs.existsSync(epicMd)) {
    fs.writeFileSync(
      epicMd,
      `# Epic: ${slug}\n\n## Goal\n\n${goal}\n\n## Scope\n\n_What is in and out of this epic._\n\n## Decisions\n\n_Record decisions here as the manager makes them._\n`
    );
  }
  const state: EpicState = {
    slug,
    created_at: now(),
    manager: options.manager ? { name: options.manager, set_at: now() } : null,
    workers: [],
    log: [],
  };
  writeEpicState(dir, state);
  return { dir };
}

export function listEpics(projectRoot: string): string[] {
  try {
    const root = path.join(mainCheckoutRoot(projectRoot), EPICS_DIR);
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(root, e.name, STATE_FILE)))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

export function setManager(projectRoot: string, slug: string, name: string): void {
  updateState(projectRoot, slug, (s) => {
    s.manager = { name, set_at: now() };
  });
}

/** Record (or refresh) a worker session by name. Never stores an address. */
export function addWorker(projectRoot: string, slug: string, name: string, task?: string): void {
  updateState(projectRoot, slug, (s) => {
    const existing = s.workers.find((w) => w.name === name);
    if (existing) {
      if (task) existing.task = task;
    } else {
      s.workers.push({ name, ...(task ? { task } : {}), added_at: now() });
    }
  });
}

export function removeWorker(projectRoot: string, slug: string, name: string): void {
  updateState(projectRoot, slug, (s) => {
    s.workers = s.workers.filter((w) => w.name !== name);
  });
}

/** Link tasks to an epic in the tracker. Names with no task file come back in `missing`. */
export function linkTasks(projectRoot: string, slug: string, tasks: string[]): SetEpicResult {
  if (!readEpicState(projectRoot, slug)) throw new Error(`no epic "${slug}"`);
  return setTaskEpic(projectRoot, tasks, slug);
}

export function unlinkTasks(projectRoot: string, tasks: string[]): SetEpicResult {
  return setTaskEpic(projectRoot, tasks, null);
}

/** The epic a task belongs to, from the tracker; null when it belongs to none. */
export function epicOfTask(projectRoot: string, filename: string): string | null {
  return readTaskTracker(projectRoot)[path.basename(filename)]?.epic ?? null;
}

export interface WrittenReport {
  epic: string;
  id: string;
  /** Absolute path of the report file in the epic's inbox. */
  file: string;
  /** Manager session name to message, or null when none is recorded (the report is saved anyway). */
  manager: string | null;
}

/**
 * The done step's durable report: write `body` into the inbox of the epic `task` belongs to and
 * append a log entry. Returns null when the task belongs to no epic, which is the "behaves exactly
 * as today" case. The file lands whether or not a manager is running, so nothing is lost while it
 * is down; the notification afterwards is only a pointer.
 */
export function writeReport(projectRoot: string, task: string, body: string, from?: string): WrittenReport | null {
  const base = path.basename(task);
  const slug = epicOfTask(projectRoot, base);
  if (!slug) return null;
  const dir = epicDirFor(projectRoot, slug);
  if (!dir || !readEpicState(projectRoot, slug))
    throw new Error(`task "${base}" names epic "${slug}", which does not exist`);
  return updateState(projectRoot, slug, (s) => {
    const used = s.log.filter((e): e is EpicReportEntry => e.kind === "report").map((e) => Number(e.id.slice(1)) || 0);
    const id = `r${String((used.length ? Math.max(...used) : 0) + 1).padStart(3, "0")}`;
    const rel = path.posix.join(INBOX_DIR, `${id}-${base.replace(/\.md$/, "")}.md`);
    const at = now();
    const header = `# Report ${id}: ${base}\n\n- Task: ${base}\n- Written: ${at}\n${from ? `- From session: ${from}\n` : ""}\n`;
    fs.mkdirSync(path.join(dir, INBOX_DIR), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), `${header}${body.trim()}\n`);
    s.log.push({ kind: "report", id, task: base, file: rel, at, ...(from ? { from } : {}) });
    return { epic: slug, id, file: path.join(dir, rel), manager: s.manager?.name ?? null };
  });
}

/** Records an acknowledgement. Idempotent; an unknown report id is an error. */
export function acknowledgeReport(
  projectRoot: string,
  slug: string,
  id: string,
  by?: string
): "acknowledged" | "already" {
  return updateState(projectRoot, slug, (s) => {
    if (!s.log.some((e) => e.kind === "report" && e.id === id)) throw new Error(`epic "${slug}" has no report "${id}"`);
    if (s.log.some((e) => e.kind === "ack" && e.id === id)) return "already";
    s.log.push({ kind: "ack", id, at: now(), ...(by ? { by } : {}) });
    return "acknowledged";
  });
}

/** Reports with no acknowledgement, oldest first. */
export function unacknowledgedReports(state: EpicState): EpicReportEntry[] {
  const acked = new Set(state.log.filter((e) => e.kind === "ack").map((e) => e.id));
  return state.log.filter((e): e is EpicReportEntry => e.kind === "report" && !acked.has(e.id));
}

export interface EpicTaskView {
  filename: string;
  status: string;
  /** Present for a task a live session has claimed. `sessionName` is null for an unnamed claim. */
  running: { sessionId: string; sessionName: string | null } | null;
}

export interface EpicView {
  slug: string;
  dir: string;
  goalFile: string;
  manager: string | null;
  workers: EpicWorker[];
  tasks: EpicTaskView[];
  unacknowledged: Array<EpicReportEntry & { path: string }>;
}

/** The epic with its tasks' statuses (from the tracker, fresh) and who is running each. */
export function showEpic(projectRoot: string, slug: string): EpicView {
  const state = readEpicState(projectRoot, slug);
  const dir = epicDirFor(projectRoot, slug);
  if (!state || !dir) throw new Error(`no epic "${slug}"`);
  const root = mainCheckoutRoot(projectRoot);
  const tracker = readTaskTracker(root);
  const claims = readClaims(root, tasksDirFor(root));
  const tasks: EpicTaskView[] = Object.keys(tracker)
    .filter((f) => tracker[f].epic === slug)
    .sort((a, b) => a.localeCompare(b))
    .map((filename) => {
      const claim = claims.get(filename);
      return {
        filename,
        status: tracker[filename].status ?? "unknown",
        running: claim?.live ? { sessionId: claim.sessionId, sessionName: claim.sessionName ?? null } : null,
      };
    });
  return {
    slug,
    dir,
    goalFile: path.join(dir, EPIC_FILE),
    manager: state.manager?.name ?? null,
    workers: state.workers,
    tasks,
    unacknowledged: unacknowledgedReports(state).map((r) => ({ ...r, path: path.join(dir, r.file) })),
  };
}

/** Plain-text rendering of `showEpic` for a person or a model reading CLI output. */
export function formatEpic(view: EpicView): string {
  const lines = [
    `Epic ${view.slug}`,
    `  goal file: ${view.goalFile}`,
    `  manager:   ${view.manager ?? "(none recorded)"}`,
    `  workers:   ${view.workers.length ? view.workers.map((w) => w.name).join(", ") : "(none recorded)"}`,
    `  tasks (${view.tasks.length}):`,
  ];
  for (const t of view.tasks) {
    const who = t.running
      ? ` — running in session ${t.running.sessionName ? `"${t.running.sessionName}"` : "(unnamed)"}`
      : "";
    lines.push(`    ${t.filename}  [${t.status}]${who}`);
  }
  lines.push(`  unacknowledged reports (${view.unacknowledged.length}):`);
  for (const r of view.unacknowledged) lines.push(`    ${r.id}  ${r.task}  ${r.path}`);
  return lines.join("\n");
}
