#!/usr/bin/env node
// SubagentStart / SubagentStop hook — appends communication entries to the same per-session
// log.jsonl as maestro-session-log.js (PreToolUse): <cwd>/.claude/maestro_sessions/<id>/log.jsonl.
//
// SubagentStart  → dispatch entry:  who was called, with the full spawning message.
// SubagentStop   → handoff entry:   the agent's outcome, parsed from its HANDOFF: line,
//                                   with the full final message for debugging; then (`036`)
//                                   stamps every unstamped `.claude/channels/*/<this agent>.*`
//                                   file this agent just wrote with the run's own id — see
//                                   apps/maestro/src/core/handoff-channels.ts.
//
// Both are no-ops when maestro.json is absent (Maestro not configured for this project).
// Entries use kind:"dispatch"/"handoff" so the reader can distinguish them from
// the plain tool-call entries written by maestro-session-log.js.
// Append-only to the same file so parallel subagents don't race.
//
// TEAM MEETINGS: for an agent type listed as a participant of this session's active meeting
// (apps/maestro/src/core/meeting-mode.ts), both entries carry `meeting: true` — which keeps the run
// out of `agentRunsFromLog` (no later loop-back resumes a meeting turn) and lets the post-mortem
// digest label it — and SubagentStop skips the `078` transcript recovery and the channel stamping:
// a meeting turn has no HANDOFF to recover, and anything it left in a lane must not be delivered
// into a workflow step as this run's payload.

const fs = require("fs");
const path = require("path");
const {
  readStdin,
  appendSessionLog,
  readJson,
  readSession,
  resolveSearchList,
  collectAgentSkills,
  bareAgentName,
  projectOwnsHook,
  ensureSessionRunId,
  writeStamp,
  meetingLeftovers,
  ensureSessionPaths,
  sendMessageHandoff,
  meetingFor,
} = require("./lib/maestro-session.cjs");

// Resolve the loaded/referenced skills the SubagentStart hook would offer this
// agent, so the dispatch entry records what was on the table. /session-log diffs
// this against the agent's reported skillsTriage to surface silent omissions.
// Uses the same resolveSearchList + collectAgentSkills as maestro-inject-agent-context.js,
// so the logged set can't drift from the injected one. Returns null on any miss.
function offeredSkills(claudeDir, agentType, sessionStatePath) {
  if (!agentType) return null;
  const cfg = readJson(path.join(claudeDir, "maestro.json"));
  if (!cfg || cfg.version !== 3) return null;
  const session = readSession(sessionStatePath);
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

  // Both delivery paths can register this hook. When the project registers its own copy, THIS
  // copy — the plugin's, running from the marketplace cache — stands down, so nothing fires twice.
  // A no-op in the copy installed into the project. See src/core/hook-arbitration.ts.
  if (projectOwnsHook(__filename, cwd, p.hook_event_name)) process.exit(0);

  const claudeDir = path.join(cwd, ".claude");
  if (!fs.existsSync(path.join(claudeDir, "maestro.json"))) process.exit(0);

  // `064`: which session's directory does this dispatch/handoff belong in? The payload's own
  // `session_id` (a subagent's payload carries the MAIN session's id, so one workflow run is one
  // directory), else CLAUDE_CODE_SESSION_ID, else nothing — and nothing means a silent no-op,
  // because a `run_id` minted into a shared file is exactly the cross-session bleed `064` removes.
  const sess = ensureSessionPaths(claudeDir, p);
  if (!sess) process.exit(0);

  const event = p.hook_event_name || "";
  const agentType = p.agent_type || "";
  const agentId = p.agent_id || "";
  const lastMsg = p.last_assistant_message || null;
  // A meeting participant's run (null for everyone else, and whenever no meeting runs).
  const inMeeting = agentType ? !!meetingFor(readJson(sess.state), agentType) : false;
  const meetingMark = inMeeting ? { meeting: true } : {};

  try {
    if (event === "SubagentStart") {
      const offered = offeredSkills(claudeDir, agentType, sess.state);
      appendSessionLog(
        claudeDir,
        {
          ts: new Date().toISOString(),
          origin: "main_session",
          kind: "dispatch",
          agent: agentType,
          agent_id: agentId,
          input: lastMsg,
          ...(offered ? { offered_skills: offered } : {}),
          ...meetingMark,
          log: inMeeting ? `→ ${agentType} (meeting)` : `→ ${agentType}`,
        },
        p
      );
    } else if (event === "SubagentStop") {
      if (!agentType) {
        // No agent_type → this SubagentStop isn't a real workflow agent handing
        // off (e.g. the /ai-tools listen-loop pausing for the user). Log it as a
        // transition boundary rather than letting it fall back to "unknown".
        appendSessionLog(
          claudeDir,
          {
            ts: new Date().toISOString(),
            origin: "transition",
            kind: "transition",
            output: lastMsg,
            log: "transition",
          },
          p
        );
      } else {
        let handoffMsg = lastMsg;
        let { status, label } = parseHandoff(handoffMsg);
        // `078`: an agent that hands back through a SendMessage call has no HANDOFF: line in its
        // final message. Recover it from the agent's own transcript so the entry is not `unknown`.
        if (!inMeeting && status === "unknown" && p.agent_transcript_path) {
          try {
            const viaSend = sendMessageHandoff(fs.readFileSync(p.agent_transcript_path, "utf8"));
            if (viaSend) {
              handoffMsg = viaSend;
              ({ status, label } = parseHandoff(viaSend));
            }
          } catch {
            // No readable transcript — keep the unknown entry.
          }
        }
        // `p.transcript_path` here is `SubagentStopHookInput`'s own field — the SAME file the main
        // thread and every sibling subagent share (only `p.agent_transcript_path` is private to
        // this agent, and deriveUsage doesn't read it — see session-usage.ts's header). Treat this
        // handoff's ctx_pct as an estimate under parallel subagents, same caveat as every other kind.
        appendSessionLog(
          claudeDir,
          {
            ts: new Date().toISOString(),
            origin: agentType,
            kind: "handoff",
            agent_id: agentId,
            status,
            label,
            output: handoffMsg,
            ...meetingMark,
            log: inMeeting ? "meeting turn" : label ? `HANDOFF: ${label}` : "HANDOFF: (none)",
          },
          p
        );
        if (inMeeting) process.exit(0);

        // `036`: stamp every unstamped channel file THIS agent just wrote, under whichever
        // receiver's lane it landed in, with the run's own id. Only the sender's own SubagentStop
        // does this — matched on the filename's sender segment against this agent's own bare
        // type — which is what keeps two parallel subagents from stamping each other's writes. A
        // file this agent was killed before writing (or never wrote) simply isn't found; a file it
        // wrote but the process died before this hook ran stays unstamped, and is treated exactly
        // like a foreign-run file by the receiving agent's SubagentStart.
        //
        // Minus a team meeting's leftovers: an unstamped file a participant left in a lane (Bash
        // writes are invisible to the write guard) is recorded in session.json when the meeting
        // ends, and stays unstamped while unchanged — the run_id lasts the whole session, so
        // otherwise this sender's next workflow run would adopt it as its own payload. No meeting
        // ever held = nothing skipped, the pre-meeting behaviour.
        try {
          const runId = ensureSessionRunId(sess.state);
          writeStamp(cwd, bareAgentName(agentType), runId, { skip: meetingLeftovers(readJson(sess.state)) });
        } catch {
          // Best-effort — never fail the agent on a stamping error.
        }
      }
    }
  } catch {
    // Best-effort — never fail the agent on a logging error.
  }

  process.exit(0);
})();
