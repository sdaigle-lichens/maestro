#!/usr/bin/env node
// /maestro-post-mortem helper — condenses ONE session's
// <project>/.claude/maestro_sessions/<session_id>/log.jsonl into a compact digest the skill
// reasons over (instead of dumping the raw, message-heavy log into the model's context).
//
// Read-only: parses the append-only session log + that session's session.json, prints a
// markdown digest (default) or a structured object (--json) to stdout, and
// never edits or deletes anything.
//
//   node maestro-post-mortem.js <projectRoot> [--session <id>] [--json]
//
// `064`: WHICH session it digests defaults to the INVOKING one (resolved from the
// CLAUDE_CODE_SESSION_ID environment variable — this CLI runs with no stdin), which is what makes
// "run it mid-session" mean the session you are actually in even when a second one is live in the
// same project. `--session <id>` names another explicitly. When neither resolves it LISTS the
// available sessions and says to pass one, rather than digesting an arbitrary directory — a
// post-mortem of somebody else's run is worse than no post-mortem.
//
// The digest is deterministic and cheap: a session summary, the dispatch↔handoff
// timeline correlated by agent_id, and heuristic FLAGS (repeated reads, edit
// thrash, typecheck/test/lint runs, long tool runs). The flags are LEADS, not
// verdicts — the skill couples them with the main session's own context to
// decide what actually went wrong.

const fs = require("fs");
const path = require("path");
const { readJson, resolveSessionPaths, sessionPathsFor, listSessionIds } = require("./lib/maestro-session.cjs");

// --- tuning knobs (candidate thresholds, intentionally loose) -----------------
const REPEAT_READ_MIN = 3; // same file Read this many times → flag
const EDIT_CHURN_MIN = 4; // same file Edited/Written this many times → flag
const TOOL_RUN_MIN = 6; // same tool fired back-to-back by one origin → flag
const INPUT_CLIP = 200; // truncate embedded dispatch input
const OUTPUT_CLIP = 240; // truncate embedded handoff output
const CHECK_RE =
  /\b(tsc|t'?sc|type-?check|eslint|prettier|biome|vitest|jest|mocha|pytest|\bgo test\b|cargo (test|check)|\bnpm (run )?(test|build|lint|typecheck)|\byarn (test|build|lint|typecheck)|\bpnpm (test|build|lint|typecheck))\b/i;

function clip(s, n) {
  if (s == null) return "";
  const str = String(s).replace(/\s+/g, " ").trim();
  return str.length > n ? str.slice(0, n) + " …[clipped]" : str;
}

// Pull the file/target out of a humanized log line like "Read(/a/b.ts)".
function logTarget(log) {
  const m = /^[A-Za-z]+\((.*)\)$/.exec(log || "");
  return m ? m[1] : null;
}

function parseLog(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return null; // missing
  }
  const entries = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      entries.push(JSON.parse(t));
    } catch {
      // tolerate a partially-written trailing line
    }
  }
  return entries;
}

// Task 160's marker: the hook writes `interim: true` on a handoff entry for a stop that carried no
// hand-back yet (absent otherwise, never false). An interim stop that a later stop of the same
// agent run supersedes is not an outcome. One that is the agent's LAST stop is read in this order:
//
//   1. `169`: an `interim_settled` line for that agent_id AFTER the stop is the settlement
//      `handoff-issues` made — `settled_as: "missing"` is a missing HANDOFF, `"late_handback"` is the
//      label the late hand-back carried. Taken from the record, never inferred.
//   2. No such line, but the stop is stamped `settles_in_log: true`, or the log holds any
//      `interim_settled` line: this log is written by a plugin that records settlements, so no line
//      means NOT SETTLED YET (still working, or awaiting the next handoff check). Its own outcome,
//      kept out of Problems.
//   3. Neither (a log written before `169`): settlements were never logged, so the digest INFERS a
//      missing HANDOFF from the log alone, exactly as before.
function isInterim(h) {
  return h.interim === true;
}

const SETTLED_KIND = "interim_settled";

const OUTCOME_MISSING = "missing HANDOFF";
const OUTCOME_NO_RETURN = "no-return";
// `172`: a helper on no workflow (Explore, general-purpose, plan-reviewer) is never asked for a
// HANDOFF line, so ending without one is its normal outcome, not a problem.
const OUTCOME_HELPER = "helper (no HANDOFF expected)";
// `169`: an interim stop the log says is not settled yet; it may still be followed by a final stop.
const OUTCOME_PENDING = "interim stop, not settled yet";
const INFERRED_NOTE = "inferred from the log: interim stop never followed by a final stop";
const SETTLED_NOTE = "from the settle record: interim stop settled as missing";
const LATE_NOTE = "from the settle record: hand-back landed after the stop";

function outcomeKind(s) {
  if (s.helper && (s.interim || s.status === "unknown")) return OUTCOME_HELPER;
  if (s.settled === "missing") return OUTCOME_MISSING;
  if (s.settled === "late_handback") return s.label ? s.label.toLowerCase() : OUTCOME_MISSING;
  if (s.pending) return OUTCOME_PENDING;
  if (s.interim) return OUTCOME_MISSING;
  if (s.status === "unknown") return OUTCOME_MISSING;
  if (s.status === "no-return") return OUTCOME_NO_RETURN;
  return (s.label || s.status || "unknown").toLowerCase();
}

// The parenthetical a Problems line carries for a run whose last stop was interim ("" otherwise).
function interimNote(s) {
  if (s.settled === "missing") return SETTLED_NOTE;
  if (s.settled === "late_handback") return s.handoff_issue ? `${LATE_NOTE}, judged ${s.handoff_issue}` : LATE_NOTE;
  if (s.inferred) return INFERRED_NOTE;
  return "";
}

function analyze(entries, session) {
  const toolCalls = entries.filter((e) => !e.kind);
  // Team-meeting turns (`meeting: true`, written by maestro-subagent-log.js) are not workflow
  // runs: kept out of the timeline and the outcome tally — a resumed participant's meeting handoff
  // would otherwise overwrite its workflow handoff under the same agent_id — and counted apart.
  const dispatches = entries.filter((e) => e.kind === "dispatch" && e.meeting !== true);
  const handoffs = entries.filter((e) => e.kind === "handoff" && e.meeting !== true);
  const meetingTurns = entries.filter((e) => e.kind === "handoff" && e.meeting === true);
  const meetingAgents = [...new Set(meetingTurns.map((e) => e.origin).filter(Boolean))];

  // counts per origin
  const byOrigin = {};
  for (const e of entries) {
    const o = e.origin || "unknown";
    byOrigin[o] = (byOrigin[o] || 0) + 1;
  }

  // correlate dispatch ↔ handoff by agent_id
  // The LAST handoff per agent_id is the run's final stop; an earlier stop of a resumed run was
  // interim and is superseded by it.
  const handoffById = {};
  for (const h of handoffs) handoffById[h.agent_id] = h;
  // `169`: the settle record that applies to a run is its last `interim_settled` line logged AFTER
  // its last stop (log order, not timestamps); an older one was overtaken by a resume.
  const settleById = {};
  for (const e of entries) {
    if (e.kind === SETTLED_KIND && e.agent_id) settleById[e.agent_id] = e;
  }
  const logsSettlements = entries.some((e) => e.kind === SETTLED_KIND);
  const settleAfterStop = (h) => {
    const rec = h && settleById[h.agent_id];
    return rec && entries.indexOf(rec) > entries.indexOf(h) ? rec : null;
  };
  // A resume writes a SECOND dispatch entry under the same agent_id: one row per agent_id, from its
  // first dispatch (the original task input), so a resumed run is one outcome, not two.
  const seenIds = new Set();
  const uniqueDispatches = dispatches.filter((d) => {
    if (!d.agent_id) return true;
    if (seenIds.has(d.agent_id)) return false;
    seenIds.add(d.agent_id);
    return true;
  });
  const subagents = uniqueDispatches.map((d) => {
    const h = handoffById[d.agent_id];
    const interim = h ? isInterim(h) : false;
    const rec = interim ? settleAfterStop(h) : null;
    const settled = rec ? (rec.settled_as === "late_handback" ? "late_handback" : "missing") : null;
    const helper = !d.offered_skills;
    const pending = !helper && interim && !rec && (h.settles_in_log === true || logsSettlements);
    const s = {
      agent: d.agent || "?",
      agent_id: d.agent_id || "",
      input: clip(d.input, INPUT_CLIP),
      status: h ? h.status : "no-return",
      interim,
      // `169`: how the run's last (interim) stop was settled, from its `interim_settled` record:
      // "missing" | "late_handback" | null. `pending`: interim, no record, and the log records
      // settlements, so the run is not settled yet. `inferred`: interim in a log with no settle
      // records at all, read with the pre-`169` inference.
      settled,
      pending,
      inferred: !helper && interim && !rec && !pending,
      // `172`: maestro-subagent-log.js stamps `offered_skills` on a dispatch exactly when the agent
      // maps to a workflow instance — the same test its SubagentStop uses to decide whether a
      // missing HANDOFF line is an issue. No stamp: an agent on no workflow, i.e. a helper.
      helper,
      label: settled === "late_handback" ? (rec.label ?? null) : h ? h.label : null,
      output: h ? clip(h.output, OUTPUT_CLIP) : null,
    };
    if (rec) {
      s.settled_at = rec.ts || null;
      if (rec.handoff_issue) s.handoff_issue = rec.handoff_issue.kind;
    }
    return s;
  });

  // outcome tally: EVERY recorded kind, by the HANDOFF label the agent returned (success, fail,
  // blocked, any other condition), plus the two ways a run ends with none: a final stop whose
  // message carried no parseable HANDOFF line (including an interim stop that was never followed by a
  // final one, flagged `interim` and inferred missing), and an agent that never stopped at all. An
  // interim stop that was resumed and finished counts only as the final outcome.
  const outcomes = {};
  for (const s of subagents) {
    const k = outcomeKind(s);
    outcomes[k] = (outcomes[k] || 0) + 1;
  }

  // --- heuristic flags ---
  const flags = [];

  // repeated reads / edit churn, scoped per origin
  const reads = {}; // `${origin}|${target}` -> count
  const edits = {};
  for (const e of toolCalls) {
    const log = e.log || "";
    const target = logTarget(log);
    if (!target) continue;
    const key = `${e.origin || "?"}|${target}`;
    if (log.startsWith("Read(") || log.startsWith("Glob(") || log.startsWith("Grep(")) {
      reads[key] = (reads[key] || 0) + 1;
    } else if (log.startsWith("Edit(") || log.startsWith("Write(") || log.startsWith("NotebookEdit(")) {
      edits[key] = (edits[key] || 0) + 1;
    }
  }
  for (const [key, n] of Object.entries(reads)) {
    if (n >= REPEAT_READ_MIN) {
      const [origin, target] = key.split("|");
      flags.push({ kind: "repeated-read", origin, target, count: n });
    }
  }
  for (const [key, n] of Object.entries(edits)) {
    if (n >= EDIT_CHURN_MIN) {
      const [origin, target] = key.split("|");
      flags.push({ kind: "edit-churn", origin, target, count: n });
    }
  }

  // typecheck/test/lint commands — surfaced so the skill can hunt false errors
  const checks = [];
  for (const e of toolCalls) {
    const log = e.log || "";
    if (log.startsWith("Bash(") && CHECK_RE.test(log)) {
      checks.push({ origin: e.origin || "?", command: logTarget(log) || log });
    }
  }

  // long back-to-back runs of the same tool by one origin
  let runTool = null;
  let runOrigin = null;
  let runLen = 0;
  const longRuns = [];
  const flushRun = () => {
    if (runLen >= TOOL_RUN_MIN) {
      longRuns.push({ origin: runOrigin, tool: runTool, count: runLen });
    }
  };
  for (const e of toolCalls) {
    const tool = (e.log || "").split("(")[0];
    if (tool === runTool && (e.origin || "?") === runOrigin) {
      runLen++;
    } else {
      flushRun();
      runTool = tool;
      runOrigin = e.origin || "?";
      runLen = 1;
    }
  }
  flushRun();

  return {
    workflow: (session && session.workflow) || null,
    counts: {
      total: entries.length,
      toolCalls: toolCalls.length,
      dispatches: subagents.length,
      handoffs: handoffs.length,
      meetingTurns: meetingTurns.length,
      byOrigin,
    },
    meetingAgents,
    outcomes,
    problems: subagents.filter((s) => {
      const k = outcomeKind(s);
      return k !== "success" && k !== OUTCOME_HELPER && k !== OUTCOME_PENDING;
    }),
    // `169`: runs whose last stop is interim and not settled yet — not a problem until settled.
    pending: subagents.filter((s) => outcomeKind(s) === OUTCOME_PENDING),
    subagents,
    flags,
    checks,
    longRuns,
  };
}

function renderMarkdown(a) {
  const L = [];
  L.push("# Maestro Post-Mortem digest");
  L.push("");
  L.push(`- **Workflow**: ${a.workflow || "(unknown / not set)"}`);
  L.push(`- **Tool calls**: ${a.counts.toolCalls}`);
  L.push(`- **Subagents dispatched**: ${a.counts.dispatches} (handoffs returned: ${a.counts.handoffs})`);
  // Problems first: success is listed last so a blocked or missing run is the first thing read.
  const oc = Object.entries(a.outcomes)
    .sort(([x], [y]) => (x === "success") - (y === "success"))
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  if (oc) L.push(`- **Handoff outcomes**: ${oc}`);
  if (a.counts.meetingTurns > 0) {
    L.push(
      `- **Team-meeting turns** (excluded from the timeline): ${a.counts.meetingTurns} ` +
        `(${a.meetingAgents.join(", ")}) — their tool calls still count under their origin below`
    );
  }
  const bo = Object.entries(a.counts.byOrigin)
    .map(([k, v]) => `${k} (${v})`)
    .join(", ");
  L.push(`- **Activity by origin**: ${bo}`);
  L.push("");

  if (a.problems.length > 0) {
    L.push("## Problems (non-success outcomes)");
    for (const s of a.problems) {
      const note = interimNote(s);
      L.push(`- **${s.agent}** \`${s.agent_id}\` → ${outcomeKind(s)}${note ? ` (${note})` : ""}`);
    }
    L.push("");
  }

  if (a.pending.length > 0) {
    L.push("## Pending (interim stop, not settled yet)");
    for (const s of a.pending) {
      L.push(
        `- **${s.agent}** \`${s.agent_id}\` → ${OUTCOME_PENDING}: may still be working; not counted as missing until the handoff check settles it`
      );
    }
    L.push("");
  }

  L.push("## Subagent timeline");
  if (a.subagents.length === 0) {
    L.push("_No subagents dispatched this session._");
  } else {
    for (const s of a.subagents) {
      const helper = outcomeKind(s) === OUTCOME_HELPER;
      const tag = helper
        ? OUTCOME_HELPER
        : s.settled === "late_handback"
          ? `late hand-back${s.label ? ` (${s.label})` : ""}`
          : s.settled === "missing"
            ? "interim stop, settled as missing"
            : s.pending
              ? OUTCOME_PENDING
              : s.interim
                ? "interim stop, no final stop"
                : s.label
                  ? `${s.status} (${s.label})`
                  : s.status;
      L.push(`- **${s.agent}** \`${s.agent_id}\` → ${tag}`);
      if (s.input) L.push(`  - in: ${s.input}`);
      if (s.output) L.push(`  - out: ${s.output}`);
      if (s.status === "no-return") L.push(`  - ⚠️ no stop recorded — agent never returned`);
      if (helper) L.push(`  - helper on no workflow: ends without a HANDOFF line by design`);
      else if (s.settled === "late_handback")
        L.push(`  - ${LATE_NOTE}${s.handoff_issue ? ` — ⚠️ judged ${s.handoff_issue}` : ""}`);
      else if (s.settled === "missing") L.push(`  - ⚠️ missing HANDOFF (${SETTLED_NOTE})`);
      else if (s.pending) L.push(`  - interim stop with no settle record yet: a final stop may still follow`);
      else if (s.interim) L.push(`  - ⚠️ missing HANDOFF (${INFERRED_NOTE})`);
      else if (s.status === "unknown") L.push(`  - ⚠️ handoff returned but no parseable HANDOFF: label`);
    }
  }
  L.push("");

  L.push("## Heuristic flags (leads, not verdicts)");
  if (a.flags.length === 0) {
    L.push("_No redundant-work patterns crossed the thresholds._");
  } else {
    for (const f of a.flags) {
      if (f.kind === "repeated-read") {
        L.push(`- 🔁 **${f.origin}** read \`${f.target}\` ${f.count}× — candidate redundant read`);
      } else if (f.kind === "edit-churn") {
        L.push(`- ✏️ **${f.origin}** edited \`${f.target}\` ${f.count}× — candidate thrash`);
      }
    }
  }
  L.push("");

  L.push("## Typecheck / test / lint runs (cross-check against context for false errors)");
  if (a.checks.length === 0) {
    L.push("_None detected._");
  } else {
    for (const c of a.checks) L.push(`- **${c.origin}**: \`${c.command}\``);
  }
  L.push("");

  if (a.longRuns.length) {
    L.push("## Long single-tool runs");
    for (const r of a.longRuns) L.push(`- **${r.origin}**: ${r.count}× ${r.tool} back-to-back`);
    L.push("");
  }

  return L.join("\n");
}

// `--session <id>` / `--session=<id>`, and the positional project root, in one pass over argv.
function parseArgs(argv) {
  let root = null;
  let sessionId = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") continue;
    if (a === "--session") sessionId = argv[++i] ?? null;
    else if (a.startsWith("--session=")) sessionId = a.slice("--session=".length);
    else if (!a.startsWith("--") && root === null) root = a;
  }
  return { root, sessionId };
}

/** Nothing to digest: list what IS there and say how to pick one, rather than guessing. */
function reportNoSession(claudeDir, sessionId, asJson) {
  const available = listSessionIds(claudeDir);
  const sessionsDir = path.join(claudeDir, "maestro_sessions");
  const msg = available.length
    ? "Could not tell which Maestro session to digest" +
      (sessionId ? ` ("${sessionId}" is not a valid session id)` : "") +
      ".\nAvailable sessions under " +
      sessionsDir +
      ":\n" +
      available.map((id) => `  - ${id}`).join("\n") +
      "\nRe-run with --session <id>."
    : "No Maestro session state found under " +
      sessionsDir +
      ".\nThe post-mortem reads the live session log, which is ephemeral and deleted at SessionEnd.\nRun /maestro-post-mortem during an active Maestro session that has done some work.";
  if (asJson) {
    process.stdout.write(JSON.stringify({ error: "no-session", sessions: available, message: msg }, null, 2) + "\n");
  } else {
    process.stdout.write(msg + "\n");
  }
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const { root: rootArg, sessionId } = parseArgs(argv);
  const root = rootArg || process.env.CLAUDE_PROJECT_DIR || ".";
  const claudeDir = path.join(root, ".claude");

  // An explicit `--session` is taken as given but still VALIDATED, never sanitised: an id outside
  // `^[A-Za-z0-9_-]{1,128}$` resolves to null and gets the listing below rather than being coerced
  // into a path. Otherwise, the invoking session. Either way this reads exactly ONE session's
  // directory — never a merge of several, which would attribute another run's work to this one.
  const sess = sessionId ? sessionPathsFor(claudeDir, sessionId) : resolveSessionPaths(claudeDir);
  if (!sess) {
    reportNoSession(claudeDir, sessionId, asJson);
    process.exit(0);
  }

  const logFile = sess.log;
  const entries = parseLog(logFile);
  if (entries === null || entries.length === 0) {
    const msg =
      "No Maestro session log found at " +
      logFile +
      ".\nThe post-mortem reads the live session log, which is ephemeral and deleted at SessionEnd.\nRun /maestro-post-mortem during an active Maestro session that has done some work.";
    if (asJson) {
      process.stdout.write(JSON.stringify({ error: "no-log", logFile, message: msg }, null, 2) + "\n");
    } else {
      process.stdout.write(msg + "\n");
    }
    process.exit(0);
  }

  const session = readJson(sess.state);
  const a = analyze(entries, session);
  if (asJson) {
    process.stdout.write(JSON.stringify(a, null, 2) + "\n");
  } else {
    process.stdout.write(renderMarkdown(a) + "\n");
  }
  process.exit(0);
}

main();
