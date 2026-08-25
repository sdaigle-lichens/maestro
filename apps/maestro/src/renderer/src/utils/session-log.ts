import { titleFromName, stripNamespace } from "./text";
import type { SessionLogEntry } from "./maestro-session-log";

/**
 * An agent's account of which injected skills it loaded vs deliberately skipped,
 * parsed from the `skillsTriage` field of its final JSON report. All agents that
 * receive skills emit this (see plugins/maestro/agents/*.md).
 */
export interface SkillsTriage {
  loaded: string[];
  skipped: { id: string; reason: string }[];
}

export interface Instance {
  id: number;
  origin: string;
  displayName: string;
  /** Index of the first entry in the flat entries array that belongs to this segment. */
  startIndex: number;
  entries: SessionLogEntry[];
  /**
   * null for the main_session — status only applies to subagent instances.
   * "transition" marks a non-workflow SubagentStop (e.g. the /ai-tools listen
   * loop pausing for the user), shown as a neutral boundary rather than an error.
   */
  status: "success" | "condition" | "unknown" | "transition" | null;
  /** The HANDOFF label (e.g. "tests_failed"), null when status is success or no handoff. */
  label: string | null;
  /** Full spawning message sent by the main session (from the matching dispatch entry). */
  input: string | null;
  /** Full final message the agent sent back (from the handoff entry of this segment). */
  output: string | null;
  /** Parsed skills triage from the agent's final report, null when absent/unparseable. */
  skillsTriage: SkillsTriage | null;
  /** Skills the SubagentStart hook offered (from the dispatch entry), null when absent. */
  offeredSkills: { loaded: string[]; referenced: string[] } | null;
}

/**
 * Segment the flat log entries into ordered instance runs.
 * A new segment starts whenever `origin` changes — so the same agent appearing
 * a second time yields a second card, matching the design.
 * dispatch/handoff entries are included in the segment they belong to, but are
 * also used to populate the input/output/status fields.
 */
export function buildInstances(entries: SessionLogEntry[]): Instance[] {
  const instances: Instance[] = [];
  let current: Instance | null = null;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    if (!current || entry.origin !== current.origin) {
      current = {
        id: instances.length,
        origin: entry.origin,
        displayName: entry.origin === "main_session" ? "Main Session" : titleFromName(stripNamespace(entry.origin)),
        startIndex: i,
        entries: [],
        status: null,
        label: null,
        input: null,
        output: null,
        skillsTriage: null,
        offeredSkills: null,
      };
      instances.push(current);
    }

    current.entries.push(entry);

    // Populate status/label/output from handoff entries within this segment.
    if (entry.kind === "handoff" && current.origin === entry.origin) {
      current.status = entry.status ?? "unknown";
      current.label = entry.label ?? null;
      current.output = entry.output ?? null;
    } else if (entry.kind === "transition") {
      // A non-workflow boundary — keep its message for the detail panel but
      // mark it neutral so it doesn't render as a failed/unknown handoff.
      current.status = "transition";
      current.output = entry.output ?? null;
    }
  }

  // Second pass: correlate input from dispatch entries (matched by agent_id).
  // The dispatch entry lives in the main_session segment but its agent_id links
  // it to the subagent segment it spawned.
  const dispatchByAgentId = new Map<string, SessionLogEntry>();
  for (const entry of entries) {
    if (entry.kind === "dispatch" && entry.agent_id) {
      dispatchByAgentId.set(entry.agent_id, entry);
    }
  }

  // For each subagent segment, find the dispatch entry whose agent_id matches
  // the handoff entry in that segment.
  for (const inst of instances) {
    if (inst.origin === "main_session") continue;

    // Find the dispatch entry that spawned this segment: prefer agent_id
    // correlation via the handoff, fall back to the first dispatch of this type.
    const handoff = inst.entries.find((e) => e.kind === "handoff" && e.agent_id);
    let dispatch = handoff?.agent_id ? dispatchByAgentId.get(handoff.agent_id) : undefined;
    if (!dispatch) {
      dispatch = entries.find((e) => e.kind === "dispatch" && e.agent === inst.origin && e.input);
    }
    if (dispatch) {
      inst.input = dispatch.input ?? null;
      inst.offeredSkills = dispatch.offered_skills ?? null;
    }

    // Parse the skills triage out of the agent's final report.
    inst.skillsTriage = parseSkillsTriage(inst.output);
  }

  return instances;
}

/**
 * Skills the SubagentStart hook offered the agent but its report neither loaded
 * nor explicitly skipped — i.e. silently dropped. Empty unless both the offered
 * list (dispatch entry) and a parsed triage (final report) are present, since a
 * diff is only meaningful when we know both sides.
 */
export function unaccountedSkills(inst: Instance): string[] {
  if (!inst.offeredSkills || !inst.skillsTriage) return [];
  const offered = [...inst.offeredSkills.loaded, ...inst.offeredSkills.referenced];
  const accounted = new Set([...inst.skillsTriage.loaded, ...inst.skillsTriage.skipped.map((s) => s.id)]);
  return offered.filter((id) => !accounted.has(id));
}

/**
 * Extract the `skillsTriage` block from an agent's final message. The report is
 * a fenced ```json block (the last one wins, since the report concludes the
 * message). Tolerant: any parse/shape failure yields null so the UI simply
 * omits the section — backward compatible with agents that don't emit it.
 */
export function parseSkillsTriage(output: string | null): SkillsTriage | null {
  if (!output) return null;

  const blocks: string[] = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(output)) !== null) blocks.push(m[1]);

  // Walk candidates last-first — the report block is normally the final fence.
  for (let i = blocks.length - 1; i >= 0; i--) {
    const triage = extractTriage(blocks[i]);
    if (triage) return triage;
  }
  return null;
}

function extractTriage(raw: string): SkillsTriage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const t = (parsed as Record<string, unknown>).skillsTriage;
  if (!t || typeof t !== "object") return null;
  const obj = t as Record<string, unknown>;

  const loaded = Array.isArray(obj.loaded) ? obj.loaded.filter((x): x is string => typeof x === "string") : [];

  const skipped = Array.isArray(obj.skipped)
    ? obj.skipped
        .map((s) => {
          if (typeof s === "string") return { id: s, reason: "" };
          if (s && typeof s === "object") {
            const so = s as Record<string, unknown>;
            return {
              id: typeof so.id === "string" ? so.id : "",
              reason: typeof so.reason === "string" ? so.reason : "",
            };
          }
          return null;
        })
        .filter((x): x is { id: string; reason: string } => x !== null && x.id !== "")
    : [];

  if (loaded.length === 0 && skipped.length === 0) return null;
  return { loaded, skipped };
}

/**
 * Produce a human-readable one-liner for a log entry.
 * Returns null for entries that are covered by a richer dispatch/handoff line
 * (the bare PreToolUse "Agent" tool-call lines), which the view should filter out.
 */
/** Strip the cwd prefix from an absolute path so files under the project show relative. */
function relPath(p: string, cwd: string): string {
  if (!cwd) return p;
  if (p === cwd) return ".";
  const prefix = cwd.endsWith("/") ? cwd : cwd + "/";
  return p.startsWith(prefix) ? p.slice(prefix.length) : p;
}

export function humanizeLog(entry: SessionLogEntry, cwd = ""): string | null {
  if (entry.kind === "dispatch") {
    return `calling \`${entry.agent}\` agent`;
  }
  if (entry.kind === "handoff") {
    const label = entry.label ?? "none";
    const status = entry.status ?? "unknown";
    return `handed off — ${label} (${status})`;
  }
  if (entry.kind === "transition") {
    const msg = (entry.output ?? "").trim();
    if (!msg) return "transition";
    return `transition — ${msg.length > 80 ? `${msg.slice(0, 80)}…` : msg}`;
  }

  const log = entry.log ?? "";

  // Suppress the bare "Agent" / "Task(...)" PreToolUse entries; the richer
  // dispatch entry from maestro-subagent-log.js covers the same event.
  if (log === "Agent" || log === "Task" || /^Task\(/.test(log)) {
    return null;
  }

  // Parse "ToolName(arg)" format.
  const m = log.match(/^(\w+)\((.*)?\)$/s);
  if (m) {
    const [, tool, arg] = m;
    const a = (arg ?? "").trim();
    switch (tool) {
      case "Read":
        return `read file \`${relPath(a, cwd)}\``;
      case "Write":
        return `wrote file \`${relPath(a, cwd)}\``;
      case "Edit":
      case "NotebookEdit":
        return `edited file \`${relPath(a, cwd)}\``;
      case "Glob":
        return `searched files \`${relPath(a, cwd)}\``;
      case "Grep":
        return `searched for \`${a}\``;
      case "Bash":
        return `ran \`${a}\``;
      case "Skill":
        return `used skill \`${a}\``;
      case "TaskCreate":
        return `created task \`${a}\``;
      default:
        return log;
    }
  }

  return log || null;
}
