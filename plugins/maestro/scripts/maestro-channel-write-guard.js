#!/usr/bin/env node
// PreToolUse hook (matcher: Write|Edit|MultiEdit|NotebookEdit) — confines the reviewer and
// refactor agents' file writes to `<cwd>/.claude/channels/`, so they can hand a payload to the
// next agent without being able to modify code, docs or config. Every other agent is untouched.
//
// Registered only from the plugin's hooks.json (the agents are shipped by the plugin), so it needs
// no project-local twin and no arbitration. Deliberately NOT gated on maestro.json: the agents'
// frontmatter no longer carries `disallowedTools`, so this hook is the only thing standing between
// them and a write anywhere. Logic: apps/maestro/src/core/channel-write-guard.ts.

//
// Team meetings: while this session's session.json carries a `meeting` naming this agent type as a
// participant, ANY agent type is confined to `<session dir>/meeting/` instead (see
// apps/maestro/src/core/meeting-mode.ts). Only a subagent call is in scope — the main session's
// PreToolUse payload carries no `agent_type`, so the moderator can still apply approved changes.

const path = require("path");
const {
  readStdin,
  readJson,
  checkChannelWrite,
  isChannelOnlyAgent,
  resolveSessionPaths,
  meetingFor,
  meetingDirFor,
} = require("./lib/maestro-session.cjs");

(async () => {
  let p = {};
  try {
    p = JSON.parse((await readStdin()) || "{}");
  } catch {
    process.exit(0);
  }

  let verdict;
  let participant = false;
  try {
    let meetingDir = null;
    if (p.agent_type && p.cwd) {
      const sess = resolveSessionPaths(path.join(p.cwd, ".claude"), p);
      if (sess && meetingFor(readJson(sess.state), p.agent_type)) {
        participant = true;
        meetingDir = meetingDirFor(sess.dir);
      }
    }
    verdict = checkChannelWrite({
      cwd: p.cwd || "",
      agentType: p.agent_type,
      toolName: p.tool_name,
      toolInput: p.tool_input,
      meetingDir,
    });
  } catch (err) {
    // A restricted agent or a meeting participant must fail closed; anyone else was never in scope.
    if (!participant && !isChannelOnlyAgent(p.agent_type)) process.exit(0);
    verdict = { allow: false, reason: `Blocked: channel write check failed (${err && err.message}).` };
  }

  if (!verdict.allow) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: verdict.reason,
        },
      })
    );
  }
  process.exit(0);
})();
