#!/usr/bin/env node
// The `/maestro-team-meeting` helper — every filesystem step of a team meeting, so the skill never
// has to hand-write session state or parse proposal files itself. Each command prints ONE line of
// JSON and exits 0 on success, 1 on a refusal (with `ok:false` and a `reason`).
//
//   node maestro-team-meeting.cjs start --mode review|post-mortem [--participants a,b] [projectDir]
//       Switch meeting mode on for THIS session (resolved from CLAUDE_CODE_SESSION_ID). Refuses when
//       the project's copied runtime is stale or incomplete: a project that registers its own hook
//       copies runs THOSE, and a copy older than meeting mode would treat participants as workflow
//       steps. Default participants: review → every agent placed on a workflow; post-mortem →
//       every agent that completed a (non-meeting) run this session.
//   node maestro-team-meeting.cjs end [projectDir]
//   node maestro-team-meeting.cjs brief [projectDir]
//       Write <meeting dir>/brief.md (common) and brief/<agent>.md (one per participant), with the
//       evidence: this session's post-mortem digest, open tasks' `## Post-Mortem` sections and the
//       tail of .claude/postmortems.log.
//   node maestro-team-meeting.cjs conflicts [projectDir]
//       Read every round-<n>/<agent>.json, report targets agents disagree on.
//   node maestro-team-meeting.cjs tally [projectDir]
//       Write <meeting dir>/decision.md and print the decision rows (auto / approval / blocked).
//
// The pure logic is lib/maestro-team-meeting.cjs (apps/maestro/src/core/team-meeting.ts); the flag
// the hooks read is lib/maestro-session.cjs's meeting-mode exports (meeting-mode.ts). Runs from the
// plugin (invoked by the skill as ${CLAUDE_SKILL_DIR}/../../scripts/…), never copied into a project.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  readJson,
  ensureSessionPaths,
  resolveSessionPaths,
  readMeeting,
  startMeeting,
  endMeeting,
  agentRunsFromLog,
  bareAgentName,
} = require("./lib/maestro-session.cjs");
const tm = require("./lib/maestro-team-meeting.cjs");

const argv = process.argv.slice(2);
const command = argv[0];
const rest = argv.slice(1);
const FLAGS_WITH_VALUE = new Set(["mode", "participants"]);

function flag(name) {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? null : (rest[i + 1] ?? null);
}

function positional() {
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith("--")) {
      if (FLAGS_WITH_VALUE.has(a.slice(2))) i++;
      continue;
    }
    return a;
  }
  return null;
}

const projectDir = path.resolve(positional() || process.env.CLAUDE_PROJECT_DIR || process.cwd());
const claudeDir = path.join(projectDir, ".claude");

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function refuse(reason, extra = {}) {
  out({ ok: false, reason, ...extra });
  process.exit(1);
}

function loadConfig() {
  const cfg = readJson(path.join(claudeDir, "maestro.json"));
  if (!cfg || cfg.version !== 3) refuse(`no valid .claude/maestro.json (v3) under ${projectDir} — run /maestro-install first.`);
  return cfg;
}

function readLogLines(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const lines = [];
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    try {
      lines.push(JSON.parse(raw));
    } catch {
      // tolerate a partial line
    }
  }
  return lines;
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** The active meeting of THIS session, or a refusal. */
function requireMeeting() {
  const sess = resolveSessionPaths(claudeDir);
  if (!sess) refuse("no Claude Code session id is available (CLAUDE_CODE_SESSION_ID) — a meeting is per session.");
  const meeting = readMeeting(readJson(sess.state));
  if (!meeting) refuse("no team meeting is running in this session — run `start` first.");
  return { sess, meeting };
}

// ── start ───────────────────────────────────────────────────────────────────

// The hooks that read the meeting flag, in the project-copied form a project may register itself.
// Any copy present must know about meeting mode, whatever runtimeVersion says.
const MEETING_AWARE_COPIES = ["maestro-inject-agent-context.cjs", "maestro-subagent-log.cjs"];

function runtimeProblem() {
  try {
    const { checkRuntime } = require("./maestro-check-runtime.cjs");
    const answer = checkRuntime(projectDir);
    if (answer.action !== "continue") return `${answer.reason || "the project runtime is not ready"} — ${answer.instruction}`;
  } catch {
    // No checker beside this script: fall through to the direct check below.
  }
  for (const name of MEETING_AWARE_COPIES) {
    const text = readText(path.join(claudeDir, "scripts", name));
    if (text !== null && !text.includes("meetingFor")) {
      return `the project's copy of ${name} predates team meetings — run /maestro-update first.`;
    }
  }
  return null;
}

function runStart() {
  const mode = flag("mode") || "review";
  if (mode !== "review" && mode !== "post-mortem") refuse(`--mode must be "review" or "post-mortem", not "${mode}".`);
  const cfg = loadConfig();
  const problem = runtimeProblem();
  if (problem) refuse(problem);

  const sess = ensureSessionPaths(claudeDir);
  if (!sess) refuse("no Claude Code session id is available (CLAUDE_CODE_SESSION_ID) — a meeting is per session.");

  let participants;
  const given = flag("participants");
  if (given) {
    participants = given.split(",").map((s) => bareAgentName(s.trim())).filter(Boolean);
  } else if (mode === "post-mortem") {
    participants = [...new Set(agentRunsFromLog(readLogLines(sess.log)).map((r) => bareAgentName(r.agentType)))];
  } else {
    participants = tm.placedAgents(cfg);
  }
  if (participants.length === 0) {
    refuse(
      mode === "post-mortem"
        ? "no agent completed a workflow run in this session — nothing to post-mortem. Use --mode review or --participants."
        : "no agent is placed on any workflow — pass --participants."
    );
  }

  const meeting = startMeeting(sess.state, sess.dir, { mode, participants });
  out({ ok: true, meeting });
}

// ── end ─────────────────────────────────────────────────────────────────────

function runEnd() {
  const sess = resolveSessionPaths(claudeDir);
  if (!sess) refuse("no Claude Code session id is available (CLAUDE_CODE_SESSION_ID).");
  // Records the participants' unstamped lane files as `meeting_leftovers` while ending, so none is
  // ever stamped by its sender's next workflow run (see meeting-mode.ts closeMeeting).
  out({ ok: true, ended: endMeeting(sess.state, projectDir) });
}

// ── brief ───────────────────────────────────────────────────────────────────

function frontmatterTools(text) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(text || "");
  if (!fm) return null;
  const m = /^tools:\s*(.+)$/m.exec(fm[1]);
  return m ? m[1].trim() : null;
}

/** Where an agent's definition lives: project, then user, then this plugin. */
function describeAgent(cfg, name) {
  const raw = (cfg.workflow_instances || []).map((i) => i.agent).find((a) => bareAgentName(a) === name) || name;
  const candidates = [];
  if (!raw.includes(":")) {
    candidates.push({ tier: "project", file: path.join(claudeDir, "agents", `${name}.md`), shown: `.claude/agents/${name}.md` });
    candidates.push({ tier: "user", file: path.join(os.homedir(), ".claude", "agents", `${name}.md`), shown: `~/.claude/agents/${name}.md` });
  }
  candidates.push({
    tier: "plugin",
    file: path.join(__dirname, "..", "agents", `${name}.md`),
    shown: `plugin agent ${raw.includes(":") ? raw : `maestro:${name}`}`,
  });
  for (const c of candidates) {
    const text = readText(c.file);
    if (text !== null) return { name, tier: c.tier, path: c.shown, tools: frontmatterTools(text) };
  }
  return { name, tier: raw.includes(":") ? "plugin" : "unknown", path: null, tools: null };
}

function collectRules(cfg) {
  const inConfig = new Set((cfg.rules || []).map((r) => r.id));
  const rules = [];
  const seen = new Set();
  for (const d of listDir(path.join(claudeDir, "rules"))) {
    if (!d.isFile() || !d.name.endsWith(".md")) continue;
    const id = d.name.slice(0, -3);
    seen.add(id);
    rules.push({ id, path: `.claude/rules/${d.name}`, inConfig: inConfig.has(id) });
  }
  for (const r of cfg.rules || []) {
    if (seen.has(r.id)) continue;
    rules.push({ id: r.id, path: r.paths && r.paths.length ? `scoped to ${r.paths.join(", ")}` : "(assigned in maestro.json)", inConfig: true });
  }
  return rules;
}

function collectHandoffFiles() {
  const files = [];
  const root = path.join(claudeDir, "handoffs");
  for (const s of listDir(root)) {
    if (!s.isDirectory()) continue;
    for (const r of listDir(path.join(root, s.name))) {
      if (r.isFile() && r.name.endsWith(".md")) files.push(`.claude/handoffs/${s.name}/${r.name}`);
    }
  }
  return files.sort();
}

function collectReportFiles() {
  return listDir(path.join(claudeDir, "reports"))
    .filter((d) => d.isFile() && d.name.endsWith(".md"))
    .map((d) => `.claude/reports/${d.name}`)
    .sort();
}

function taskPostMortems() {
  const out = [];
  const dir = path.join(claudeDir, "maestro-tasks");
  for (const d of listDir(dir)) {
    if (!d.isFile() || !d.name.endsWith(".md")) continue;
    const text = readText(path.join(dir, d.name)) || "";
    const m = /^## Post-Mortem\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text);
    if (m && m[1].trim()) out.push({ file: `.claude/maestro-tasks/${d.name}`, text: m[1] });
  }
  return out;
}

function sessionDigest() {
  const r = spawnSync(process.execPath, [path.join(__dirname, "maestro-post-mortem.js"), projectDir], {
    encoding: "utf8",
    env: process.env,
    timeout: 30000,
  });
  return r.status === 0 && r.stdout && r.stdout.includes("# Maestro Post-Mortem digest") ? r.stdout : null;
}

function runBrief() {
  const cfg = loadConfig();
  const { meeting } = requireMeeting();
  const agentNames = [...new Set([...tm.placedAgents(cfg), ...meeting.participants])];
  const input = {
    cfg,
    meeting: { id: meeting.id, mode: meeting.mode, dir: meeting.dir },
    participants: meeting.participants,
    agents: agentNames.map((n) => describeAgent(cfg, n)),
    rules: collectRules(cfg),
    handoffFiles: collectHandoffFiles(),
    reportFiles: collectReportFiles(),
    evidence: {
      digest: sessionDigest(),
      postmortemsLog: readText(path.join(claudeDir, "postmortems.log")),
      taskPostMortems: taskPostMortems(),
    },
  };

  fs.mkdirSync(path.join(meeting.dir, "brief"), { recursive: true });
  const briefPath = path.join(meeting.dir, "brief.md");
  fs.writeFileSync(briefPath, tm.buildCommonBrief(input));
  const slices = {};
  for (const p of meeting.participants) {
    const file = path.join(meeting.dir, "brief", `${p}.md`);
    fs.writeFileSync(file, tm.buildAgentBrief(input, p));
    slices[p] = file;
  }
  out({
    ok: true,
    brief: briefPath,
    slices,
    evidence: {
      digest: !!input.evidence.digest,
      postmortemsLog: !!input.evidence.postmortemsLog,
      taskPostMortems: input.evidence.taskPostMortems.length,
    },
  });
}

// ── rounds ──────────────────────────────────────────────────────────────────

function readRounds(meetingDir) {
  const files = [];
  const errors = [];
  for (const d of listDir(meetingDir)) {
    const m = /^round-(\d+)$/.exec(d.name);
    if (!d.isDirectory() || !m) continue;
    const round = Number(m[1]);
    for (const f of listDir(path.join(meetingDir, d.name))) {
      if (!f.isFile() || !f.name.endsWith(".json")) continue;
      const agent = f.name.slice(0, -5);
      const where = `${d.name}/${f.name}`;
      let raw;
      try {
        raw = JSON.parse(fs.readFileSync(path.join(meetingDir, d.name, f.name), "utf8"));
      } catch (err) {
        errors.push(`${where}: not valid JSON (${err.message})`);
        continue;
      }
      const parsed = tm.parseProposalFile(raw, agent, round);
      for (const e of parsed.errors) errors.push(`${where}: ${e}`);
      if (parsed.file) files.push({ ...parsed.file, round });
    }
  }
  return { files, errors };
}

function runConflicts() {
  const { meeting } = requireMeeting();
  const { files, errors } = readRounds(meeting.dir);
  const conflicts = tm.findConflicts(files);
  const agents = [...new Set(conflicts.flatMap((c) => c.agents))].sort();
  const rounds = files.map((f) => f.round);
  out({
    ok: true,
    lastRound: rounds.length ? Math.max(...rounds) : 0,
    filed: [...new Set(files.map((f) => f.agent))].sort(),
    conflicts,
    rebuttalAgents: agents,
    errors,
  });
}

function runTally() {
  const cfg = loadConfig();
  const { meeting } = requireMeeting();
  const { files, errors } = readRounds(meeting.dir);
  const names = [...new Set([...meeting.participants, ...files.map((f) => f.agent)])];
  const agentTiers = {};
  for (const n of names) agentTiers[n] = describeAgent(cfg, n).tier;
  // Agents named as targets but not participating still need their tier for the block check.
  for (const f of files) {
    for (const p of f.proposals) {
      if (!p.target.startsWith("agent:")) continue;
      const n = bareAgentName(p.target.slice("agent:".length));
      if (!(n in agentTiers)) agentTiers[n] = describeAgent(cfg, n).tier;
    }
  }
  const rows = tm.tally(files, { agentTiers, configRuleIds: (cfg.rules || []).map((r) => r.id) });
  const decisionPath = path.join(meeting.dir, "decision.md");
  fs.writeFileSync(decisionPath, tm.renderDecision(rows, meeting));
  const counts = { auto: 0, approval: 0, blocked: 0 };
  for (const r of rows) counts[r.tier]++;
  out({
    ok: true,
    decision: decisionPath,
    counts,
    rows: rows.map((r) => ({
      id: r.id,
      from: [r.agent, ...r.supporters],
      tier: r.tier,
      kind: r.kind,
      target: r.target,
      change: r.change,
      ...(r.note ? { note: r.note } : {}),
    })),
    errors,
  });
}

const COMMANDS = { start: runStart, end: runEnd, brief: runBrief, conflicts: runConflicts, tally: runTally };

if (COMMANDS[command]) {
  COMMANDS[command]();
} else {
  process.stderr.write(
    "maestro-team-meeting: unknown command. Usage:\n" +
      "  maestro-team-meeting.cjs start --mode review|post-mortem [--participants a,b] [projectDir]\n" +
      "  maestro-team-meeting.cjs end|brief|conflicts|tally [projectDir]\n"
  );
  process.exit(1);
}
