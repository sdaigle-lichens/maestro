// Shared helpers for the Maestro hook scripts (maestro-inject-agent-context.js,
// maestro-subagent-log.js, maestro-session-log.js, maestro-validate-tasks.js).
// Plain Node built-ins only — plugins ship without node_modules.

const fs = require("fs");
const path = require("path");

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
  });
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

// Active workflow name resolution: an explicit name wins, otherwise the first
// configured workflow, otherwise "default".
function resolveWorkflowName(cfg, explicit) {
  if (explicit) return explicit;
  const workflows = (cfg && cfg.workflows) || [];
  return (workflows[0] && workflows[0].name) || "default";
}

function readSession(p) {
  return readJson(p) || { workflow: null, generated_instances: [] };
}

function writeSession(p, session) {
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(session, null, 2));
  fs.renameSync(tmp, p);
}

// ---------------------------------------------------------------------------
// Skill resolution — shared between maestro-inject-agent-context.js (which
// injects the skills) and maestro-subagent-log.js (which logs what was offered
// so /session-log can diff it against the agent's reported triage). Single
// source of truth so the injected set and the logged set can't drift.
// ---------------------------------------------------------------------------

// Resolve which workflow(s) to search for an agent's instance, mirroring the
// active-workflow / fallback / union-and-warn logic. Returns { searchList,
// warning, activeWorkflowName }. `warning` is non-null only in the degraded cases.
function resolveSearchList(cfg, session) {
  const workflows = (cfg && cfg.workflows) || [];
  const activeWorkflowName = (session && session.workflow) || null;
  const activeMatches = activeWorkflowName ? workflows.filter((w) => w.name === activeWorkflowName) : [];
  let warning = null;
  let searchList;
  if (activeWorkflowName && activeMatches.length > 0) {
    searchList = activeMatches;
  } else if (activeWorkflowName) {
    searchList = workflows;
    warning =
      `The active workflow "${activeWorkflowName}" (from maestro_session.json) matches no workflow in maestro.json. ` +
      `The skills below are unioned across all workflows and may be wrong — re-run maestro-set-session-workflow.js with a valid workflow name.`;
  } else {
    const fallbackName = resolveWorkflowName(cfg);
    const fallbackMatches = workflows.filter((w) => w.name === fallbackName);
    searchList = fallbackMatches.length > 0 ? fallbackMatches : workflows;
    if (workflows.length > 1) {
      warning =
        `No active workflow is set (maestro-set-session-workflow.js was not run); falling back to the "${fallbackName}" workflow. ` +
        `If you intended a different workflow, the orchestrator should set it before invoking subagents.`;
    }
  }
  return { searchList, warning, activeWorkflowName };
}

// Normalize an agent identifier to its bare frontmatter name. At dispatch time
// Claude Code addresses plugin-provided agents with a namespace prefix
// (e.g. "maestro:frontend"), but maestro.json stores the bare name
// ("frontend"). Strip any "<plugin>:" prefix so the two compare equal.
function bareAgentName(s) {
  return (s || "").split(":").pop();
}

// Collect the loaded/referenced skill sets offered to `agentType` across the
// given workflows. `loaded` (auto-load) wins over `referenced` (load-if-relevant)
// when the same skill appears in both. Also returns the matched instance names.
function collectAgentSkills(searchList, instances, agentType) {
  const instByName = (name) => (instances || []).find((i) => i.name === name);
  const wantAgent = bareAgentName(agentType);
  const loadedSet = new Set();
  const referencedSet = new Set();
  const matchedInstances = [];
  for (const wf of searchList || []) {
    for (const node of wf.nodes || []) {
      if (node.type !== "agent") continue;
      const inst = instByName(node.instance);
      if (!inst || bareAgentName(inst.agent) !== wantAgent) continue;
      matchedInstances.push(node.instance);
      for (const s of inst.loaded_skills || []) loadedSet.add(s);
      for (const s of inst.referenced_skills || []) referencedSet.add(s);
    }
  }
  for (const s of loadedSet) referencedSet.delete(s);
  return {
    loaded: Array.from(loadedSet),
    referenced: Array.from(referencedSet),
    matchedInstances,
  };
}

// ---------------------------------------------------------------------------
// Success-path helpers — shared between the renderer and the validation hook.
// ---------------------------------------------------------------------------

// Human-readable label for a single workflow node.
function nodeLabel(id, wf, instances) {
  if (id === "main-session") return "";
  const n = (wf.nodes || []).find((x) => x.id === id);
  if (!n) return id;
  if (n.type === "agent") {
    const inst = (instances || []).find((i) => i.name === n.instance);
    return "@" + ((inst && inst.name) || n.instance || n.id);
  }
  if (n.type === "skill") return "/" + (n.skill || n.id);
  return "human review";
}

// Ordered array of step labels along the success path of a workflow.
// This is the SOLE source of truth for "what steps the workflow has in order".
function successPathSteps(wf, instances) {
  const out = [];
  let cur = "main-session";
  const seen = new Set();
  while (!seen.has(cur)) {
    seen.add(cur);
    const next = (wf.edges || []).find((e) => e.from === cur && e.kind === "success");
    if (!next) break;
    const label = nodeLabel(next.to, wf, instances);
    if (label) out.push(label);
    cur = next.to;
  }
  return out;
}

// Set of ALL node labels in the workflow (success path + condition targets).
// Used to distinguish "valid node, just off the success path" from "not in this workflow at all".
function workflowNodeLabels(wf, instances) {
  const labels = new Set();
  for (const n of wf.nodes || []) {
    const l = nodeLabel(n.id, wf, instances);
    if (l) labels.add(l);
  }
  return labels;
}

// Tool-call logs are append-only (one JSON object per line) so concurrent
// writers — e.g. parallel subagents firing PreToolUse — can't clobber each
// other the way a read-modify-write of a shared JSON array would.
const SESSION_LOG_FILE = "maestro_session.log.jsonl";

function sessionLogPath(claudeDir) {
  return path.join(claudeDir, SESSION_LOG_FILE);
}

function appendSessionLog(claudeDir, entry) {
  fs.appendFileSync(sessionLogPath(claudeDir), JSON.stringify(entry) + "\n");
}

module.exports = {
  readStdin,
  readJson,
  resolveWorkflowName,
  readSession,
  writeSession,
  resolveSearchList,
  collectAgentSkills,
  bareAgentName,
  appendSessionLog,
  sessionLogPath,
  SESSION_LOG_FILE,
  nodeLabel,
  successPathSteps,
  workflowNodeLabels,
};
