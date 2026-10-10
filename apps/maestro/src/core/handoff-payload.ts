// Which of an agent's routes REQUIRE a channel payload, and did it write one this run? (`087`)
//
// A route "expects a payload" exactly when its `(sender, receiver)` pair resolves a handoff
// protocol across the three tiers (project file, global store, seed) — the same resolution the
// SubagentStart injector uses to tell the agent what to write, so the injector and the
// SubagentStop check can never disagree about which routes need one. Both hooks call this module:
//
//   - maestro-inject-agent-context.js — `payloadRequirement()` is the REQUIRED-step block, injected
//     on a first run, a cold re-run AND a resumed run (`040` skips the static blocks on a resume,
//     which used to drop the channel instruction with them — task 086's second @reviewer pass never
//     wrote `.claude/channels/scribe/reviewer.1.md`).
//   - maestro-subagent-log.js — `payloadWrittenSince()` + `runStartedAt()` back `checkPayload()`
//     (handoff-check.ts), the third handoff-issue kind.
//
// `fs`/`path` only: rides in the maestro-session bundle, which must stay free of `node:sqlite`. The
// global tier is passed IN by the caller, which owns the try/catch around the sqlite bundle.

import fs from "node:fs";
import path from "node:path";
import { laneFor } from "./handoff-channels.js";
import { resolveHandoff, type GlobalHandoffInput } from "./handoff-resolution.js";
import type { HandoffRoute } from "./handoff-routes.js";

export interface PayloadRoute {
  /** `"success"` or the condition label — what the agent's `HANDOFF:` line names. */
  label: string;
  /** Bare sender agent type. */
  sender: string;
  /** Bare receiver agent type. */
  receiver: string;
  /** Project-relative channel file, `.claude/channels/<receiver>/<sender>.1.md`. */
  channelFile: string;
  /** The resolved protocol body (the shape to write). */
  protocol: string;
}

/** `.claude/handoffs/<sender>/<receiver>.md`, trimmed, or null when absent or empty. */
export function readProjectHandoff(projectDir: string, handoffId: string): string | null {
  try {
    const [sender, receiver] = handoffId.split("/");
    const body = fs.readFileSync(path.join(projectDir, ".claude", "handoffs", sender, `${receiver}.md`), "utf8").trim();
    return body || null;
  } catch {
    return null;
  }
}

/**
 * The routes in `routes` (already narrowed to one sender) whose pair resolves a protocol, each
 * with the exact channel file to write. `readGlobal` is the caller's global-tier reader (null on a
 * `node` with no `node:sqlite` — the seed tier still answers then).
 */
export function payloadRoutes(
  projectDir: string,
  routes: HandoffRoute[],
  readGlobal: (handoffId: string) => GlobalHandoffInput | null
): PayloadRoute[] {
  const out: PayloadRoute[] = [];
  for (const r of routes) {
    if (!r.receiver) continue;
    const id = `${r.sender}/${r.receiver}`;
    let global: GlobalHandoffInput | null = null;
    try {
      global = readGlobal(id);
    } catch {
      global = null;
    }
    const resolved = resolveHandoff(id, readProjectHandoff(projectDir, id), global);
    if (!resolved.content) continue;
    out.push({
      label: r.label,
      sender: r.sender,
      receiver: r.receiver,
      channelFile: `.claude/channels/${r.receiver}/${r.sender}.1.md`,
      protocol: resolved.content,
    });
  }
  return out;
}

/**
 * The required-payload instruction for `routes`, or null when none needs a payload. `withShapes`
 * inlines each route's protocol (a first run, or a cold re-run); a resumed run gets the same
 * requirement and file names without re-sending the shapes already in its history.
 */
export function payloadRequirement(routes: PayloadRoute[], opts: { withShapes: boolean }): string | null {
  if (routes.length === 0) return null;
  const head =
    "REQUIRED before your HANDOFF line: write the payload for the route you take to that route's channel file. " +
    "This is a step of the handoff, not a recommendation — the receiving agent starts from that file, and the stop " +
    "hook checks it was written during THIS run. A missing payload is not skipped: the orchestrator resumes you to " +
    "write it before the next agent is dispatched. When nothing applies, still write the file, containing an empty " +
    "JSON object (`{}`).";
  if (opts.withShapes) {
    const blocks = routes.map(
      (r) => `Route \`HANDOFF: ${r.label}\` → \`${r.receiver}\` — write this to \`${r.channelFile}\`:\n\n${r.protocol}`
    );
    return `${head}\n\n${blocks.join("\n\n")}`;
  }
  const lines = routes.map((r) => `- \`HANDOFF: ${r.label}\` → write \`${r.channelFile}\` (for \`${r.receiver}\`)`);
  return `${head}\n${lines.join("\n")}\nThe shape for each route is the one from your first run.`;
}

/**
 * When this run of `agentId` started: the timestamp of the LAST `kind:"dispatch"` log entry for
 * it (a resume logs a fresh dispatch, so a resumed pass is measured from its own start). Null when
 * the log has none.
 */
export function runStartedAt(lines: unknown[], agentId: string): number | null {
  if (!agentId) return null;
  let at: number | null = null;
  for (const line of lines ?? []) {
    if (!line || typeof line !== "object") continue;
    const e = line as Record<string, unknown>;
    if (e.kind !== "dispatch" || e.agent_id !== agentId || typeof e.ts !== "string") continue;
    const t = Date.parse(e.ts);
    if (!Number.isNaN(t)) at = t;
  }
  return at;
}

/** Filesystem mtime granularity and clock slack between the hook's `ts` and the write. */
const MTIME_SLACK_MS = 1000;

/**
 * Did `route.sender` write `route.receiver`'s channel file at or after `sinceMs`? With no known
 * start (`null`), the file merely existing counts — the conservative direction, never a false flag.
 */
export function payloadWrittenSince(projectDir: string, route: PayloadRoute, sinceMs: number | null): boolean {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(laneFor(projectDir, route.sender, route.receiver));
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;
  if (sinceMs === null) return true;
  return stat.mtimeMs >= sinceMs - MTIME_SLACK_MS;
}
