#!/usr/bin/env node
// Prints this project's Step 1 gate configuration as ONE directive line, for injection into the
// orchestrator skill body through Claude Code's !`command` dynamic-context syntax:
//
//   !`node "$CLAUDE_PROJECT_DIR/.claude/scripts/maestro-step1-gates.cjs"`
//
// Reads `gates` from <projectDir>/.claude/maestro.json and prints THE WHOLE OF STEP 1 for this
// project — not a flag the skill body then branches on. All four combinations are valid and none is
// nested under another: the design check runs on its own perfectly well, and neither on means the
// line simply says to continue to Step 2.
//
// The template's Step 1 is three lines that amount to "do what the injected line says", plus the
// one thing this script cannot speak to: what to do when its output never arrives at all. Keep it
// that way. Moving a branch back into SKILL.md costs tokens on every orchestration including the
// default (both gates off) and gives the wording somewhere to drift from the logic — the argument
// maestro-check-runtime.cjs's header already makes at length.
//
// THE CONTRACT, and every clause of it is load-bearing:
//
//   * Takes NO arguments.
//   * Exits 0 unconditionally, and writes NOTHING to stderr. There is no failure branch. An
//     injected command that exits non-zero ABORTS the whole skill invocation, and Claude then
//     never sees the orchestrator body at all — so every degenerate case (no maestro.json, a
//     corrupt one, version !== 3, no `gates`, a `gates` that isn't a plain object, a gate whose
//     value isn't a boolean, any unexpected throw) resolves quietly to LINES.none rather than
//     to an error. That is the same "absent means off" stance `resolveGates` takes in
//     apps/maestro/src/core/config.ts, which this file mirrors — it cannot import from src/core,
//     so a change to that rule needs the same change here.
//   * Writes exactly one newline-terminated line on stdout, one of the four in LINES below. One
//     line even though each is now several sentences: it keeps the contract trivially assertable,
//     and the skill body refers to "the line above".
//
// Self-contained on purpose: the installers copy it into the project's .claude/scripts/ so the
// orchestrator skill can name it by $CLAUDE_PROJECT_DIR path.

const fs = require("fs");
const path = require("path");

// The WHOLE of Step 1, one sentence-set per resolved state — not a terse flag the template then
// branches on. Same collapse maestro-check-runtime.cjs makes with its INSTRUCTIONS map, and for the
// same reason: a branch table in SKILL.md is re-read at the top of every single orchestration
// including the common one, and prose that re-derives a decision made here can disagree with it.
// The template's Step 1 is now "do what this line says", so these are what the orchestrator obeys.
const LINES = {
  both:
    "Step 1 — run these two gates now, in this order, and no others: /confidence-check, then " +
    "/use-design-check. Use the Skill tool for each, in your own context — never dispatch a " +
    "subagent for them. If confidence is low, gather more information; if the design check raises " +
    "issues, address them. Both are gates on the same thing — that the request is understood well " +
    "enough to commit a workflow to it — so clear them before Step 2. If this project doesn't " +
    "actually have one of them, skip it and say so; never invent one. Then continue to Step 2.",
  confidence:
    "Step 1 — run this one gate now, and no others: /confidence-check. Use the Skill tool, in your " +
    "own context — never dispatch a subagent for it. If confidence is low, gather more information " +
    "before committing a workflow to the request. If this project doesn't actually have that " +
    "skill, skip it and say so; never invent one. Then continue to Step 2.",
  design:
    "Step 1 — run this one gate now, and no others: /use-design-check. Use the Skill tool, in your " +
    "own context — never dispatch a subagent for it. If it raises issues, address them before " +
    "committing a workflow to the request. If this project doesn't actually have that skill, skip " +
    "it and say so; never invent one. Then continue to Step 2.",
  // Printed rather than staying silent on purpose: an explicit line says the script RAN and the
  // answer is deliberate. Silence is indistinguishable from a broken or missing script, which the
  // template has to treat the same way but for a different reason.
  none: "Step 1 — no gates are enabled for this project. Do nothing here; continue straight to Step 2.",
};

function gateLine(projectDir) {
  let config = null;
  try {
    config = JSON.parse(fs.readFileSync(path.join(projectDir, ".claude", "maestro.json"), "utf8"));
  } catch {
    return LINES.none; // absent, unreadable, or not JSON
  }
  if (!config || typeof config !== "object" || config.version !== 3) return LINES.none;

  const gates = config.gates;
  if (!gates || typeof gates !== "object" || Array.isArray(gates)) return LINES.none;

  // Strict `=== true`: a string, a number, null or a missing field is off, never truthy.
  const confidence = gates.confidence_check === true;
  const design = gates.use_design_check === true;

  if (confidence && design) return LINES.both;
  if (confidence) return LINES.confidence;
  if (design) return LINES.design;
  return LINES.none;
}

let line = LINES.none;
try {
  line = gateLine(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
} catch {
  // Belt and braces: gateLine already swallows the expected failures, and anything it doesn't
  // must still not take the orchestrator down with it.
  line = LINES.none;
}
process.stdout.write(line + "\n");
process.exit(0);
