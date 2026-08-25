#!/usr/bin/env node
// PostToolUse hook (matcher: TaskCreate) — validates that each TaskCreate issued
// by the Maestro orchestrator matches a step in the selected workflow's success
// path. Surfaces non-blocking warnings when:
//   - A created task doesn't match any node in the workflow (mismatch).
//   - A success-path step was skipped (e.g. human review never got a task).
//
// Created tasks are tracked across the session in the ephemeral file
// <cwd>/.claude/maestro_session_tasks.json — deleted at SessionEnd alongside
// the other session files. Sequential writes are safe: TaskCreate calls come
// from the main orchestrator session (no parallel-subagent race).
//
// No-op when maestro.json is absent (Maestro not configured for this project).

const fs = require("fs");
const path = require("path");
const {
  readStdin,
  readJson,
  readSession,
  successPathSteps,
  workflowNodeLabels,
} = require("./lib/maestro-session.cjs");

// ---------------------------------------------------------------------------
// Heuristic step-label resolution (fallback when metadata.maestro_step absent)
// ---------------------------------------------------------------------------

function heuristicMatch(subject, description, expectedLabels) {
  const text = `${subject || ""} ${description || ""}`.toLowerCase();

  // Try each expected label in order — first match wins.
  for (const label of expectedLabels) {
    if (label === "human review") {
      if (/human.?review|review.?checkpoint/i.test(text)) return label;
    } else if (label.startsWith("@")) {
      // Agent instance — match the bare name (without @).
      const name = label.slice(1).toLowerCase();
      if (text.includes(name)) return label;
    } else if (label.startsWith("/")) {
      // Skill — match the skill id (without /).
      const skill = label.slice(1).toLowerCase();
      if (text.includes(skill)) return label;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ephemeral task tracker — maestro_session_tasks.json
// ---------------------------------------------------------------------------

function tasksPath(claudeDir) {
  return path.join(claudeDir, "maestro_session_tasks.json");
}

function readTasks(claudeDir) {
  return readJson(tasksPath(claudeDir)) || { steps: [] };
}

function writeTasks(claudeDir, data) {
  const p = tasksPath(claudeDir);
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, p);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  let p = {};
  try {
    p = JSON.parse((await readStdin()) || "{}");
  } catch {
    process.exit(0);
  }

  // Only act on TaskCreate.
  if ((p.tool_name || "") !== "TaskCreate") process.exit(0);

  const cwd = p.cwd || process.env.CLAUDE_PROJECT_DIR || "";
  if (!cwd) process.exit(0);

  const claudeDir = path.join(cwd, ".claude");
  const cfgPath = path.join(claudeDir, "maestro.json");
  if (!fs.existsSync(cfgPath)) process.exit(0); // not a Maestro project

  try {
    const cfg = readJson(cfgPath);
    if (!cfg || cfg.version !== 3) process.exit(0);

    const session = readSession(path.join(claudeDir, "maestro_session.json"));
    if (!session.workflow) process.exit(0); // no active workflow yet

    const wf = (cfg.workflows || []).find((w) => w.name === session.workflow);
    if (!wf) process.exit(0); // workflow not found in config

    const instances = cfg.workflow_instances || [];
    const expected = successPathSteps(wf, instances);
    if (expected.length === 0) process.exit(0); // nothing to validate against

    const allLabels = workflowNodeLabels(wf, instances);

    // --- Resolve the created task's step label ---
    const ti = p.tool_input || {};
    let resolvedLabel =
      (ti.metadata && ti.metadata.maestro_step) ||
      heuristicMatch(ti.subject, ti.description, [...allLabels]) ||
      null;

    // "mark-task-done" is a synthetic terminal step the orchestrator appends when
    // the run came from a task-queue file (it runs maestro-task-status.cjs done at
    // the very end). It's not a node in the workflow graph, so accept it as valid
    // and skip coverage checks — otherwise it would trip the mismatch warning below.
    if (resolvedLabel === "mark-task-done") process.exit(0);

    // --- Track created steps ---
    const tracker = readTasks(claudeDir);
    if (resolvedLabel) {
      tracker.steps.push(resolvedLabel);
    }
    writeTasks(claudeDir, tracker);

    // --- Compute warnings ---
    const warnings = [];

    if (!resolvedLabel) {
      // Unclassifiable — soft note, not a hard mismatch.
      // No warning emitted; the task simply won't count toward coverage.
      process.exit(0);
    }

    // Mismatch: label is not any node in this workflow.
    if (!allLabels.has(resolvedLabel)) {
      warnings.push(
        `task "${ti.subject || "(untitled)"}" resolved to "${resolvedLabel}" which doesn't match any step in workflow "${session.workflow}" (expected: ${expected.join(" → ")})`
      );
    }

    // Skipped step: label is on the success path, but earlier steps have no task yet.
    const idx = expected.indexOf(resolvedLabel);
    if (idx > 0) {
      const createdSet = new Set(tracker.steps);
      const skipped = expected.slice(0, idx).filter((s) => !createdSet.has(s));
      if (skipped.length > 0) {
        warnings.push(
          `created "${resolvedLabel}" but earlier step(s) [${skipped.join(", ")}] have no task yet — did you skip them?`
        );
      }
    }

    if (warnings.length === 0) process.exit(0);

    // --- Emit warnings ---
    const detail = warnings.join("; ");
    const pathStr = expected.join(" → ");
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: `⚠️ Maestro task check: ${detail}. The selected workflow "${session.workflow}" expects: ${pathStr}. Add the missing task(s) before continuing.`,
        },
        systemMessage: `⚠️ Maestro: ${detail}`,
      })
    );
  } catch {
    // Validation errors must never fail the TaskCreate.
  }
  process.exit(0);
})();
