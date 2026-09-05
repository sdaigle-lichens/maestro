import { titleFromName, stripNamespace } from "./text";
import type { SessionLogEntry, ChannelDelivery } from "./maestro-session-log";

export type { ChannelDelivery };

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
  /**
   * `kind: "channel_delivery"` entries logged at THIS instance's own SubagentStart (`036`/`037`) —
   * matched by `agent_id`, same as `input`. Empty, never omitted, so a template need not special-case
   * "no deliveries" from "not yet computed".
   */
  delivered: ChannelDelivery[];
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
  // Index (in `entries`) of each instance's own handoff entry, by instance.id. `null` until a
  // handoff for that segment is seen; a still-open segment (in-flight/killed agent) keeps it null.
  const handoffIndexByInstance: (number | null)[] = [];
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
        delivered: [],
      };
      instances.push(current);
      handoffIndexByInstance.push(null);
    }

    current.entries.push(entry);

    // Populate status/label/output from handoff entries within this segment.
    if (entry.kind === "handoff" && current.origin === entry.origin) {
      current.status = entry.status ?? "unknown";
      current.label = entry.label ?? null;
      current.output = entry.output ?? null;
      handoffIndexByInstance[current.id] = i;
    } else if (entry.kind === "transition") {
      // A non-workflow boundary — keep its message for the detail panel but
      // mark it neutral so it doesn't render as a failed/unknown handoff.
      current.status = "transition";
      current.output = entry.output ?? null;
    }
  }

  // Second pass, one forward sweep: index dispatch/handoff/channel_delivery entries by agent_id,
  // each list in log order. `agent_id` alone stopped being a unique key once `039` let a
  // condition-edge loop-back RESUME an agent instead of spawning it cold — a resumed run keeps its
  // agent_id, so `SubagentStart`/`SubagentStop` append a second dispatch/handoff pair under the same
  // id. The lists below are still grouped by agent_id, but every lookup against them is bounded by
  // POSITION (see the per-instance loop) — the log is append-only, so the run boundary is already
  // there in file order, one run's entries sit strictly between the previous run's handoff and its
  // own.
  const dispatchesByAgentId = new Map<string, { index: number; entry: SessionLogEntry }[]>();
  const handoffIndicesByAgentId = new Map<string, number[]>();
  const deliveriesByAgentId = new Map<string, { index: number; delivery: ChannelDelivery }[]>();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.kind === "dispatch" && entry.agent_id) {
      const list = dispatchesByAgentId.get(entry.agent_id) ?? [];
      list.push({ index: i, entry });
      dispatchesByAgentId.set(entry.agent_id, list);
    } else if (entry.kind === "handoff" && entry.agent_id) {
      const list = handoffIndicesByAgentId.get(entry.agent_id) ?? [];
      list.push(i);
      handoffIndicesByAgentId.set(entry.agent_id, list);
    } else if (entry.kind === "channel_delivery" && entry.agent_id) {
      const list = deliveriesByAgentId.get(entry.agent_id) ?? [];
      list.push({
        index: i,
        delivery: {
          sender: entry.sender ?? "",
          receiver: entry.receiver ?? "",
          agent_id: entry.agent_id,
          content: entry.content ?? "",
        },
      });
      deliveriesByAgentId.set(entry.agent_id, list);
    }
  }

  // Bound for the name-based fallback when a segment has no agent_id to key off (no handoff yet,
  // or a handoff missing agent_id): the end of the previous segment sharing this origin, so a
  // fallback search can't reach into a later run of the same agent type.
  const lastEndByOrigin = new Map<string, number>();

  // For each subagent segment, correlate its dispatch/deliveries bounded by its own run's window
  // in the log rather than by agent_id alone.
  for (const inst of instances) {
    if (inst.origin === "main_session") continue;

    const handoff = inst.entries.find((e) => e.kind === "handoff" && e.agent_id);
    const ownHandoffIndex = handoffIndexByInstance[inst.id];
    // No handoff (still running, or killed before SubagentStop): fall back to the END OF THIS
    // SEGMENT, which for a genuinely in-flight agent IS the end of the log — a card for one should
    // still show its spawning message. Not `entries.length` unconditionally: a segment is a
    // contiguous run of entries, so when a killed agent is followed by a re-dispatch of the same
    // type, an open-ended window would reach past this segment and hand it the LATER run's
    // dispatch — the very misattribution this bounding exists to prevent.
    const h = ownHandoffIndex ?? inst.startIndex + inst.entries.length;
    const agentId = handoff?.agent_id;

    let p: number;
    if (agentId) {
      // The nearest earlier run of the same agent_id. Searched by comparison rather than by
      // locating `h` in the list, so a segment whose last handoff is not the one carrying the
      // agent_id still gets a real lower bound instead of silently falling back to -1.
      p = -1;
      for (const idx of handoffIndicesByAgentId.get(agentId) ?? []) {
        if (idx < h && idx > p) p = idx;
      }
    } else {
      p = lastEndByOrigin.get(inst.origin) ?? -1;
    }

    // The latest dispatch with this agent_id whose index is < h — not the last one in the file.
    let dispatch: SessionLogEntry | undefined;
    if (agentId) {
      const runs = dispatchesByAgentId.get(agentId) ?? [];
      for (let k = runs.length - 1; k >= 0; k--) {
        if (runs[k].index > p && runs[k].index < h) {
          dispatch = runs[k].entry;
          break;
        }
      }
    }
    if (!dispatch) {
      // Name-based fallback, bounded by the same (p, h) window: the latest dispatch for this
      // origin with an input, in range.
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.kind === "dispatch" && e.agent === inst.origin && e.input && i > p && i < h) {
          dispatch = e;
          break;
        }
      }
    }

    if (dispatch) {
      inst.input = dispatch.input ?? null;
      inst.offeredSkills = dispatch.offered_skills ?? null;
    }

    // Deliveries logged at this instance's own SubagentStart — same key as input/offeredSkills
    // above, windowed to (p, h) so a delivery between two runs lands on the later one only.
    const deliveryKey = agentId ?? dispatch?.agent_id;
    inst.delivered = deliveryKey
      ? (deliveriesByAgentId.get(deliveryKey) ?? []).filter((d) => d.index > p && d.index < h).map((d) => d.delivery)
      : [];

    // Parse the skills triage out of the agent's final report.
    inst.skillsTriage = parseSkillsTriage(inst.output);

    lastEndByOrigin.set(inst.origin, h);
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
