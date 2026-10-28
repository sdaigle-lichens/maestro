// Epics (`084`): a named group of tasks coordinated by one resumable manager session.
//
//   <main checkout>/.claude/epics/<slug>/
//     EPIC.md          human-readable: goal, scope, decisions. Written once, then edited by hand.
//     state.json       machine-readable: manager session NAME, worker session NAMES, and a log of
//                      report, note and acknowledgement entries. Never an address, never a task list.
//     inbox/rNNN-<task>.md   one durable report per finished task of the epic.
//     inbox/nNNN-from-<epic>.md   a cross-epic note from another epic's manager (`085`).
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
import { readTaskTracker, setTaskEpic, tasksDirFor, type SetEpicResult, type TrackerEntry } from "./tasks.js";
import { claimSessionName, readClaims } from "./claims.js";
import { readConfig, resolveWorkerModel } from "./config.js";

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

/**
 * A cross-epic note (`085`): another epic's manager telling this epic's manager about something
 * that affects it. Acknowledged exactly like a report; its ids (`n001`, ...) are a separate counter.
 */
export interface EpicNoteEntry {
  kind: "note";
  /** `n001`, `n002`, ... unique within the receiving epic. */
  id: string;
  /** The sending epic's slug. */
  from_epic: string;
  /** Name of the sending session, when it knew its own. */
  from?: string;
  subject?: string;
  /** Path of the note file relative to the epic directory. */
  file: string;
  at: string;
}

export interface EpicAckEntry {
  kind: "ack";
  id: string;
  at: string;
  by?: string;
}

/** Everything that lands in an epic's inbox and waits for an acknowledgement. */
export type EpicInboxEntry = EpicReportEntry | EpicNoteEntry;

export type EpicLogEntry = EpicReportEntry | EpicNoteEntry | EpicAckEntry;

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

export interface EpicSummary {
  slug: string;
  /** Manager session name to message, or null when none is recorded. */
  manager: string | null;
  /** Reports and notes waiting for the manager's acknowledgement. */
  unacknowledged: number;
}

/** Every epic in the project with its manager and inbox backlog: how one manager finds the others. */
export function listEpicSummaries(projectRoot: string): EpicSummary[] {
  return listEpics(projectRoot).flatMap((slug) => {
    const state = readEpicState(projectRoot, slug);
    if (!state) return [];
    return [{ slug, manager: state.manager?.name ?? null, unacknowledged: unacknowledgedReports(state).length }];
  });
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

/**
 * The session name recorded on `task`'s claim, or null when it has no claim or an unnamed one
 * (`113`). `add-worker --task` prefers it over the name the manager typed: the claim's name was
 * filled in by the worker's own CLI from its stored session name.
 */
export function taskClaimName(projectRoot: string, task: string): string | null {
  return claimSessionName(tasksDirFor(mainCheckoutRoot(projectRoot)), path.basename(task));
}

/** The epic a task belongs to, from the tracker; null when it belongs to none. */
export function epicOfTask(projectRoot: string, filename: string): string | null {
  return readTaskTracker(projectRoot)[path.basename(filename)]?.epic ?? null;
}

const INBOX_PREFIX: Record<EpicInboxEntry["kind"], string> = { report: "r", note: "n" };

/** The next id of `kind` in this epic: one past the highest ever used, so an id never repeats. */
function nextInboxId(state: EpicState, kind: EpicInboxEntry["kind"]): string {
  const used = state.log.filter((e) => e.kind === kind).map((e) => Number(e.id.slice(1)) || 0);
  return `${INBOX_PREFIX[kind]}${String((used.length ? Math.max(...used) : 0) + 1).padStart(3, "0")}`;
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
export function writeReport(projectRoot: string, task: string, body: string, sender?: string): WrittenReport | null {
  const base = path.basename(task);
  const slug = epicOfTask(projectRoot, base);
  if (!slug) return null;
  // No sender given: the name the session recorded when it claimed the task (`done` deletes the
  // claim, so the command it prints carries --from; this covers a report written while it exists).
  const root = mainCheckoutRoot(projectRoot);
  const from = sender?.trim() || claimSessionName(tasksDirFor(root), base) || undefined;
  const dir = epicDirFor(projectRoot, slug);
  if (!dir || !readEpicState(projectRoot, slug))
    throw new Error(`task "${base}" names epic "${slug}", which does not exist`);
  return updateState(projectRoot, slug, (s) => {
    const id = nextInboxId(s, "report");
    const rel = path.posix.join(INBOX_DIR, `${id}-${base.replace(/\.md$/, "")}.md`);
    const at = now();
    const header = `# Report ${id}: ${base}\n\n- Task: ${base}\n- Written: ${at}\n${from ? `- From session: ${from}\n` : ""}\n`;
    fs.mkdirSync(path.join(dir, INBOX_DIR), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), `${header}${body.trim()}\n`);
    s.log.push({ kind: "report", id, task: base, file: rel, at, ...(from ? { from } : {}) });
    return { epic: slug, id, file: path.join(dir, rel), manager: s.manager?.name ?? null };
  });
}

/**
 * What `maestro-task-status.cjs done` prints for a task in an epic: the exact report command to run
 * next, naming the epic and its manager. Null for a task in no epic (nothing new is printed).
 * `sessionName` is the claim's session name, read before `done` deletes the claim.
 */
export function reportCommandFor(projectRoot: string, task: string, sessionName?: string | null): string | null {
  const base = path.basename(task);
  const slug = epicOfTask(projectRoot, base);
  if (!slug) return null;
  const manager = readEpicState(projectRoot, slug)?.manager?.name;
  const from = sessionName?.trim() ? ` --from "${sessionName.trim()}"` : "";
  return (
    `Maestro epic: "${base}" belongs to epic "${slug}" (manager: ${manager ? `"${manager}"` : "no manager recorded"}). ` +
    `Your NEXT step is to report to the epic, then message the manager if one is recorded: pipe the report body to\n` +
    `  node .claude/scripts/maestro-epic.cjs report --task "${base}"${from} --file -\n`
  );
}

export interface NoteOptions {
  /** The sending epic. Must exist and differ from the receiver. */
  fromEpic: string;
  /** Name of the sending session. */
  from?: string;
  subject?: string;
}

/** Same shape as a written report: the receiving epic, the note id, its file, the manager to message. */
export type WrittenNote = WrittenReport;

/**
 * A cross-epic note (`085`): write `body` into `toSlug`'s inbox as `inbox/nNNN-from-<fromEpic>.md`
 * and log it, both before returning. Like a report, it lands whether or not the receiving manager
 * is running; the message afterwards is only a pointer, and a resumed manager finds it
 * unacknowledged. Refuses an unknown or invalid receiver, an unknown sender, a note to the sender's
 * own epic, and an empty body.
 */
/**
 * Throws unless a note can go from `fromEpic` to `toSlug`: both exist and they differ. Exported so
 * the CLI can refuse BEFORE it reads a body from stdin, which may be held open.
 */
export function checkNoteRoute(projectRoot: string, toSlug: string, fromEpic: string): void {
  if (!readEpicState(projectRoot, toSlug)) throw new Error(`no epic "${toSlug}" to send a note to`);
  if (!readEpicState(projectRoot, fromEpic)) throw new Error(`no epic "${fromEpic}" to send a note from`);
  if (fromEpic === toSlug) throw new Error(`a note goes to ANOTHER epic; "${toSlug}" is the sender's own`);
}

export function writeNote(projectRoot: string, toSlug: string, body: string, options: NoteOptions): WrittenNote {
  const { fromEpic, from } = options;
  const subject = options.subject?.trim();
  checkNoteRoute(projectRoot, toSlug, fromEpic);
  const dir = epicDirFor(projectRoot, toSlug);
  if (!dir) throw new Error(`no epic "${toSlug}" to send a note to`);
  if (!body.trim()) throw new Error("the note is empty");
  return updateState(projectRoot, toSlug, (s) => {
    const id = nextInboxId(s, "note");
    const rel = path.posix.join(INBOX_DIR, `${id}-from-${fromEpic}.md`);
    const at = now();
    const header =
      `# Note ${id} from epic ${fromEpic}\n\n- From epic: ${fromEpic}\n` +
      `${from ? `- From session: ${from}\n` : ""}${subject ? `- Subject: ${subject}\n` : ""}- Written: ${at}\n\n`;
    fs.mkdirSync(path.join(dir, INBOX_DIR), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), `${header}${body.trim()}\n`);
    s.log.push({
      kind: "note",
      id,
      from_epic: fromEpic,
      ...(from ? { from } : {}),
      ...(subject ? { subject } : {}),
      file: rel,
      at,
    });
    return { epic: toSlug, id, file: path.join(dir, rel), manager: s.manager?.name ?? null };
  });
}

function isInboxEntry(e: EpicLogEntry): e is EpicInboxEntry {
  return e.kind === "report" || e.kind === "note";
}

/** Records an acknowledgement of a report (`rNNN`) or a note (`nNNN`). Idempotent; an unknown id is an error. */
export function acknowledgeReport(
  projectRoot: string,
  slug: string,
  id: string,
  by?: string
): "acknowledged" | "already" {
  return updateState(projectRoot, slug, (s) => {
    if (!s.log.some((e) => isInboxEntry(e) && e.id === id))
      throw new Error(`epic "${slug}" has no report or note "${id}"`);
    if (s.log.some((e) => e.kind === "ack" && e.id === id)) return "already";
    s.log.push({ kind: "ack", id, at: now(), ...(by ? { by } : {}) });
    return "acknowledged";
  });
}

/** Reports and notes with no acknowledgement, oldest first. */
export function unacknowledgedReports(state: EpicState): EpicInboxEntry[] {
  const acked = new Set(state.log.filter((e) => e.kind === "ack").map((e) => e.id));
  return state.log.filter((e): e is EpicInboxEntry => isInboxEntry(e) && !acked.has(e.id));
}

export interface EpicTaskView {
  filename: string;
  status: string;
  /** Present for a task a live session has claimed. `sessionName` is null for an unnamed claim. */
  running: { sessionId: string; sessionName: string | null } | null;
}

/**
 * One `blockedBy` edge crossing this epic's boundary (`085`). `task` is always the blocked task and
 * `blockedBy` its blocker: `blocked-by-other` means this epic's `task` waits on another epic's (or
 * an epic-less) task, `blocks-other` means another epic's `task` waits on one of ours. `otherEpic`
 * is null when the task on the other side belongs to no epic.
 */
export interface CrossEpicEdge {
  task: string;
  blockedBy: string;
  otherEpic: string | null;
  direction: "blocked-by-other" | "blocks-other";
}

export interface EpicView {
  slug: string;
  dir: string;
  goalFile: string;
  manager: string | null;
  workers: EpicWorker[];
  tasks: EpicTaskView[];
  unacknowledged: Array<EpicInboxEntry & { path: string }>;
  crossEpic: CrossEpicEdge[];
}

/**
 * The tracker's `blockedBy` edges with exactly one end in `slug`. An edge whose blocker is already
 * done is no live dependency and is left out, as is a reference to a task the tracker does not know.
 * An edge to a task in no epic is kept (with `otherEpic: null`): nobody manages that side, which is
 * itself worth seeing.
 */
function crossEpicEdges(tracker: Record<string, TrackerEntry>, slug: string): CrossEpicEdge[] {
  const edges: CrossEpicEdge[] = [];
  for (const task of Object.keys(tracker).sort((a, b) => a.localeCompare(b))) {
    const taskEpic = tracker[task].epic ?? null;
    for (const blocker of tracker[task].blockedBy) {
      const other = tracker[blocker];
      if (!other || other.status === "done") continue;
      const blockerEpic = other.epic ?? null;
      if (taskEpic === blockerEpic) continue;
      if (taskEpic === slug)
        edges.push({ task, blockedBy: blocker, otherEpic: blockerEpic, direction: "blocked-by-other" });
      else if (blockerEpic === slug)
        edges.push({ task, blockedBy: blocker, otherEpic: taskEpic, direction: "blocks-other" });
    }
  }
  return edges;
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
    crossEpic: crossEpicEdges(tracker, slug),
  };
}

/** How many workers the manager's spawn step runs at once unless told otherwise (`125`). */
export const DEFAULT_SPAWN_CAP = 5;

/** A task the manager may spawn a worker session for, with the name and command to use. */
export interface SpawnableTask {
  filename: string;
  /** `.claude/maestro-tasks/<filename>`, relative to the main checkout. */
  relativePath: string;
  /** The session name to give the worker (`claude -n`), which its claim and the epic record. */
  worker: string;
  /** The exact launch command, run from the main checkout. */
  command: string;
}

export interface EpicReadyView {
  slug: string;
  /** The main checkout: where every worker is launched. */
  cwd: string;
  cap: number;
  /** Unfinished epic tasks a live session has claimed. */
  running: Array<{ filename: string; sessionName: string | null }>;
  /** Unfinished epic tasks recorded on a worker (add-worker --task) with no live claim yet. */
  pending: Array<{ filename: string; worker: string }>;
  /** Ready (no unfinished blocker), unclaimed and not pending, oldest first. */
  ready: SpawnableTask[];
  /** `cap` minus running and pending, never below 0: how many of `ready` may be spawned now. */
  slots: number;
}

/**
 * The session name a spawned worker gets: `<slug>-<NNN>` from the task's number, else
 * `<slug>-<basename>`. A name given with `claude -n` is kept by the session-name hook (`113`).
 */
export function workerNameFor(slug: string, filename: string): string {
  const base = path.basename(filename).replace(/\.md$/, "");
  const num = /^(\d+)-/.exec(base);
  return `${slug}-${num ? num[1] : base}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * `claude -n <name> [--model <model>] '/maestro .claude/maestro-tasks/<task.md>'`, quoted for a
 * POSIX shell. `model` is the project's `worker_model`; omitted or blank leaves the command as it
 * was before the setting existed.
 */
export function launchCommandFor(name: string, filename: string, model?: string): string {
  const rel = path.posix.join(".claude", "maestro-tasks", path.basename(filename));
  const flag = model?.trim() ? ` --model ${shellQuote(model.trim())}` : "";
  return `claude -n ${shellQuote(name)}${flag} ${shellQuote(`/maestro ${rel}`)}`;
}

/**
 * The manager's spawn list (`125`): the epic's tasks that are ready and that no session has
 * claimed. Ready means the tracker says `ready` AND every blocker the tracker knows is done, so a
 * stale `ready` never spawns a blocked task. A task recorded on a worker but not claimed yet is
 * `pending`, not ready: the worker was spawned and has not started, or its claim aged out while it
 * waits on the user. Listing it as ready would spawn a second worker for it. Done tasks are never
 * listed anywhere.
 */
export function readyTasks(projectRoot: string, slug: string, cap: number = DEFAULT_SPAWN_CAP): EpicReadyView {
  const state = readEpicState(projectRoot, slug);
  if (!state) throw new Error(`no epic "${slug}"`);
  if (!Number.isInteger(cap) || cap < 1) throw new Error(`the cap must be a whole number of at least 1, not "${cap}"`);
  const root = mainCheckoutRoot(projectRoot);
  const tracker = readTaskTracker(root);
  const claims = readClaims(root, tasksDirFor(root));
  const model = resolveWorkerModel(readConfig(root));
  const workerOf = new Map<string, string>();
  for (const w of state.workers) if (w.task) workerOf.set(path.basename(w.task), w.name);

  const view: EpicReadyView = { slug, cwd: root, cap, running: [], pending: [], ready: [], slots: 0 };
  const own = Object.keys(tracker)
    .filter((f) => tracker[f].epic === slug && tracker[f].status !== "done")
    .sort((a, b) => a.localeCompare(b));
  for (const filename of own) {
    const claim = claims.get(filename);
    if (claim?.live) {
      view.running.push({ filename, sessionName: claim.sessionName ?? null });
      continue;
    }
    const worker = workerOf.get(filename);
    if (worker) {
      view.pending.push({ filename, worker });
      continue;
    }
    const entry = tracker[filename];
    const unblocked = entry.blockedBy.every((b) => !tracker[b] || tracker[b].status === "done");
    if (entry.status !== "ready" || !unblocked) continue;
    const name = workerNameFor(slug, filename);
    view.ready.push({
      filename,
      relativePath: path.posix.join(".claude", "maestro-tasks", filename),
      worker: name,
      command: launchCommandFor(name, filename, model),
    });
  }
  view.slots = Math.max(0, cap - view.running.length - view.pending.length);
  return view;
}

/** Plain-text rendering of `readyTasks`: what to spawn now, what waits for a free slot. */
export function formatReady(view: EpicReadyView): string {
  const lines = [
    `Epic ${view.slug}: ${view.ready.length} ready, unclaimed task(s); ${view.running.length} running, ` +
      `${view.pending.length} spawned but not claimed yet; cap ${view.cap}, ${view.slots} slot(s) free`,
    `  launch from: ${view.cwd}`,
  ];
  view.ready.forEach((t, i) => {
    const tag = i < view.slots ? "spawn" : "waits for a slot";
    lines.push(`  ${t.filename}  worker "${t.worker}"  [${tag}]`, `    ${t.command}`);
  });
  for (const r of view.running)
    lines.push(`  ${r.filename}  running in session ${r.sessionName ? `"${r.sessionName}"` : "(unnamed)"}`);
  for (const p of view.pending) lines.push(`  ${p.filename}  spawned as "${p.worker}", not claimed yet`);
  return lines.join("\n");
}

/** One unacknowledged inbox line, as `formatEpic` and the CLI's `reports` print it. */
export function formatInboxEntry(entry: EpicInboxEntry & { path: string }): string {
  if (entry.kind === "note")
    return `${entry.id}  from epic ${entry.from_epic}${entry.from ? ` (${entry.from})` : ""}  ${entry.path}`;
  return `${entry.id}  ${entry.task}  ${entry.path}`;
}

function formatCrossEpicEdge(edge: CrossEpicEdge): string {
  const other = edge.otherEpic ? `epic ${edge.otherEpic}` : "no epic";
  return edge.direction === "blocked-by-other"
    ? `${edge.task}  blocked by ${edge.blockedBy} (${other})`
    : `${edge.blockedBy}  blocks ${edge.task} (${other})`;
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
  lines.push(`  unacknowledged reports and notes (${view.unacknowledged.length}):`);
  for (const r of view.unacknowledged) lines.push(`    ${formatInboxEntry(r)}`);
  lines.push(`  cross-epic dependencies (${view.crossEpic.length}):`);
  for (const e of view.crossEpic) lines.push(`    ${formatCrossEpicEdge(e)}`);
  return lines.join("\n");
}
