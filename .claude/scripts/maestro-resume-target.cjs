#!/usr/bin/env node
// Resume-target lookup for a condition-edge loop-back (`039`).
//
//   node maestro-resume-target.cjs "<agent type>"
//
// Prints the `agent_id` the orchestrator should RESUME with `SendMessage` — the id of that agent
// type's most recent completed run THIS session — or prints NOTHING (always exit 0) when there is
// none. Empty output is always safe: it means dispatch a cold `Task` instead.
//
// The index behind this is not new state: maestro-subagent-log.js already appends a
// kind:"handoff" entry to maestro_session.log.jsonl on every SubagentStop that carries a real
// agent_type, keyed by that type and stamped with the agent_id that ran. This CLI is a read over
// that log, in the family of maestro-set-session-workflow.cjs and maestro-task-status.cjs — a
// small tool the orchestrator can reach from its allowed-tools frontmatter rather than being asked
// to grep a jsonl file by hand.
//
// The resolution itself — bared agent-name matching, most-recent-wins, and refusing to answer when
// the active workflow's search list resolves this type to more than one DISTINCT instance (the
// ambiguity that would make a resume attach the wrong instance's history under a shared agent
// name) — lives in agent-runs.ts / success-path.ts, shared with the desktop app via
// lib/maestro-session.cjs. This script is the thinnest possible wrapper: read the three inputs,
// call resumeTarget, print or don't.
//
// Self-contained on purpose: maestro-install.js copies this file into the project's
// .claude/scripts/ so the orchestrator can run it via $CLAUDE_PROJECT_DIR.

const fs = require("fs");
const path = require("path");
const { readJson, readSession, sessionLogPath, resumeTarget } = require("./lib/maestro-session.cjs");

function readLogLines(p) {
  let text;
  try {
    text = fs.readFileSync(p, "utf8");
  } catch {
    return [];
  }
  const lines = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    try {
      lines.push(JSON.parse(raw));
    } catch {
      // A malformed line is skipped, not fatal — best-effort read of a hook-written log.
    }
  }
  return lines;
}

try {
  const agentType = process.argv[2] || "";
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const claudeDir = path.join(projectDir, ".claude");

  if (agentType) {
    const cfg = readJson(path.join(claudeDir, "maestro.json"));
    if (cfg && cfg.version === 3) {
      const session = readSession(path.join(claudeDir, "maestro_session.json"));
      const lines = readLogLines(sessionLogPath(claudeDir));
      const id = resumeTarget(lines, cfg, session, agentType);
      if (id) process.stdout.write(id + "\n");
    }
  }
} catch {
  // Best-effort — empty output (spawn cold) is always the safe fallback.
}

process.exit(0);
