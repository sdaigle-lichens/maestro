#!/usr/bin/env node
// PreToolUse hook (matcher: Write|Edit|MultiEdit|NotebookEdit) — confines the reviewer and
// refactor agents' file writes to `<cwd>/.claude/channels/`, so they can hand a payload to the
// next agent without being able to modify code, docs or config. Every other agent is untouched.
//
// Registered only from the plugin's hooks.json (the agents are shipped by the plugin), so it needs
// no project-local twin and no arbitration. Deliberately NOT gated on maestro.json: the agents'
// frontmatter no longer carries `disallowedTools`, so this hook is the only thing standing between
// them and a write anywhere. Logic: apps/maestro/src/core/channel-write-guard.ts.

const { readStdin, checkChannelWrite, isChannelOnlyAgent } = require("./lib/maestro-session.cjs");

(async () => {
  let p = {};
  try {
    p = JSON.parse((await readStdin()) || "{}");
  } catch {
    process.exit(0);
  }

  let verdict;
  try {
    verdict = checkChannelWrite({
      cwd: p.cwd || "",
      agentType: p.agent_type,
      toolName: p.tool_name,
      toolInput: p.tool_input,
    });
  } catch (err) {
    // A restricted agent must fail closed; anyone else was never in scope.
    if (!isChannelOnlyAgent(p.agent_type)) process.exit(0);
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
