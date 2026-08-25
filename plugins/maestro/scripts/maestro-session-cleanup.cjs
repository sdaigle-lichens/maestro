#!/usr/bin/env node
// SessionEnd hook — the PROJECT-LOCAL cleanup, copied into <project>/.claude/scripts/ by the
// desktop app's installer (apps/maestro/src/core/install.ts).
//
// It removes the ephemeral Maestro session files and nothing else:
//   maestro_session.json, maestro_session.log.jsonl, maestro_session_tasks.json
// The source of truth (.claude/maestro.json) and the orchestrator skill are kept.
//
// Why this exists next to maestro-session-cleanup.sh, now that both do the same thing: the .sh
// runs from the plugin, this runs from the project, and node rather than bash is what makes the
// project-local copy portable — the .sh shells out to python3 to parse the hook payload, which a
// project cannot assume is installed.
//
// Reads the hook payload on stdin; no-op when it carries no cwd.

const fs = require("fs");
const path = require("path");
const { readStdin } = require("./lib/maestro-session.cjs");

const EPHEMERAL = ["maestro_session.json", "maestro_session.log.jsonl", "maestro_session_tasks.json"];

async function main() {
  let payload = {};
  try {
    payload = JSON.parse((await readStdin()) || "{}");
  } catch {
    return;
  }
  const cwd = payload.cwd;
  if (!cwd) return;
  for (const name of EPHEMERAL) {
    try {
      fs.rmSync(path.join(cwd, ".claude", name), { force: true });
    } catch {
      // A session file we cannot delete is not worth failing the session's exit over.
    }
  }
}

main().then(
  () => process.exit(0),
  () => process.exit(0),
);
