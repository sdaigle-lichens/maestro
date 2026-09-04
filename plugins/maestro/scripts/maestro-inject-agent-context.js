#!/usr/bin/env node
// SubagentStart hook for worker subagents.
// Reads <cwd>/.claude/maestro.json (v3), looks up the invoked agent type's instance
// in the active workflow, and emits as additionalContext:
//   1a. loaded_skills     — skills to load (Skill tool) before working,
//   1b. referenced_skills — skills available, loaded only if the task needs them,
//   2. the HANDOFF routing lines this agent may emit (success + condition labels),
//   3. the per-route handoff_details payload protocol, resolved across three tiers
//      (.claude/handoffs/<sender>/<receiver>.md, then
//      ~/.claude/maestro-handoff-defaults.sqlite, then the seed constant that ships inside
//      lib/maestro-session.cjs) so the whole communication layer lives here rather than in
//      each agent file.
// The skills/routing block above is a no-op when maestro.json is absent, not v3, or the agent
// type is not mapped to any workflow node.
//
// A SECOND, INDEPENDENT branch resolves this agent's "Mandatory Output Format" report (project
// override at .claude/reports/<id>.md, else the global default in
// ~/.claude/maestro-report-defaults.sqlite, else nothing) and injects it as its own
// additionalContext part. Deliberately NOT gated on matchedInstances / a resolved workflow, and
// not gated on maestro.json existing at all: a report has to reach an agent used outside
// Maestro's routing (or in a project with no maestro.json, for the global tier) exactly as the
// static `## Mandatory Output Format` section it replaced always did. See
// apps/maestro/src/core/report-resolution.ts for the same order, applied pure-side for the app's
// /agents page.

const fs = require("fs");
const path = require("path");
const {
  readStdin,
  readJson,
  resolveWorkflowName,
  readSession,
  writeSession,
  resolveSearchList,
  collectAgentSkills,
  bareAgentName,
  projectOwnsHook,
  handoffRoutes,
  routesFrom,
  resolveHandoff,
} = require("./lib/maestro-session.cjs");

// ── handoff protocol resolution — three tiers, one shared decision ─────────

// The project tier: `.claude/handoffs/<sender>/<receiver>.md`, which install now MATERIALIZES for
// every route the workflows wire (see apps/maestro/src/core/handoff-sync.ts) rather than leaving
// as an undocumented escape hatch. There is no second file candidate any more: the plugin's
// `templates/handoffs/` copy is gone, because an installer that blind-overwrites its own fallback
// on every run means a user's edit there disappears silently.
function readProjectHandoff(projectDir, handoffId) {
  try {
    const [sender, receiver] = handoffId.split("/");
    const body = fs.readFileSync(path.join(projectDir, ".claude", "handoffs", sender, `${receiver}.md`), "utf8").trim();
    return body || null;
  } catch {
    return null;
  }
}

// The global tier: ~/.claude/maestro-handoff-defaults.sqlite. Wrapped in try/catch like every
// other caller of a generated sqlite lib — an older `node` on this session's PATH (< 22.5, no
// node:sqlite) or a missing bundle degrades to null, and `resolveHandoff` then falls through to
// the SEED, which travels inside lib/maestro-session.cjs and needs no sqlite at all. That
// fall-through is the whole reason the seeds were split out of the store.
function readGlobalHandoff(handoffId) {
  try {
    const { readHandoffDefault } = require("./lib/maestro-handoff-defaults.cjs");
    return readHandoffDefault(handoffId);
  } catch {
    return null;
  }
}

// Project file -> global row -> shipped seed -> nothing. `resolveHandoff` is the same pure
// function apps/maestro's own surfaces call, so the hook and the app cannot disagree about what
// an agent will be told to emit.
function handoffProtocol(projectDir, handoffId) {
  const resolved = resolveHandoff(handoffId, readProjectHandoff(projectDir, handoffId), readGlobalHandoff(handoffId));
  return resolved.content;
}

function collect(cfg, sessionPath, agentType) {
  const instances = cfg.workflow_instances || [];

  const session = readSession(sessionPath);

  // Scope to the active workflow when it resolves; fall back to the default
  // workflow when none is set yet, or union-and-warn on a broken active name.
  // resolveSearchList owns this logic (shared with maestro-subagent-log.js so
  // the offered-skills it logs match exactly what we inject here).
  const { searchList, warning, activeWorkflowName } = resolveSearchList(cfg, session);

  // loaded = auto-load before working; referenced = available, load only if the
  // task needs it. collectAgentSkills owns the node-walk + dedup (loaded wins).
  const { loaded: loadedList, referenced: referencedList, matchedInstances } = collectAgentSkills(
    searchList,
    instances,
    agentType
  );

  // The route walk USED TO LIVE HERE, inline. It is `handoffRoutes()` in
  // apps/maestro/src/core/handoff-routes.ts now, reached through the generated lib, because the
  // install-time sync has to answer the same question — "which handoffs does this project have?"
  // — and two implementations is how the materialized files and the injected protocols drift.
  // Both ends come back BARE, which is the fix for a project whose instances carry namespaced
  // agents (`maestro:test`): the receiver used to be compared and pathed un-bared and resolved no
  // protocol at all, silently.
  const routes = routesFrom(handoffRoutes(searchList, instances), agentType);

  if (matchedInstances.length === 0) return null;

  // Record the generated instances in the session (best-effort).
  try {
    const generated = session.generated_instances || [];
    for (const name of matchedInstances) if (!generated.includes(name)) generated.push(name);
    writeSession(sessionPath, {
      workflow: activeWorkflowName || resolveWorkflowName(cfg),
      generated_instances: generated,
    });
  } catch {
    // Don't fail the hook on session write errors.
  }

  return {
    loadedSkills: loadedList,
    referencedSkills: referencedList,
    routes,
    warning,
  };
}

// ── report injection — independent of workflow matching ────────────────────

// A project override at .claude/reports/<id>.md, where <id> is whatever the project's `reports`
// slice maps this agent to (usually the agent's own name, but the schema allows any id). null
// when the project has no such mapping, or the mapped file is absent/empty.
function readProjectReportOverride(projectDir, cfg, bareAgent) {
  const entry = cfg && cfg.reports && cfg.reports[bareAgent];
  if (!entry || !entry.id) return null;
  try {
    const body = fs.readFileSync(path.join(projectDir, ".claude", "reports", `${entry.id}.md`), "utf8").trim();
    if (body) return { content: body, reportId: entry.id };
  } catch {
    // absent file — fall through
  }
  return null;
}

// The global tier: ~/.claude/maestro-report-defaults.sqlite, via the generated lib — wrapped in
// try/catch exactly like maestro-skill-tags.cjs's caller, so an older `node` on this session's
// PATH (< 22.5, no node:sqlite) degrades to "no global default" rather than failing the hook.
function readGlobalReportDefault(bareAgent) {
  try {
    const { readAgentReportDefault } = require("./lib/maestro-report-defaults.cjs");
    return readAgentReportDefault(bareAgent);
  } catch {
    return null;
  }
}

// Order: project override -> global default -> none (nothing emitted). `cfg` may be null (no
// maestro.json at all) — a project override is then impossible, but the global tier still applies,
// which is the whole reason this is a separate, unconditional branch.
function collectReportContext(cfg, projectDir, agentType) {
  const bareAgent = bareAgentName(agentType);
  const resolved = readProjectReportOverride(projectDir, cfg, bareAgent) || readGlobalReportDefault(bareAgent);
  if (!resolved) return null;
  return `Mandatory output format for the \`${agentType}\` agent:\n\n${resolved.content}`;
}

(async () => {
  let payload = {};
  try {
    payload = JSON.parse((await readStdin()) || "{}");
  } catch {
    process.exit(0);
  }

  // SubagentStart provides agent_type (the subagent's `name` frontmatter value).
  const agentType = payload && payload.agent_type ? payload.agent_type : "";
  if (!agentType) process.exit(0);

  const projectDir = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();

  // Both delivery paths can register this hook. When the project registers its own copy, THIS
  // copy — the plugin's, running from the marketplace cache — stands down, so nothing fires twice.
  // A no-op in the copy installed into the project. See src/core/hook-arbitration.ts.
  if (projectOwnsHook(__filename, projectDir, payload.hook_event_name)) process.exit(0);

  // May be null (absent), or present but not v3 — either way the skills/routing block below is
  // skipped, but `cfg` (even null) is still passed to the report branch, which has its own,
  // looser no-op condition (see collectReportContext's header comment).
  const cfg = readJson(path.join(projectDir, ".claude", "maestro.json"));

  const parts = [];

  const result = cfg && cfg.version === 3 ? collect(cfg, path.join(projectDir, ".claude", "maestro_session.json"), agentType) : null;

  if (result) {
    if (result.warning) {
      parts.push(`⚠️ Maestro warning: ${result.warning}`);
    }
    if (result.loadedSkills.length > 0) {
      parts.push(
        `Skills to load for the \`${agentType}\` agent instance (maestro.json v3, loaded_skills): ${result.loadedSkills.join(", ")}.\n\n` +
          `Load each one with the Skill tool before starting your work, then follow your agent file as written.`
      );
    }

    if (result.referencedSkills.length > 0) {
      parts.push(
        `Skills available to the \`${agentType}\` agent instance (maestro.json v3, referenced_skills): ${result.referencedSkills.join(", ")}.\n\n` +
          `Do NOT bulk-load these up front — but they exist because they document logic you would otherwise have to ` +
          `reverse-engineer from source. So before you open or edit a source file, check what each one covers (its ` +
          `description is in your skills list): if a referenced skill documents that file or the logic it implements, ` +
          `load it with the Skill tool FIRST — ` +
          `read the skill before the source, not after. Load only the ones whose logic the task actually touches and ` +
          `ignore the rest, but do not rediscover from the code what a skill already explains.`
      );
    }
  }

  if (result && result.routes.length > 0) {
    const hasSuccess = result.routes.some((r) => r.label === "success");
    const lines = result.routes.map((r) => {
      const to = r.receiver ? ` (routes to \`${r.receiver}\`)` : "";
      return r.label === "success"
        ? `- \`HANDOFF: success\` — continue along the workflow's success path${to}.`
        : `- \`HANDOFF: ${r.label}\` — when that condition applies${to}.`;
    });
    parts.push(
      `Handoff routing for the \`${agentType}\` agent. End your final message with exactly one \`HANDOFF:\` line so ` +
        `the orchestrator can route deterministically:\n${lines.join("\n")}` +
        (hasSuccess ? "" : "\n(No success path leaves this node — it only feeds back via the condition above.)")
    );

    // Per-route payload protocol, resolved across the three tiers above so the communication
    // contract is owned here rather than duplicated in the agent files. Only emitted for routes
    // whose pair resolves to something — a wired route with no template anywhere (`scribe ->
    // reviewer`) is silently skipped, exactly as the install-time sync skips it.
    const protocols = [];
    for (const r of result.routes) {
      if (!r.receiver) continue;
      const proto = handoffProtocol(projectDir, `${r.sender}/${r.receiver}`);
      if (!proto) continue;
      protocols.push(`Route \`HANDOFF: ${r.label}\` → \`${r.receiver}\`:\n\n${proto}`);
    }
    if (protocols.length > 0) {
      parts.push(
        `When you hand off, set the \`handoff_details\` field of your output JSON to the shape for the route you take ` +
          `(use \`null\` when nothing applies):\n\n${protocols.join("\n\n")}`
      );
    }
  }

  // Independent of everything above: fires whenever the agent type resolves to ANY report
  // (project or global), regardless of whether `result` matched a workflow instance at all.
  const reportPart = collectReportContext(cfg, projectDir, agentType);
  if (reportPart) parts.push(reportPart);

  if (parts.length === 0) process.exit(0);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SubagentStart",
        additionalContext: parts.join("\n\n---\n\n"),
      },
    })
  );
})();
