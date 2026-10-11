#!/usr/bin/env node
// Move or unassign a project rule from the terminal — what dropping a rule's chip on a row of
// `/rules` and pressing Save does in the desktop app (`081`). The `maestro-team-meeting` skill runs
// it to apply an approved `rule.move` proposal.
//
//   node maestro-rules.cjs list [projectDir]
//   node maestro-rules.cjs move <rule-id> --to <dir|.> [--scope-only] [projectDir]
//   node maestro-rules.cjs unassign <rule-id> [projectDir]
//
// NOT A SECOND IMPLEMENTATION. `lib/maestro-rule-move.cjs` is apps/maestro's `rule-move.ts`
// (generated), which reads maestro.json immediately before writing and then calls the app's own
// `saveConfig` (rules slice merge -> orchestrator re-render -> `applyRules`). So the file lands where
// /rules would put it, every other slice of maestro.json is preserved, and /rules shows the result as
// a normal assignment. A maestro.json that is missing or not v3 is refused, never overwritten.
//
// Prints ONE line of JSON. Exit 0 with `ok:true`, exit 1 with `ok:false` and a `reason` on a refusal.
// Runs from the plugin and is never copied into a project.

const fs = require("fs");
const path = require("path");

const argv = process.argv.slice(2);

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function refuse(reason, extra) {
  out({ ok: false, reason, ...(extra || {}) });
  process.exit(1);
}

const USAGE =
  "usage: maestro-rules.cjs list [projectDir] | move <rule-id> --to <dir|.> [--scope-only] [projectDir] | unassign <rule-id> [projectDir]";

function parseArgs(args) {
  const positional = [];
  let to = null;
  let scopeOnly = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--to") {
      to = args[i + 1] ?? null;
      i++;
    } else if (a === "--scope-only") {
      scopeOnly = true;
    } else if (a.startsWith("--")) {
      refuse(`unknown option ${a}`);
    } else {
      positional.push(a);
    }
  }
  return { positional, to, scopeOnly };
}

(async () => {
  const { positional, to, scopeOnly } = parseArgs(argv);
  const command = positional[0];
  if (!command) refuse(USAGE);

  let lib;
  try {
    lib = require("./lib/maestro-rule-move.cjs");
  } catch (err) {
    refuse(`could not load lib/maestro-rule-move.cjs (${err && err.message ? err.message : err})`);
  }

  const takesId = command === "move" || command === "unassign";
  if (!takesId && command !== "list") refuse(`unknown command "${command}". ${USAGE}`);
  const ruleId = takesId ? positional[1] : null;
  if (takesId && !ruleId) refuse(`${command} needs a rule id. ${USAGE}`);
  const projectArg = takesId ? positional[2] : positional[1];
  const projectDir = path.resolve(projectArg || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (!fs.existsSync(projectDir)) refuse(`project directory ${projectDir} does not exist`);

  try {
    if (command === "list") {
      out({ ok: true, rules: lib.listRules(projectDir) });
      return;
    }
    if (command === "move") {
      if (to === null) refuse(`move needs --to <dir|.>. ${USAGE}`);
      const result = await lib.moveRule(projectDir, ruleId, to, { scopeOnly });
      out(result);
      if (!result.ok) process.exit(1);
      return;
    }
    const result = await lib.unassignRule(projectDir, ruleId);
    out(result);
    if (!result.ok) process.exit(1);
  } catch (err) {
    refuse(err && err.message ? err.message : String(err));
  }
})();
