#!/usr/bin/env node
// SubagentStart / SubagentStop hook — appends communication entries to the same
// maestro_session.log.jsonl as maestro-session-log.js (PreToolUse).
//
// SubagentStart  → dispatch entry:  who was called, with the full spawning message.
// SubagentStop   → handoff entry:   the agent's outcome, parsed from its HANDOFF: line,
//                                   with the full final message for debugging.
//
// Both are no-ops when maestro.json is absent (Maestro not configured for this project).
// Entries use kind:"dispatch"/"handoff" so the reader can distinguish them from
// the plain tool-call entries written by maestro-session-log.js.
// Append-only to the same file so parallel subagents don't race.

const fs = require("fs");
const path = require("path");
const {
  readStdin,
  appendSessionLog,
  readJson,
  readSession,
  resolveSearchList,
  collectAgentSkills,
} = require("./lib/maestro-session.cjs");

// Resolve the loaded/referenced skills the SubagentStart hook would offer this
// agent, so the dispatch entry records what was on the table. /session-log diffs
// this against the agent's reported skillsTriage to surface silent omissions.
// Uses the same resolveSearchList + collectAgentSkills as maestro-inject-agent-context.js,
// so the logged set can't drift from the injected one. Returns null on any miss.
function offeredSkills(claudeDir, agentType) {
  if (!agentType) return null;
  const cfg = readJson(path.join(claudeDir, "maestro.json"));
  if (!cfg || cfg.version !== 3) return null;
  const session = readSession(path.join(claudeDir, "maestro_session.json"));
  const { searchList } = resolveSearchList(cfg, session);
  const { loaded, referenced, matchedInstances } = collectAgentSkills(
    searchList,
    cfg.workflow_instances || [],
    agentType
  );
  if (matchedInstances.length === 0) return null;
  return { loaded, referenced };
}

// Parse the HANDOFF: label from the agent's final message.
// Tolerates backticks, asterisks, and surrounding whitespace, e.g.:
//   HANDOFF: success
//   `HANDOFF: success`
//   **HANDOFF: tests_failed**
// Takes the LAST occurrence so a model preamble doesn't shadow the terminal line.
function parseHandoff(msg) {
  if (!msg || typeof msg !== "string") return { status: "unknown", label: null };
  const matches = [...msg.matchAll(/[`*]*HANDOFF:\s*([^\n`*]+)[`*]*/gi)];
  if (matches.length === 0) return { status: "unknown", label: null };
  const raw = matches[matches.length - 1][1].trim();
  if (!raw) return { status: "unknown", label: null };
  const label = raw;
  const status = label.toLowerCase() === "success" ? "success" : "condition";
  return { status, label };
}

(async () => {
  let p = {};
  try {
    p = JSON.parse((await readStdin()) || "{}");
  } catch {
    process.exit(0);
  }

  const cwd = p.cwd || process.env.CLAUDE_PROJECT_DIR || "";
  if (!cwd) process.exit(0);

  const claudeDir = path.join(cwd, ".claude");
  if (!fs.existsSync(path.join(claudeDir, "maestro.json"))) process.exit(0);

  const event = p.hook_event_name || "";
  const agentType = p.agent_type || "";
  const agentId = p.agent_id || "";
  const lastMsg = p.last_assistant_message || null;

  try {
    if (event === "SubagentStart") {
      const offered = offeredSkills(claudeDir, agentType);
      appendSessionLog(claudeDir, {
        ts: new Date().toISOString(),
        origin: "main_session",
        kind: "dispatch",
        agent: agentType,
        agent_id: agentId,
        input: lastMsg,
        ...(offered ? { offered_skills: offered } : {}),
        log: `→ ${agentType}`,
      });
    } else if (event === "SubagentStop") {
      if (!agentType) {
        // No agent_type → this SubagentStop isn't a real workflow agent handing
        // off (e.g. the /ai-tools listen-loop pausing for the user). Log it as a
        // transition boundary rather than letting it fall back to "unknown".
        appendSessionLog(claudeDir, {
          ts: new Date().toISOString(),
          origin: "transition",
          kind: "transition",
          output: lastMsg,
          log: "transition",
        });
      } else {
        const { status, label } = parseHandoff(lastMsg);
        appendSessionLog(claudeDir, {
          ts: new Date().toISOString(),
          origin: agentType,
          kind: "handoff",
          agent_id: agentId,
          status,
          label,
          output: lastMsg,
          log: label ? `HANDOFF: ${label}` : "HANDOFF: (none)",
        });
      }
    }
  } catch {
    // Best-effort — never fail the agent on a logging error.
  }

  process.exit(0);
})();
