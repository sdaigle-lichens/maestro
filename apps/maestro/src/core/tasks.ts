// The task queue `/to-maestro-tasks` writes under <project>/.claude/maestro-tasks/.
//
// PORTED FROM apps/ai-tools-manager/src/utils/maestro-tasks.ts. The cascade logic here is kept
// in sync with plugins/maestro/scripts/lib/maestro-tasks.cjs so a close from the UI and
// one from the orchestrator can't disagree about which tasks are ready.

import fs from "node:fs";
import path from "node:path";

import type { MaestroTask, TaskStatus } from "./contracts.js";
export type { MaestroTask, TaskStatus };

const TASKS_SUBDIR = path.join(".claude", "maestro-tasks");
const STATUS_FILE = "status.json";

interface StatusEntry {
  status?: TaskStatus;
  blockedBy?: string[];
}
type StatusMap = Record<string, StatusEntry>;

export function tasksDirFor(projectRoot: string): string {
  return path.join(projectRoot, TASKS_SUBDIR);
}

function parseTitle(content: string, filename: string): string {
  const m = content.match(/^#\s+(.+?)\s*$/m);
  return m ? m[1] : filename.replace(/\.md$/, "");
}

/**
 * Pull the sibling filenames referenced in the "## Blocked by" section. The skill writes them
 * backtick-wrapped (e.g. `002-other-slice.md`); "None" → [].
 */
export function parseBlockedBy(content: string): string[] {
  const start = content.search(/^##\s+Blocked by\s*$/m);
  if (start === -1) return [];
  const rest = content.slice(start);
  const nextHeading = rest.slice(1).search(/^##\s/m);
  const body = nextHeading === -1 ? rest : rest.slice(0, nextHeading + 1);
  const refs = body.match(/`(\d{3}-[\w-]+\.md)`/g) ?? [];
  return Array.from(new Set(refs.map((r) => r.replace(/`/g, ""))));
}

function readStatusMap(dir: string): StatusMap {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(path.join(dir, STATUS_FILE), "utf8"));
    return data && typeof data === "object" ? (data as StatusMap) : {};
  } catch {
    return {};
  }
}

/** Atomic write, sorted keys — a save from either side produces a stable, reviewable diff. */
function writeStatusMap(dir: string, statusMap: StatusMap): void {
  fs.mkdirSync(dir, { recursive: true });
  const ordered: StatusMap = {};
  for (const k of Object.keys(statusMap).sort((a, b) => a.localeCompare(b))) {
    ordered[k] = statusMap[k];
  }
  const target = path.join(dir, STATUS_FILE);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(ordered, null, 2)}\n`);
  fs.renameSync(tmp, target);
}

function listTaskFiles(dir: string): string[] {
  try {
    // Numbered files sort lexicographically into their topological run order.
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function readFileSafe(dir: string, filename: string): string {
  try {
    return fs.readFileSync(path.join(dir, filename), "utf8");
  } catch {
    return "";
  }
}

/**
 * Recompute the full status map from the files on disk plus an authoritative done-set — the
 * single source of cascade logic. A blocker that no longer exists counts as satisfied.
 */
function buildStatusMap(dir: string, files: string[], doneSet: Set<string>): StatusMap {
  const fileSet = new Set(files);
  const out: StatusMap = {};
  for (const filename of files) {
    const blockedBy = parseBlockedBy(readFileSafe(dir, filename));
    out[filename] = {
      status: doneSet.has(filename)
        ? "done"
        : blockedBy.every((b) => doneSet.has(b) || !fileSet.has(b))
          ? "ready"
          : "blocked",
      blockedBy,
    };
  }
  return out;
}

function tasksFromFiles(dir: string, files: string[], statusMap: StatusMap): MaestroTask[] {
  const fileSet = new Set(files);
  const doneSet = new Set(files.filter((f) => statusMap[f]?.status === "done"));

  return files.map((filename) => {
    const content = readFileSafe(dir, filename);
    const entry = statusMap[filename];
    const blockedBy = entry?.blockedBy ?? parseBlockedBy(content);
    let status: TaskStatus;
    if (entry?.status) {
      status = entry.status; // materialized in status.json — read it directly
    } else if (doneSet.has(filename)) {
      status = "done";
    } else {
      status = blockedBy.every((b) => doneSet.has(b) || !fileSet.has(b)) ? "ready" : "blocked";
    }
    return {
      filename,
      relativePath: path.posix.join(".claude", "maestro-tasks", filename),
      title: parseTitle(content, filename),
      blockedBy,
      status,
      content,
    };
  });
}

export function listTasks(projectRoot: string): MaestroTask[] {
  if (!projectRoot) return [];
  const dir = tasksDirFor(projectRoot);
  const files = listTaskFiles(dir);
  return tasksFromFiles(dir, files, readStatusMap(dir));
}

/**
 * Mark one task file done, then recompute the ready/blocked cascade for every task (a dependent
 * whose only blocker just closed flips to ready) and persist to status.json — the same operation
 * `maestro-task-status.cjs done` performs.
 */
export function closeTask(projectRoot: string, filename: string): MaestroTask[] {
  if (!projectRoot) return [];
  const dir = tasksDirFor(projectRoot);
  const files = listTaskFiles(dir);
  const existingStatus = readStatusMap(dir);
  const base = path.basename(filename);
  if (!files.includes(base)) return tasksFromFiles(dir, files, existingStatus);

  const doneSet = new Set(files.filter((f) => existingStatus[f]?.status === "done"));
  doneSet.add(base);
  const statusMap = buildStatusMap(dir, files, doneSet);
  writeStatusMap(dir, statusMap);
  return tasksFromFiles(dir, files, statusMap);
}

export interface TaskQueueTailEvents {
  /** Full task list, re-derived the same way `listTasks` does, on subscribe. */
  init: (tasks: MaestroTask[]) => void;
  /**
   * The full re-derived task list, whenever the on-disk queue changed — a status flip in
   * status.json, a task file's own content, or a new task file appearing in the directory. There
   * is no incremental "entry" event the way the session log has one: a task file can be added,
   * edited or have its status change on any poll, and re-deriving the whole list is what
   * `listTasks` already does and is cheap for a queue this size.
   */
  update: (tasks: MaestroTask[]) => void;
}

/**
 * Watch a project's task queue directory (its .md files AND its status.json) and push the
 * re-derived task list on every change.
 *
 * Polls rather than fs.watch, same reasoning as `tailSessionLog`: a task file is created,
 * rewritten (status.json) and occasionally deleted by several different writers (the orchestrator,
 * `/to-maestro-tasks`, the in-app Close button, a hand edit), and fs.watch's create/append/delete
 * lifecycle is unreliable across those. The poll re-runs `listTasks` — the exact read path used
 * everywhere else — and only pushes when its serialized result changed, so a new task FILE
 * appearing is caught the same way a status change is: both change what `listTasks` returns.
 *
 * Returns an unsubscribe function.
 */
export function tailTasks(projectRoot: string, events: Partial<TaskQueueTailEvents>, intervalMs = 1000): () => void {
  let stopped = false;

  const snapshot = (): MaestroTask[] => listTasks(projectRoot);
  const fingerprint = (tasks: MaestroTask[]): string => JSON.stringify(tasks);

  const initial = snapshot();
  let last = fingerprint(initial);
  events.init?.(initial);

  const timer = setInterval(() => {
    if (stopped) return;
    const tasks = snapshot();
    const next = fingerprint(tasks);
    if (next !== last) {
      last = next;
      events.update?.(tasks);
    }
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
