// Agent channels (`036`) — the runtime replacement for forwarding a `handoff_details` payload
// through the orchestrator's own context. A sender writes a body to the RECEIVING agent's lane;
// `SubagentStart` inlines it when that agent is next invoked, in the same run. See
// `.claude/maestro-tasks/036-move-handoff-payloads-onto-agent-channels.md` for the design.
//
// Scoped lanes (`144`): every channel file belongs to exactly ONE scope, and only the session that
// owns that scope reads, writes, retires, sweeps (outright), lists as pending, resumes or
// gap-acknowledges it. Before `144` lanes were keyed by receiver and sender alone, so two
// concurrent sessions (the main checkout and a git worktree, which deliberately shares the main
// checkout's `.claude/channels/`) injected each other's payloads — task 045's `test/backend.1.md`
// reached 048's @test.
//
//   .claude/channels/
//     <scope>/                      ← `task-<NNN>` (a session running task NNN) or `session-<id8>`
//       <receiver>/
//         <sender>.1.md             ← written by the sender, stamped by ITS OWN SubagentStop
//       .consumed/
//         <receiver>/
//           <sender>.1.md           ← retired here by SubagentStart once delivered, never deleted
//     <receiver>/                   ← LEGACY (pre-`144`): never delivered, resumed or acknowledged;
//     .consumed/                       reported stranded by `pendingLanes`, aged out by `sweep`
//
// The scope is resolved by hooks and scripts only (`channelScopeOf`), never by an agent: an agent is
// told the exact scoped file to write by the injected route text (`payloadRoutes`).
//
// `fs` and `path` only, on purpose — this is re-exported from `plugin-entries/maestro-session.ts`,
// the bundle every copied hook `require`s UNCONDITIONALLY, and that bundle must stay free of
// `node:sqlite` (see that file's header). Nothing here touches a database.
//
// A channel file's first line is its stamp — see `formatStampedContent`/`parseStampedContent` —
// written once, by the RECEIVER'S SENDER'S OWN `SubagentStop`, never by the agent itself: asking a
// subagent to look up and write a correct `run_id` is a protocol it will get wrong silently, the
// way it already omits `skillsTriage`. The stamp stays the WITHIN-scope freshness check.

import fs from "node:fs";
import path from "node:path";
import { readSession } from "./session-runtime.js";
import { isValidSessionId, listSessionIds, sessionPathsFor } from "./session-paths.js";
import type { PendingLane } from "./contracts.js";

/** How long a lane file may sit unconsumed before `sweep` removes it. */
export const CHANNEL_AGE_CAP_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * How long a task claim (`066`) may sit with no fresh write to its session's `log.jsonl` before it
 * is treated as dead — a crashed session's claim reclaimable with no user action, the same way a
 * clean `SessionEnd` deletion (the whole directory gone) reads as dead immediately. Named once and
 * placed beside `CHANNEL_AGE_CAP_MS` on purpose: both cap an ephemeral file's `mtime` against
 * "still alive", and both need to reach `maestro-session.cjs` without pulling in `node:sqlite`.
 */
export const CLAIM_IDLE_CAP_MS = 15 * 60 * 1000;

/**
 * How often the session heartbeat (`141`, `session-heartbeat.ts`) touches the session's
 * `heartbeat` file while the Claude Code process that started it is alive. Overridable for tests
 * through {@link HEARTBEAT_INTERVAL_ENV}.
 */
export const HEARTBEAT_INTERVAL_MS = 60 * 1000;

/**
 * A session whose `heartbeat` file exists but is older than this is DEAD for claims and the
 * worktree decision, however fresh its `log.jsonl` is (`141`). Three missed ticks of
 * {@link HEARTBEAT_INTERVAL_MS}: a closed or crashed session frees its claim within about a minute
 * (the heartbeat zeroes the file when it sees its parent gone) or at most this long (the heartbeat
 * itself was killed). A session with NO heartbeat file falls back to the `CLAIM_IDLE_CAP_MS` log
 * rule, so a project whose runtime predates the heartbeat keeps the old behaviour.
 */
export const HEARTBEAT_STALE_MS = 3 * 60 * 1000;

/** Environment variable overriding {@link HEARTBEAT_INTERVAL_MS} (milliseconds), for tests. */
export const HEARTBEAT_INTERVAL_ENV = "MAESTRO_HEARTBEAT_INTERVAL_MS";

const CHANNELS_DIR_NAME = "channels";
const CONSUMED_DIR_NAME = ".consumed";
/** The scribe's lane — the only one whose skill-gap reports outlive their delivery (`112`). */
const SCRIBE_LANE = "scribe";

/**
 * The scope of a session with no resolvable session id. Such a session has no `run_id` either, so
 * nothing in it is ever inlined (every file is only mentioned) — sharing this one scope between
 * id-less sessions cannot deliver a payload into the wrong run.
 */
export const NO_SESSION_SCOPE = "session-none";

/** `task-<digits>` or `session-<up to 8 id chars>` — the only directory names that are scopes. */
const SCOPE_RE = /^(?:task-\d+|session-[A-Za-z0-9_-]{1,8})$/;
const TASK_PREFIX_RE = /^(\d+)/;

/** Is `name` a channel scope directory name (as opposed to a legacy receiver dir or `.consumed`)? */
export function isChannelScope(name: unknown): name is string {
  return typeof name === "string" && SCOPE_RE.test(name);
}

/**
 * The channel scope for a parsed `session.json` and its session id — pure. `task-<NNN>` when the
 * state records an `active_task` whose filename starts with digits (the claimed task), else
 * `session-<first 8 chars of the id>`, else {@link NO_SESSION_SCOPE} when the id is not valid.
 */
export function channelScopeFromState(state: unknown, sessionId: unknown): string {
  const task = state && typeof state === "object" ? (state as { active_task?: unknown }).active_task : undefined;
  if (typeof task === "string") {
    const m = TASK_PREFIX_RE.exec(path.basename(task));
    if (m) return `task-${m[1]}`;
  }
  return isValidSessionId(sessionId) ? `session-${sessionId.slice(0, 8)}` : NO_SESSION_SCOPE;
}

/**
 * The channel scope session `sessionId` owns in `projectDir` (`144`): `task-<NNN>` when its
 * `session.json` (followed through a worktree pointer, `074`) has a claimed `active_task`, else
 * `session-<id8>`. The one place a hook or script decides which lanes are its own.
 */
export function channelScopeOf(projectDir: string, sessionId: unknown): string {
  const paths = sessionPathsFor(path.join(projectDir, ".claude"), sessionId);
  return channelScopeFromState(paths ? readSession(paths.state) : null, sessionId);
}

function assertScope(scope: string): void {
  if (!isChannelScope(scope)) throw new Error(`not a channel scope: ${JSON.stringify(scope)}`);
}

/** `<projectDir>/.claude/channels` — never used directly for I/O outside this module. */
function channelsRoot(projectDir: string): string {
  return path.join(projectDir, ".claude", CHANNELS_DIR_NAME);
}

function scopeRoot(projectDir: string, scope: string): string {
  assertScope(scope);
  return path.join(channelsRoot(projectDir), scope);
}

/** The directory a sender writes into and `SubagentStart` reads for one receiver, in one scope. */
export function channelDir(projectDir: string, scope: string, receiver: string): string {
  return path.join(scopeRoot(projectDir, scope), receiver);
}

/** Where a retired (delivered) file for `receiver` lands in `scope` — never deleted, only aged out. */
export function consumedDir(projectDir: string, scope: string, receiver: string): string {
  return path.join(scopeRoot(projectDir, scope), CONSUMED_DIR_NAME, receiver);
}

/** Project-relative path of a lane file — the form agents and the orchestrator are shown. */
export function channelRelPath(scope: string, receiver: string, fileName: string): string {
  return `.claude/${CHANNELS_DIR_NAME}/${scope}/${receiver}/${fileName}`;
}

/**
 * The path a `sender` writes its payload for `receiver` to, in `scope`. Always `.1.md` — the seed
 * bodies tell an agent to write there literally; there is no multi-file protocol for one
 * sender/receiver pair in this slice, so a second write simply overwrites the first (a stale,
 * undelivered file being clobbered by a fresher one from the same sender is the desired behaviour,
 * not a bug). The one exception (`112`): `writeStamp` moves a stamped scribe-lane gap report off
 * this slot to `<sender>.<n>.md`, because an unhandled gap must survive the sender's next one.
 */
export function laneFor(projectDir: string, scope: string, sender: string, receiver: string): string {
  return path.join(channelDir(projectDir, scope, receiver), `${sender}.1.md`);
}

const STAMP_RE = /^<!-- maestro:run_id=([^\s>]+) -->\n/;

/**
 * An unstamped channel file as it stood at one moment — enough to tell, later, whether it has been
 * rewritten since. See `unstampedFilesOf` and `writeStamp`'s `skip`.
 */
export interface ChannelFileMark {
  path: string;
  mtimeMs: number;
  size: number;
}

/** Prefix `body` with its run stamp. */
export function formatStampedContent(body: string, runId: string): string {
  return `<!-- maestro:run_id=${runId} -->\n${body}`;
}

/** Split a channel file's raw content into its stamp (null if never stamped) and body. */
export function parseStampedContent(content: string): { runId: string | null; body: string } {
  const m = STAMP_RE.exec(content);
  return m ? { runId: m[1], body: content.slice(m[0].length) } : { runId: null, body: content };
}

/** The bare sender name a channel filename encodes — the part before its first `.`. */
function senderOf(fileName: string): string {
  const i = fileName.indexOf(".");
  return i === -1 ? fileName : fileName.slice(0, i);
}

function listDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== CONSUMED_DIR_NAME)
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function listFiles(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * Stamp every unstamped file under every receiver's lane IN `scope` whose filename SENDER segment
 * matches `sender` — called by `sender`'s OWN `SubagentStop`, never anyone else's, which is what
 * keeps two parallel subagents from stamping each other's writes; and since `144` only in the
 * stopping session's own scope, which is what keeps a concurrent session's same-named sender's
 * write from being adopted. Already-stamped files are left untouched (idempotent, and never
 * overwrites a stamp a differently-timed run already wrote). Returns the absolute paths it stamped.
 *
 * `skip` is the session's `meeting_leftovers` (see `meeting-mode.ts` `closeMeeting`): the
 * unstamped lane files a team meeting's participants had left when the meeting ended (a Bash write
 * the write guard cannot see), recorded by `unstampedFilesOf`. A file still exactly as it was then
 * — same path, mtime and size — is left unstamped: the `run_id` lasts the whole session, and
 * without this the sender's next workflow SubagentStop would adopt the leftover as a payload of the
 * current run. A file a later run rewrote changes mtime or size and is stamped as usual. Comparing
 * a snapshot, not a timestamp, keeps this independent of clock and mtime granularity. No `skip` =
 * every unstamped file of `sender` is stamped, the behaviour outside meetings.
 */
export function writeStamp(
  projectDir: string,
  scope: string,
  sender: string,
  runId: string,
  opts: { skip?: readonly ChannelFileMark[] | null } = {}
): string[] {
  if (!isChannelScope(scope)) return [];
  const stamped: string[] = [];
  const skip = new Map((opts.skip ?? []).map((m) => [m.path, m]));
  for (const receiver of listDirs(scopeRoot(projectDir, scope))) {
    const dir = channelDir(projectDir, scope, receiver);
    for (const fileName of listFiles(dir)) {
      if (senderOf(fileName) !== sender) continue;
      const filePath = path.join(dir, fileName);
      let content: string;
      try {
        const before = skip.get(filePath);
        if (before) {
          const st = fs.statSync(filePath);
          if (st.mtimeMs === before.mtimeMs && st.size === before.size) continue;
        }
        content = fs.readFileSync(filePath, "utf8");
      } catch {
        continue;
      }
      if (STAMP_RE.test(content)) continue;
      fs.writeFileSync(filePath, formatStampedContent(content, runId));
      // `112`: a scribe-lane gap report survives delivery until a scribe acknowledges it, so it
      // must not stay on the `<sender>.1.md` write slot — the sender's next gap is written to that
      // literal path and would clobber an unhandled one. Move it to the next free `<sender>.<n>.md`.
      if (receiver === SCRIBE_LANE && hasGapBlock(content)) {
        const dest = nextFreeLanePath(dir, sender);
        try {
          fs.renameSync(filePath, dest);
          stamped.push(dest);
          continue;
        } catch {
          // Left at the write slot — still stamped, still a gap.
        }
      }
      stamped.push(filePath);
    }
  }
  return stamped;
}

/** `<dir>/<sender>.<n>.md` for the lowest `n >= 2` not already taken — `.1.md` is the write slot. */
function nextFreeLanePath(dir: string, sender: string): string {
  for (let n = 2; ; n++) {
    const candidate = path.join(dir, `${sender}.${n}.md`);
    if (!fs.existsSync(candidate)) return candidate;
  }
}

const FENCED_JSON_RE = /```json[^\n]*\n([\s\S]*?)```/g;

/**
 * Whether `body` holds a fenced `json` block whose TOP-LEVEL object carries a NON-EMPTY
 * `skill_gaps` array (or the legacy `concept_skill_gaps`). An empty array is the seeded
 * reviewer/refactor → scribe shape with nothing to report, so it stays an ordinary deliver-once
 * payload. The gap format is maestro's own: nothing here reads the entries themselves — in
 * particular never a gap's `missing` text, which another tool writes.
 */
function hasGapBlock(body: string): boolean {
  for (const m of body.matchAll(FENCED_JSON_RE)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1]);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const obj = parsed as Record<string, unknown>;
    if (isNonEmptyArray(obj.skill_gaps) || isNonEmptyArray(obj.concept_skill_gaps)) return true;
  }
  return false;
}

function isNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

/**
 * `112`: whether a lane entry is a skill-gap report — in the scribe's lane, with a gap block (see
 * `hasGapBlock`). Such an entry is inlined to every scribe IN ITS SCOPE (`144`) and never retired on
 * delivery; only a scribe's `SKILL_GAPS_HANDLED:` line (`acknowledgeGaps`) or `sweep`'s age cap
 * removes it.
 */
export function isGapReport(entry: ChannelEntry): boolean {
  return path.basename(path.dirname(entry.path)) === SCRIBE_LANE && hasGapBlock(entry.body);
}

const GAPS_HANDLED_RE = /^[ \t]*SKILL_GAPS_HANDLED:(.*)$/gm;

/**
 * The gap files a scribe's final message acknowledges: every `SKILL_GAPS_HANDLED: a.2.md, b.3.md`
 * line, split on commas and trimmed. Empty when there is no such line.
 */
export function parseGapsHandled(finalMessage: string): string[] {
  const names: string[] = [];
  for (const m of (finalMessage ?? "").matchAll(GAPS_HANDLED_RE)) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim();
      if (name && !names.includes(name)) names.push(name);
    }
  }
  return names;
}

/**
 * Retire the named scribe-lane gap reports IN `scope` to `<scope>/.consumed/scribe/` and return what
 * was retired. A name that is path-shaped, no longer in the lane, not a gap report, or only present
 * in another scope's lane is skipped silently — a scribe repeating its ack, or naming an ordinary
 * payload, is not an error.
 */
export function acknowledgeGaps(projectDir: string, scope: string, fileNames: readonly string[]): ChannelEntry[] {
  if (!isChannelScope(scope)) return [];
  const wanted = new Set(
    fileNames.filter((n) => n && n === path.basename(n) && !n.includes("\\") && n !== "." && n !== "..")
  );
  if (wanted.size === 0) return [];
  const retired: ChannelEntry[] = [];
  for (const entry of readLane(projectDir, scope, SCRIBE_LANE)) {
    if (!wanted.has(entry.fileName) || !isGapReport(entry)) continue;
    try {
      retire(projectDir, scope, SCRIBE_LANE, entry);
      retired.push(entry);
    } catch {
      // Left in the lane: delivered again to the next scribe, which can acknowledge it then.
    }
  }
  return retired;
}

/**
 * Every UNSTAMPED file under any receiver's lane IN `scope` whose sender segment is `sender`, as it
 * stands now. Taken by `closeMeeting` for each participant when a team meeting ends; stored as the
 * session's `meeting_leftovers`, which SubagentStop passes to `writeStamp` as `skip`.
 */
export function unstampedFilesOf(projectDir: string, scope: string, sender: string): ChannelFileMark[] {
  if (!isChannelScope(scope)) return [];
  const out: ChannelFileMark[] = [];
  for (const receiver of listDirs(scopeRoot(projectDir, scope))) {
    const dir = channelDir(projectDir, scope, receiver);
    for (const fileName of listFiles(dir)) {
      if (senderOf(fileName) !== sender) continue;
      const filePath = path.join(dir, fileName);
      try {
        const st = fs.statSync(filePath);
        if (STAMP_RE.test(fs.readFileSync(filePath, "utf8"))) continue;
        out.push({ path: filePath, mtimeMs: st.mtimeMs, size: st.size });
      } catch {
        // Gone or unreadable — nothing to protect.
      }
    }
  }
  return out;
}

/** One file sitting in a receiver's lane, whether or not it is deliverable this run. */
export interface ChannelEntry {
  sender: string;
  fileName: string;
  /** Absolute path, still in the lane (not yet retired). */
  path: string;
  /** `null` for a file killed between the write and its sender's `SubagentStop`. */
  runId: string | null;
  ageMs: number;
  body: string;
}

function readDirEntries(dir: string, now: number): ChannelEntry[] {
  const out: ChannelEntry[] = [];
  for (const fileName of listFiles(dir)) {
    const filePath = path.join(dir, fileName);
    let stat: fs.Stats;
    let content: string;
    try {
      stat = fs.statSync(filePath);
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      continue;
    }
    const { runId, body } = parseStampedContent(content);
    out.push({ sender: senderOf(fileName), fileName, path: filePath, runId, ageMs: now - stat.mtimeMs, body });
  }
  return out;
}

/**
 * Every file currently sitting in `receiver`'s lane IN `scope` — delivered and non-delivered alike.
 * Another scope's lane, and a legacy unscoped `<receiver>/` dir, are never read. `[]` for a value
 * that is not a scope.
 */
export function readLane(
  projectDir: string,
  scope: string,
  receiver: string,
  now: number = Date.now()
): ChannelEntry[] {
  if (!isChannelScope(scope)) return [];
  return readDirEntries(channelDir(projectDir, scope, receiver), now);
}

/**
 * Move a delivered entry to `.claude/channels/<scope>/.consumed/<receiver>/` — by rename, never
 * delete, so a delivered-but-then-failed agent's payload is recoverable for `CHANNEL_AGE_CAP_MS`
 * rather than gone. Never call this for an entry `readLane` did not just return for the same
 * `scope`; it assumes the file is still where that call found it.
 */
export function retire(projectDir: string, scope: string, receiver: string, entry: ChannelEntry): void {
  const dest = consumedDir(projectDir, scope, receiver);
  fs.mkdirSync(dest, { recursive: true });
  fs.renameSync(entry.path, path.join(dest, entry.fileName));
}

export interface SweepResult {
  removed: string[];
}

/**
 * An emptied directory is removed only once nothing has touched it for this long, so a sweep can
 * never pull a folder out from under an agent's Write that created it a moment ago.
 */
const EMPTY_DIR_GRACE_MS = 60 * 60 * 1000;

/** Remove every file in `dir` older than the cap (or every file, with `all`), pushing to `removed`. */
function sweepFiles(dir: string, now: number, ageCapMs: number, all: boolean, removed: string[]): void {
  for (const fileName of listFiles(dir)) {
    const filePath = path.join(dir, fileName);
    if (!all) {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }
      if (now - stat.mtimeMs <= ageCapMs) continue;
    }
    try {
      fs.rmSync(filePath, { force: true });
      removed.push(filePath);
    } catch {
      // Not worth failing SessionEnd over.
    }
  }
}

/** `rmdir` `dir` when it is empty and untouched for {@link EMPTY_DIR_GRACE_MS}. Never recursive. */
function pruneEmptyDir(dir: string, now: number): void {
  try {
    if (fs.readdirSync(dir).length > 0) return;
    if (now - fs.statSync(dir).mtimeMs <= EMPTY_DIR_GRACE_MS) return;
    fs.rmdirSync(dir);
  } catch {
    // Not empty after all, gone, or unreadable — leave it.
  }
}

/** Sweep a `<…>/.consumed/` dir: every receiver's files (all, or aged), then prune emptied dirs. */
function sweepConsumed(consumedRoot: string, now: number, ageCapMs: number, all: boolean, removed: string[]): void {
  for (const receiver of listDirs(consumedRoot)) {
    const dir = path.join(consumedRoot, receiver);
    sweepFiles(dir, now, ageCapMs, all, removed);
    pruneEmptyDir(dir, now);
  }
  pruneEmptyDir(consumedRoot, now);
}

/**
 * `SessionEnd`'s replacement for the old flush. With `scope` (the ending session's own, `144`):
 * retire that scope's `.consumed/` outright — never another scope's. Then, across EVERY scope and
 * the legacy unscoped layout, age out anything past `ageCapMs` — in a live lane (including a lane
 * nothing has ever drained, the scribe's when no scribe ran) or in a `.consumed/`. Age-out is safe
 * across scopes because it depends on nothing but the file's age. Never touches a lane file inside
 * the cap, delivered or not. Directories emptied long enough ago are pruned.
 */
export function sweep(
  projectDir: string,
  opts: { now?: number; ageCapMs?: number; scope?: string | null } = {}
): SweepResult {
  const now = opts.now ?? Date.now();
  const ageCapMs = opts.ageCapMs ?? CHANNEL_AGE_CAP_MS;
  const removed: string[] = [];
  const root = channelsRoot(projectDir);
  const own = isChannelScope(opts.scope) ? opts.scope : null;

  for (const name of listDirs(root)) {
    const dir = path.join(root, name);
    if (isChannelScope(name)) {
      sweepConsumed(path.join(dir, CONSUMED_DIR_NAME), now, ageCapMs, name === own, removed);
      for (const receiver of listDirs(dir)) {
        const laneDir = path.join(dir, receiver);
        sweepFiles(laneDir, now, ageCapMs, false, removed);
        pruneEmptyDir(laneDir, now);
      }
    } else {
      // Legacy (pre-`144`) unscoped `<receiver>/` lane: never delivered, only aged out.
      sweepFiles(dir, now, ageCapMs, false, removed);
    }
    pruneEmptyDir(dir, now);
  }
  // Legacy root `.consumed/`: aged out like a lane — no session owns it any more.
  sweepConsumed(path.join(root, CONSUMED_DIR_NAME), now, ageCapMs, false, removed);

  return { removed };
}

/**
 * Every `run_id` a live session directory currently holds (`064`). A lane file is "in flight" if it
 * belongs to ANY session running against this project, not just one — before `064` there could only
 * ever be one, so this read was a single file. An empty set means no session is active, which is
 * the honest answer for a window that opens between sessions.
 */
function liveRunIds(projectDir: string): Set<string> {
  const claudeDir = path.join(projectDir, ".claude");
  const ids = new Set<string>();
  for (const sessionId of listSessionIds(claudeDir)) {
    const state = sessionPathsFor(claudeDir, sessionId)?.state;
    const runId = readSession(state ?? null).run_id;
    if (runId) ids.add(runId);
  }
  return ids;
}

/**
 * Every receiver lane holding at least one undelivered file, right now — the `/maestro` Channels
 * block's one round trip (`037`). READ-ONLY: unlike `writeStamp`/`retire`/`sweep`, this never
 * touches disk. It does not even mint a `run_id` — that is `ensureSessionRunId`'s job, reserved for
 * a live hook mid-run; the app reads whatever the live sessions' `session.json` files already hold.
 *
 * Each lane carries its `scope` (`144`); `opts.scope` narrows the answer to that one scope, so a
 * session never sees another scope's backlog as its own. A legacy unscoped lane is reported with
 * `scope: null` (only when no scope filter is given) and is ENTIRELY stranded — it is never
 * delivered again.
 *
 * `current`/`stranded` split on that read, not on age: no live `run_id` at all means every entry
 * reads as `stranded`, which is correct — with no session running, nothing is "in flight".
 */
export function pendingLanes(
  projectDir: string,
  now: number = Date.now(),
  opts: { scope?: string | null } = {}
): PendingLane[] {
  const runIds = liveRunIds(projectDir);
  const root = channelsRoot(projectDir);
  const only = opts.scope ?? null;
  const lanes: PendingLane[] = [];
  const push = (scope: string | null, receiver: string, entries: ChannelEntry[], current: number) => {
    if (entries.length === 0) return;
    lanes.push({
      scope,
      receiver,
      count: entries.length,
      oldestAgeMs: Math.max(...entries.map((e) => e.ageMs)),
      current,
      stranded: entries.length - current,
    });
  };
  for (const name of listDirs(root)) {
    if (isChannelScope(name)) {
      if (only !== null && name !== only) continue;
      for (const receiver of listDirs(path.join(root, name))) {
        const entries = readLane(projectDir, name, receiver, now);
        push(name, receiver, entries, entries.filter((e) => e.runId != null && runIds.has(e.runId)).length);
      }
    } else if (only === null) {
      push(null, name, readDirEntries(path.join(root, name), now), 0);
    }
  }
  return lanes;
}
