#!/usr/bin/env node
// /maestro-post-mortem helper — condenses <project>/.claude/maestro_session.log.jsonl
// into a compact digest the skill reasons over (instead of dumping the raw,
// message-heavy log into the model's context).
//
// Read-only: parses the append-only session log + maestro_session.json, prints a
// markdown digest (default) or a structured object (--json) to stdout, and
// never edits or deletes anything.
//
//   node maestro-post-mortem.js <projectRoot> [--json]
//
// The digest is deterministic and cheap: a session summary, the dispatch↔handoff
// timeline correlated by agent_id, and heuristic FLAGS (repeated reads, edit
// thrash, typecheck/test/lint runs, long tool runs). The flags are LEADS, not
// verdicts — the skill couples them with the main session's own context to
// decide what actually went wrong.

const fs = require("fs");
const path = require("path");
const { readJson, sessionLogPath } = require("./lib/maestro-session.cjs");

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

function analyze(entries, session) {
  const toolCalls = entries.filter((e) => !e.kind);
  const dispatches = entries.filter((e) => e.kind === "dispatch");
  const handoffs = entries.filter((e) => e.kind === "handoff");

  // counts per origin
  const byOrigin = {};
  for (const e of entries) {
    const o = e.origin || "unknown";
    byOrigin[o] = (byOrigin[o] || 0) + 1;
  }

  // correlate dispatch ↔ handoff by agent_id
  const handoffById = {};
  for (const h of handoffs) handoffById[h.agent_id] = h;
  const subagents = dispatches.map((d) => {
    const h = handoffById[d.agent_id];
    return {
      agent: d.agent || "?",
      agent_id: d.agent_id || "",
      input: clip(d.input, INPUT_CLIP),
      status: h ? h.status : "no-return",
      label: h ? h.label : null,
      output: h ? clip(h.output, OUTPUT_CLIP) : null,
    };
  });

  // outcome tally
  const outcomes = {};
  for (const s of subagents) outcomes[s.status] = (outcomes[s.status] || 0) + 1;

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
      dispatches: dispatches.length,
      handoffs: handoffs.length,
      byOrigin,
    },
    outcomes,
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
  const oc = Object.entries(a.outcomes)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ");
  if (oc) L.push(`- **Handoff outcomes**: ${oc}`);
  const bo = Object.entries(a.counts.byOrigin)
    .map(([k, v]) => `${k} (${v})`)
    .join(", ");
  L.push(`- **Activity by origin**: ${bo}`);
  L.push("");

  L.push("## Subagent timeline");
  if (a.subagents.length === 0) {
    L.push("_No subagents dispatched this session._");
  } else {
    for (const s of a.subagents) {
      const tag = s.label ? `${s.status} (${s.label})` : s.status;
      L.push(`- **${s.agent}** \`${s.agent_id}\` → ${tag}`);
      if (s.input) L.push(`  - in: ${s.input}`);
      if (s.output) L.push(`  - out: ${s.output}`);
      if (s.status === "no-return") L.push(`  - ⚠️ no handoff recorded — agent never returned a HANDOFF: line`);
      if (s.status === "unknown") L.push(`  - ⚠️ handoff returned but no parseable HANDOFF: label`);
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

function main() {
  const args = process.argv.slice(2).filter((x) => x !== "--json");
  const asJson = process.argv.includes("--json");
  const root = args[0] || process.env.CLAUDE_PROJECT_DIR || ".";
  const claudeDir = path.join(root, ".claude");
  const logFile = sessionLogPath(claudeDir);

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

  const session = readJson(path.join(claudeDir, "maestro_session.json"));
  const a = analyze(entries, session);
  if (asJson) {
    process.stdout.write(JSON.stringify(a, null, 2) + "\n");
  } else {
    process.stdout.write(renderMarkdown(a) + "\n");
  }
  process.exit(0);
}

main();
