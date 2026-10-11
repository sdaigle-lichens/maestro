#!/usr/bin/env node
// Fork a plugin (or user-tier) agent into this project's `.claude/agents/` from the terminal — what
// `/agents` -> "Fork into this project" does in the desktop app (`081`). The `maestro-team-meeting`
// skill runs it to apply an approved `agent.fork` proposal.
//
//   node maestro-agent-fork.cjs <agent> [--as <new-name>] [projectDir]
//
// NOT A SECOND IMPLEMENTATION. `forkAgent` in `lib/maestro-agent-fork.cjs` is apps/maestro's own
// `forkAgent` (generated from `src/core/agent-fork.ts`): the same file copy, the same
// `agent-forks.json` provenance record and the same attribute-row copy for a renamed fork, so a fork
// made here reaches the same `computeAgentSync` verdict as one made in the app. This script adds
// only argument parsing and the one thing the app's main process supplies and a terminal does not:
// the `maestro` plugin as it ships right now (its agents directory and version), taken from the
// plugin this script sits in.
//
// Prints ONE line of JSON. Exit 0 with `ok:true` on a fork, exit 1 with `ok:false` and a `reason` on
// a refusal (no such agent, already a project agent, bad name, name taken, ...). Runs from the plugin
// and is never copied into a project. The lib requires `node:sqlite` (a renamed fork writes three
// global stores), so on a `node` older than 22.5 this refuses instead of throwing.

const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function refuse(reason) {
  out({ ok: false, reason });
  process.exit(1);
}

function parseArgs(args) {
  const positional = [];
  let as = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--as") {
      as = args[i + 1] ?? null;
      i++;
    } else if (args[i].startsWith("--")) {
      refuse(`unknown option ${args[i]}`);
    } else {
      positional.push(args[i]);
    }
  }
  return { agent: positional[0] || null, as, projectArg: positional[1] || null };
}

/** The plugin this script ships in: its agents directory and `plugin.json` version. */
function ownPlugin() {
  const root = path.resolve(__dirname, "..");
  let version = null;
  try {
    version = JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8")).version || null;
  } catch {
    // version stays null, which forkAgent records as an unversioned plugin fork
  }
  const agentsDir = path.join(root, "agents");
  return { agentsDir: fs.existsSync(agentsDir) ? agentsDir : null, version };
}

(async () => {
  const { agent, as, projectArg } = parseArgs(argv);
  if (!agent) refuse("usage: maestro-agent-fork.cjs <agent> [--as <new-name>] [projectDir]");
  const projectDir = path.resolve(projectArg || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (!fs.existsSync(projectDir)) refuse(`project directory ${projectDir} does not exist`);

  let lib;
  try {
    lib = require("./lib/maestro-agent-fork.cjs");
  } catch (err) {
    refuse(
      `could not load lib/maestro-agent-fork.cjs (${err && err.message ? err.message : err}). ` +
        "Forking needs node 22.5 or newer; otherwise use /agents in the Maestro desktop app."
    );
  }

  const bare = agent.includes(":") ? agent.slice(agent.indexOf(":") + 1) : agent;
  const plugin = ownPlugin();
  try {
    const result = await lib.forkAgent(projectDir, plugin.agentsDir, plugin.version, bare, as || undefined);
    const record = lib.readAgentForks(projectDir)[result.name] || null;
    out({
      ok: true,
      name: result.name,
      file: path.relative(projectDir, result.file),
      template: bare,
      sourceTier: record ? record.sourceTier : null,
      sourcePlugin: record ? record.sourcePlugin : null,
      pluginVersion: record ? record.pluginVersion : null,
    });
  } catch (err) {
    refuse(err && err.message ? err.message : String(err));
  }
})();
