// Agent channels (`036`) — the runtime replacement for forwarding a `handoff_details` payload
// through the orchestrator's own context. A sender writes a body to the RECEIVING agent's lane;
// `SubagentStart` inlines it when that agent is next invoked, in the same run. See
// `.claude/maestro-tasks/036-move-handoff-payloads-onto-agent-channels.md` for the design.
//
//   .claude/channels/
//     <receiver>/
//       <sender>.1.md        ← written by the sender, stamped by ITS OWN SubagentStop
//     .consumed/
//       <receiver>/
//         <sender>.1.md      ← retired here by SubagentStart once delivered, never deleted
//
// `fs` and `path` only, on purpose — this is re-exported from `plugin-entries/maestro-session.ts`,
// the bundle every copied hook `require`s UNCONDITIONALLY, and that bundle must stay free of
// `node:sqlite` (see that file's header). Nothing here touches a database.
//
// A channel file's first line is its stamp — see `formatStampedContent`/`parseStampedContent` —
// written once, by the RECEIVER'S SENDER'S OWN `SubagentStop`, never by the agent itself: asking a
// subagent to look up and write a correct `run_id` is a protocol it will get wrong silently, the
// way it already omits `skillsTriage`.

import fs from "node:fs";
import path from "node:path";

/** How long a lane file may sit unconsumed before `sweep` removes it. */
export const CHANNEL_AGE_CAP_MS = 14 * 24 * 60 * 60 * 1000;

const CHANNELS_DIR_NAME = "channels";
const CONSUMED_DIR_NAME = ".consumed";

/** `<projectDir>/.claude/channels` — never used directly for I/O outside this module. */
function channelsRoot(projectDir: string): string {
  return path.join(projectDir, ".claude", CHANNELS_DIR_NAME);
}

/** The directory a sender writes into and `SubagentStart` reads for one receiver. */
export function channelDir(projectDir: string, receiver: string): string {
  return path.join(channelsRoot(projectDir), receiver);
}

/** Where a retired (delivered) file for `receiver` lands — never deleted, only aged out. */
function consumedDir(projectDir: string, receiver: string): string {
  return path.join(channelsRoot(projectDir), CONSUMED_DIR_NAME, receiver);
}

/**
 * The path a `sender` writes its payload for `receiver` to. Always `.1.md` — the seed bodies tell
 * an agent to write there literally; there is no multi-file protocol for one sender/receiver pair
 * in this slice, so a second write simply overwrites the first (a stale, undelivered file being
 * clobbered by a fresher one from the same sender is the desired behaviour, not a bug).
 */
export function laneFor(projectDir: string, sender: string, receiver: string): string {
  return path.join(channelDir(projectDir, receiver), `${sender}.1.md`);
}

const STAMP_RE = /^<!-- maestro:run_id=([^\s>]+) -->\n/;

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
 * Stamp every unstamped file under every receiver's lane whose filename SENDER segment matches
 * `sender` — called by `sender`'s OWN `SubagentStop`, never anyone else's, which is what keeps two
 * parallel subagents from stamping each other's writes. Already-stamped files are left untouched
 * (idempotent, and never overwrites a stamp a differently-timed run already wrote). Returns the
 * absolute paths it stamped.
 */
export function writeStamp(projectDir: string, sender: string, runId: string): string[] {
  const stamped: string[] = [];
  for (const receiver of listDirs(channelsRoot(projectDir))) {
    const dir = channelDir(projectDir, receiver);
    for (const fileName of listFiles(dir)) {
      if (senderOf(fileName) !== sender) continue;
      const filePath = path.join(dir, fileName);
      let content: string;
      try {
        content = fs.readFileSync(filePath, "utf8");
      } catch {
        continue;
      }
      if (STAMP_RE.test(content)) continue;
      fs.writeFileSync(filePath, formatStampedContent(content, runId));
      stamped.push(filePath);
    }
  }
  return stamped;
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

/** Every file currently sitting in `receiver`'s lane — delivered and non-delivered alike. */
export function readLane(projectDir: string, receiver: string, now: number = Date.now()): ChannelEntry[] {
  const dir = channelDir(projectDir, receiver);
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
 * Move a delivered entry to `.claude/channels/.consumed/<receiver>/` — by rename, never delete, so
 * a delivered-but-then-failed agent's payload is recoverable for `CHANNEL_AGE_CAP_MS` rather than
 * gone. Never call this for an entry `readLane` did not just return; it assumes the file is still
 * where that call found it.
 */
export function retire(projectDir: string, receiver: string, entry: ChannelEntry): void {
  const dest = consumedDir(projectDir, receiver);
  fs.mkdirSync(dest, { recursive: true });
  fs.renameSync(entry.path, path.join(dest, entry.fileName));
}

export interface SweepResult {
  removed: string[];
}

/**
 * `SessionEnd`'s replacement for the old flush: retire `.consumed/` outright, and age out anything
 * in a live lane past `ageCapMs` — including a lane nothing has ever drained (the scribe's, when no
 * scribe ran). Never touches a lane file inside the cap, delivered or not.
 */
export function sweep(projectDir: string, opts: { now?: number; ageCapMs?: number } = {}): SweepResult {
  const now = opts.now ?? Date.now();
  const ageCapMs = opts.ageCapMs ?? CHANNEL_AGE_CAP_MS;
  const removed: string[] = [];
  const root = channelsRoot(projectDir);

  const consumedRoot = path.join(root, CONSUMED_DIR_NAME);
  for (const receiver of listDirs(consumedRoot)) {
    const dir = path.join(consumedRoot, receiver);
    for (const fileName of listFiles(dir)) {
      const filePath = path.join(dir, fileName);
      try {
        fs.rmSync(filePath, { force: true });
        removed.push(filePath);
      } catch {
        // Not worth failing SessionEnd over.
      }
    }
  }

  for (const receiver of listDirs(root)) {
    const dir = channelDir(projectDir, receiver);
    for (const fileName of listFiles(dir)) {
      const filePath = path.join(dir, fileName);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }
      if (now - stat.mtimeMs <= ageCapMs) continue;
      try {
        fs.rmSync(filePath, { force: true });
        removed.push(filePath);
      } catch {
        // Not worth failing SessionEnd over.
      }
    }
  }

  return { removed };
}
