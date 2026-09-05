#!/usr/bin/env node
// Scaffolds the Maestro orchestrator into a project. Idempotent — safe to re-run.
//   1. installs templates/maestro/SKILL.md → <project>/.claude/skills/maestro/SKILL.md
//      - absent            → copied whole
//      - has the managed-region markers → the plugin-owned regions (Maestro:STEPS,
//        Maestro:PRINCIPLES) are re-synced from the template, so template improvements
//        reach existing installs. Content outside those regions, and the rendered
//        Maestro:HANDOFFS table nested inside them, is preserved.
//      - predates the markers → backed up to SKILL.md.bak and replaced with the
//        template (there is no safe way to locate the managed regions in it);
//        reported as `migratedOrchestratorSkill` so the skill can tell the user.
//   2. copies runtime scripts → <project>/.claude/scripts/ (always refreshed). Includes the hook scripts
//      (maestro-inject-agent-context, maestro-subagent-log, maestro-session-log,
//      maestro-validate-tasks, maestro-step0 — copied as .cjs) and maestro-session-cleanup.cjs, so every hook
//      this install registers runs from a project-local copy rather than
//      ${CLAUDE_PLUGIN_ROOT} — see apps/maestro/src/core/install.ts's header for why.
//   3. merges the full Maestro hook set into <project>/.claude/settings.json (preserves other
//      keys): the bash-validation PreToolUse guard plus UserPromptExpansion/SubagentStart/
//      SubagentStop/PreToolUse/PostToolUse/SessionEnd, mirroring plugins/maestro/hooks/hooks.json
//      one-for-one.
//   4. adds an `# Maestro` section to the repo-root .gitignore ignoring every nested
//      .claude/maestro_session*.{json,jsonl} AND .claude/channels/ (`036`) across the repo /
//      monorepo (the `**/` glob covers root-level .claude/ too, so no per-package .gitignore is
//      needed)
//   5. seeds <project>/.claude/maestro.json from defaultV3Config — ONLY when absent. An existing
//      config is the user's authored graph and is never touched. `project_tags` is stamped onto
//      that same seed from `--project-tags`, intersected with the live Project Tags catalog.
//
// It does NOT render the orchestrator skill's managed region: rendering consumes maestro.json,
// so it runs afterwards via maestro-render-orchestrator.cjs (the /maestro-install and
// /maestro-update skills both do this as their next step).
//
// This manifest (STATIC_ASSETS / HOOK_SCRIPTS / HOOK_REGISTRATIONS below) mirrors
// apps/maestro/src/core/install.ts's one-for-one. If this list and that one ever diverge again,
// that's a bug in one of them — see that file's `RuntimeAsset`/`HOOK_REGISTRATIONS` for the
// reasoning behind each entry.
//
//   node maestro-install.js [projectDir] [--impl-agents backend,frontend] \
//     [--skill-map '{"frontend":["react"]}'] [--project-tags backend,frontend]
//
// All three flags only affect a fresh seed. The /maestro-install skill fills them in from its repo
// analysis (and, for --project-tags, a confirmation against the live catalog); omitted, the seed
// falls back to ["backend"] with no skills attached and no project_tags recorded. Editing the
// graph afterwards is the desktop app's job (apps/maestro) — or a hand-edit plus /maestro-update;
// project_tags is editable afterward from the app's /maestro page.
//
// `--skill-map` is only HALF of what actually gets seeded: this script also reads
// `~/.claude/maestro-skill-tags.sqlite` (global, keyed by skill id — the Maestro desktop app's
// Skills tab writes it) and unions a tag-derived skillMap in on top, so a skill the user has
// already tagged with a project tag AND an agent type is wired to every seeded agent instance
// whose own stored attributes (`~/.claude/maestro-agent-types.sqlite`,
// `~/.claude/maestro-agent-project-tags.sqlite`) match both — no Claude session involved at all.
// The SKILL.md only needs to best-fit-guess (via AskUserQuestion) whatever `--skill-map` doesn't
// already cover from tags.
//
// `--project-tags` is intersected against `~/.claude/maestro-project-tags.sqlite` (the same global
// catalog the Maestro desktop app's /templates page edits), read fresh via
// lib/maestro-project-tags.cjs — same "seed guards against a stale/hand-typed flag value" the
// app's installRuntime() applies, and same degrade-on-old-`node` discipline as the skill-tags read
// above.
//
// Prints a JSON summary to stdout.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");
const { syncManagedRegions } = require("./lib/maestro-skill-regions.cjs");
const { defaultV3Config, seededAgentNames } = require("./lib/maestro-seed.cjs");

// argv: [projectDir] [--impl-agents a,b] [--skill-map '{"agent":["skill"]}']
// Parsed positionally-first so the long-standing `maestro-install.js <dir>` call still works.
const argv = process.argv.slice(2);
const positional = [];
const flags = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[++i] ?? "";
  else positional.push(argv[i]);
}

const projectDir = positional[0] || process.env.CLAUDE_PROJECT_DIR || process.cwd();
const pluginRoot = path.resolve(__dirname, "..");

const implAgents = (flags["impl-agents"] || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Independent of --impl-agents — this is the confirmed selection from the Project Tags catalog,
// not necessarily the same set as the implementation chain (the catalog can hold more than
// backend/frontend/mobile). Intersected against the LIVE catalog below, same guard the app's
// installRuntime() applies, so a stale or hand-typed flag value can't record a tag that was
// removed from (or never added to) `~/.claude/maestro-project-tags.sqlite`.
const projectTagsFlag = (flags["project-tags"] || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Wrapped in try/catch: an older `node` on this session's PATH (no node:sqlite) or a store that's
// never been written to just means an empty catalog — the install proceeds with no project_tags
// recorded, same as omitting the flag entirely.
let projectTagsCatalog = [];
try {
  const { readAllProjectTags } = require("./lib/maestro-project-tags.cjs");
  projectTagsCatalog = readAllProjectTags();
} catch {
  // node:sqlite unavailable, or the catalog store doesn't exist yet.
}
const projectTags = projectTagsFlag.filter((t) => projectTagsCatalog.includes(t));

let claudeSkillMap = {};
if (flags["skill-map"]) {
  try {
    const parsed = JSON.parse(flags["skill-map"]);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) claudeSkillMap = parsed;
  } catch {
    // A malformed skill map seeds an empty one rather than failing the install — the user can
    // still attach skills in the desktop app, and losing the install over a quoting mistake in a
    // prompt-built argument is the worse outcome.
  }
}

/**
 * Project skill ids exactly as `discoverSkills`/the maestro-install SKILL.md compute them:
 * `.claude/skills/<dir>/SKILL.md`'s frontmatter `name:`, or the directory name.
 */
function discoverProjectSkillIds(dir) {
  const skillsDir = path.join(dir, ".claude", "skills");
  let entries;
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const ids = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let name = entry.name;
    try {
      const text = fs.readFileSync(path.join(skillsDir, entry.name, "SKILL.md"), "utf8");
      const match = text.match(/^---\s*[\s\S]*?\bname:\s*(\S+)[\s\S]*?---/);
      if (match) name = match[1];
    } catch {
      // No SKILL.md, or unreadable — fall back to the directory name.
    }
    ids.push(name);
  }
  return ids;
}

// The tag-derived half of the skillMap — deterministic, no Claude session involved. Read fresh
// from the global `~/.claude/maestro-skill-tags.sqlite` store REGARDLESS of what `--skill-map`
// carries, so a skill the user has already tagged in the Maestro desktop app's Skills tab lands in
// the right agent's referenced_skills even if the SKILL.md step that built `--skill-map` never
// looked at it. A skill's tags are matched against each seeded agent INSTANCE's own stored type
// (maestro-agent-types.cjs) and project tag (maestro-agent-project-tags.cjs) — the same two
// attributes `apps/maestro/src/main/ipc.ts`'s `skillMapForSeed` reads, so both installers converge
// on the same seed given the same global stores. Wrapped in try/catch: an older `node` on this
// session's PATH (this script runs under whatever `node` invoked it, not Electron's bundled one) or
// a missing db file just means no tags to add — the install proceeds exactly as it did before this
// feature existed.
let tagSkillMap = {};
try {
  const { readAllSkillTags, skillMapFromTags } = require("./lib/maestro-skill-tags.cjs");
  const { readAllAgentTypes } = require("./lib/maestro-agent-types.cjs");
  const { readAllAgentProjectTags } = require("./lib/maestro-agent-project-tags.cjs");
  const types = readAllAgentTypes();
  const projectTagsByAgent = readAllAgentProjectTags();
  const agentAttrs = {};
  for (const name of seededAgentNames(implAgents)) {
    agentAttrs[name] = { type: types[name] || "developer", projectTag: projectTagsByAgent[name] || "global" };
  }
  tagSkillMap = skillMapFromTags(readAllSkillTags(), discoverProjectSkillIds(projectDir), agentAttrs);
} catch {
  // node:sqlite unavailable, or no tags have ever been set — proceed with Claude's map alone.
}

// Union, not override: an agent may pick up skills from both sources, deduped by `defaultV3Config`
// itself (`skillsFor` runs every agent's list through `new Set`).
const skillMap = {};
for (const map of [tagSkillMap, claudeSkillMap]) {
  for (const agent of Object.keys(map)) {
    (skillMap[agent] ??= []).push(...map[agent]);
  }
}

// `036`: not everything under this header is removed at SessionEnd any more — a channel file
// survives it (only `.consumed/` and anything past the age cap is swept) — so the header no
// longer claims that of the whole block.
const GITIGNORE_HEADER = "# Maestro ephemeral session state — recreated as needed, never committed";

function ensureDir(d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// Install / refresh the orchestrator skill. Returns one of:
//   { action: "installed" }                     — first install, template copied whole
//   { action: "synced", regions: [...] }        — plugin-owned regions refreshed in place
//   { action: "unchanged" }                     — already identical to the template
//   { action: "migrated", backup: "<path>" }    — pre-markers install, backed up + replaced
function installOrchestratorSkill(templatePath, destPath) {
  const template = fs.readFileSync(templatePath, "utf8");
  if (!fs.existsSync(destPath)) {
    fs.writeFileSync(destPath, template);
    return { action: "installed" };
  }

  const installed = fs.readFileSync(destPath, "utf8");
  const { text, synced, missing } = syncManagedRegions(installed, template);

  if (missing.length > 0) {
    // No markers to sync into: an install from before managed regions existed.
    // Keep the old body next to the new one so custom prose isn't just lost.
    const backup = `${destPath}.bak`;
    fs.writeFileSync(backup, installed);
    fs.writeFileSync(destPath, template);
    return { action: "migrated", backup };
  }

  if (text === installed) return { action: "unchanged" };
  fs.writeFileSync(destPath, text);
  return { action: "synced", regions: synced };
}

// Append any missing `entries` to the .gitignore at `gitignorePath`, under the
// Maestro header (added only if not already present). Returns true if it changed.
function appendGitignoreEntries(gitignorePath, entries) {
  const existed = fs.existsSync(gitignorePath);
  const existing = existed ? fs.readFileSync(gitignorePath, "utf8") : "";
  const present = new Set(existing.split(/\r?\n/).map((l) => l.trim()));
  const missing = entries.filter((e) => !present.has(e));
  if (missing.length === 0) return false;
  const needsHeader = !present.has(GITIGNORE_HEADER);
  let block = (needsHeader ? GITIGNORE_HEADER + "\n" : "") + missing.join("\n") + "\n";
  if (existed && existing && !existing.endsWith("\n")) block = "\n" + block;
  ensureDir(path.dirname(gitignorePath));
  fs.appendFileSync(gitignorePath, block);
  return true;
}

// Keep the ephemeral session state out of version control. The files are
// Resolve the git toplevel from the project dir, or null if not a git repo.
function findRepoRoot(startDir) {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd: startDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

// Belt-and-suspenders for monorepos: ignore EVERY nested .claude session file
// across the whole tree from the repo-root .gitignore. The `**/` globs match
// .claude/ at any depth (including the root), so a session log left behind in
// any package is covered without a per-package .claude/.gitignore.
function ensureRepoRootGitignore(repoRoot) {
  if (!repoRoot) return false;
  return appendGitignoreEntries(path.join(repoRoot, ".gitignore"), [
    "**/.claude/maestro_session.json",
    "**/.claude/maestro_session.log.jsonl",
    "**/.claude/maestro_session_tasks.json",
    "**/.claude/channels/",
  ]);
}

const SCRIPTS_VAR = "$CLAUDE_PROJECT_DIR/.claude/scripts";

// Byte-for-byte as the legacy installer wrote it — unquoted and un-prefixed. Unlike the node
// hooks below, this one predates project-local hooks entirely, so re-quoting it here would
// duplicate the entry on every project the old skill already installed and orphan it on uninstall
// (which removes it by exact string match). Kept as its own constant for that reason.
const BASH_VALIDATION_COMMAND = `${SCRIPTS_VAR}/bash-validation.sh`;

function nodeHook(event, matcher, script) {
  return { event, matcher, script, command: `node "${SCRIPTS_VAR}/${script}"`, id: `${event}:${script}` };
}

// What this install registers in the project's `.claude/settings.json`. Mirrors
// plugins/maestro/hooks/hooks.json one-for-one (see apps/maestro/src/core/install.ts's
// HOOK_REGISTRATIONS, which this list is kept in lockstep with) — every hook the plugin would
// otherwise run from ${CLAUDE_PLUGIN_ROOT}, plus the bash-validation guard.
const HOOK_REGISTRATIONS = [
  // The orchestrator's Step 0. Two events because there are two entrances: the user typing
  // `/maestro` (UserPromptExpansion, matched on the command name) and the model invoking the skill
  // through the Skill tool (PreToolUse) — see the script's own header.
  nodeHook("UserPromptExpansion", "maestro", "maestro-step0.cjs"),
  nodeHook("PreToolUse", "Skill", "maestro-step0.cjs"),
  nodeHook("SubagentStart", ".*", "maestro-inject-agent-context.cjs"),
  nodeHook("SubagentStart", ".*", "maestro-subagent-log.cjs"),
  nodeHook("SubagentStop", ".*", "maestro-subagent-log.cjs"),
  nodeHook("PreToolUse", ".*", "maestro-session-log.cjs"),
  {
    event: "PreToolUse",
    matcher: "Bash",
    script: "bash-validation.sh",
    command: BASH_VALIDATION_COMMAND,
    id: "PreToolUse:bash-validation.sh",
  },
  nodeHook("PostToolUse", "TaskCreate", "maestro-validate-tasks.cjs"),
  nodeHook("SessionEnd", "", "maestro-session-cleanup.cjs"),
];

// Is `reg` already registered in `settings`? Keyed on the script's basename appearing anywhere in
// a command string for the same event, not on an exact match — a user who re-quoted the command by
// hand shouldn't get a duplicate that fires the hook twice.
function hasHook(settings, reg) {
  const entries = settings.hooks && settings.hooks[reg.event];
  if (!Array.isArray(entries)) return false;
  return entries.some(
    (e) =>
      e &&
      Array.isArray(e.hooks) &&
      e.hooks.some((h) => h && typeof h.command === "string" && h.command.includes(reg.script))
  );
}

// Add every missing registration to `settings` in place. Returns the ids added.
function addMissingHooks(settings) {
  const added = [];
  for (const reg of HOOK_REGISTRATIONS) {
    if (hasHook(settings, reg)) continue;
    settings.hooks = settings.hooks || {};
    const list = settings.hooks[reg.event] || (settings.hooks[reg.event] = []);
    // Reuse an existing entry for the same matcher rather than adding a second one, so a user's
    // own hook and ours live side by side under one matcher — as the legacy installer did for Bash.
    let entry = list.find((e) => e && e.matcher === reg.matcher && Array.isArray(e.hooks));
    if (!entry) {
      entry = { matcher: reg.matcher, hooks: [] };
      list.push(entry);
    }
    entry.hooks.push({ type: "command", command: reg.command });
    added.push(reg.id);
  }
  return added;
}

// Merge every missing hook registration into settings.json, preserving all other keys.
function mergeSettings(settingsPath) {
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    } catch {
      settings = {};
    }
  }
  const hooksAdded = addMissingHooks(settings);
  if (hooksAdded.length > 0) {
    ensureDir(path.dirname(settingsPath));
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }
  return { hooksAdded, setBashHook: hooksAdded.includes("PreToolUse:bash-validation.sh") };
}

// The hook scripts the plugin runs as `.js`, copied into the project as `.cjs` — see
// apps/maestro/src/core/install.ts's HOOK_SCRIPTS comment for why the extension changes.
const HOOK_SCRIPTS = [
  "maestro-inject-agent-context",
  "maestro-subagent-log",
  "maestro-session-log",
  "maestro-validate-tasks",
  "maestro-step0",
];

// Every file this install copies into a project, `{ src, dest, executable? }` relative to the
// plugin root / project root respectively.
const STATIC_ASSETS = [
  { src: "scripts/maestro-set-session-workflow.cjs", dest: ".claude/scripts/maestro-set-session-workflow.cjs" },
  { src: "scripts/maestro-render-orchestrator.cjs", dest: ".claude/scripts/maestro-render-orchestrator.cjs" },
  { src: "scripts/maestro-task-status.cjs", dest: ".claude/scripts/maestro-task-status.cjs" },
  { src: "scripts/maestro-check-runtime.cjs", dest: ".claude/scripts/maestro-check-runtime.cjs" },
  // Forked-agent sync (031) — see apps/maestro/src/core/install.ts's STATIC_ASSETS for why it is
  // copied into the project rather than run from ${CLAUDE_PLUGIN_ROOT}.
  { src: "scripts/maestro-agent-forks.cjs", dest: ".claude/scripts/maestro-agent-forks.cjs" },
  // Step 1's gate configuration (032) — see apps/maestro/src/core/install.ts's STATIC_ASSETS for
  // why its absence is the one that breaks an invocation outright.
  { src: "scripts/maestro-step1-gates.cjs", dest: ".claude/scripts/maestro-step1-gates.cjs" },
  // Resume-target lookup (039) — see apps/maestro/src/core/install.ts's STATIC_ASSETS for why it
  // is a project copy invoked directly by the orchestrator rather than a hook.
  { src: "scripts/maestro-resume-target.cjs", dest: ".claude/scripts/maestro-resume-target.cjs" },
  { src: "scripts/lib/maestro-session.cjs", dest: ".claude/scripts/lib/maestro-session.cjs" },
  { src: "scripts/lib/maestro-tasks.cjs", dest: ".claude/scripts/lib/maestro-tasks.cjs" },
  { src: "scripts/lib/maestro-skill-regions.cjs", dest: ".claude/scripts/lib/maestro-skill-regions.cjs" },
  { src: "scripts/lib/maestro-agent-sync.cjs", dest: ".claude/scripts/lib/maestro-agent-sync.cjs" },
  // The two global sqlite tiers maestro-inject-agent-context requires (035) — see
  // apps/maestro/src/core/install.ts's STATIC_ASSETS for why a lib missing from this list fails
  // silently, and why the handoff store is copied even though its seed would have covered it.
  { src: "scripts/lib/maestro-report-defaults.cjs", dest: ".claude/scripts/lib/maestro-report-defaults.cjs" },
  { src: "scripts/lib/maestro-handoff-defaults.cjs", dest: ".claude/scripts/lib/maestro-handoff-defaults.cjs" },
  { src: "scripts/bash-validation.sh", dest: ".claude/scripts/bash-validation.sh", executable: true },
  // SessionEnd cleanup. NOT the plugin's maestro-session-cleanup.sh — that one also tears down the
  // per-project web-app container, which is the plugin's business and not a project-local install's.
  { src: "scripts/maestro-session-cleanup.cjs", dest: ".claude/scripts/maestro-session-cleanup.cjs" },
  ...HOOK_SCRIPTS.map((name) => ({ src: `scripts/${name}.js`, dest: `.claude/scripts/${name}.cjs` })),
];

// The handoff templates USED TO BE COPIED HERE, into `.claude/templates/handoffs/`. They are gone
// (`033`) — see apps/maestro/src/core/install.ts's runtimeAssets() for the argument. What replaces
// them is syncProjectHandoffs() below, which materializes `.claude/handoffs/<sender>/<receiver>.md`
// for the routes the project's workflows actually wire and records what it copied.
function runtimeAssets() {
  return [...STATIC_ASSETS];
}

// Report sync — mirrors apps/maestro/src/core/report-sync.ts's syncProjectReports() exactly (see
// that file's header for the full reasoning). Runs on both /maestro-install and /maestro-update,
// since /maestro-update just re-runs this script. Wrapped by the caller in try/catch: an older
// `node` on this session's PATH (< 22.5, no node:sqlite) degrades to "nothing synced" rather than
// failing the install, same as the skill-tags read above.
function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function syncProjectReports(configPath, projectDir) {
  const summary = { materialized: [], refreshed: [], staleCustomized: [], unchanged: [] };
  if (!fs.existsSync(configPath)) return summary;
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (cfg.version !== 3) return summary;

  let readAgentReportDefault;
  try {
    ({ readAgentReportDefault } = require("./lib/maestro-report-defaults.cjs"));
  } catch {
    return summary; // no node:sqlite on this node — degrade to nothing synced
  }

  const reports = { ...(cfg.reports || {}) };
  const candidateAgents = new Set([...Object.keys(reports), ...(cfg.agents_available || [])]);
  const reportsDir = path.join(projectDir, ".claude", "reports");
  let changed = false;

  for (const agentName of candidateAgents) {
    const entry = reports[agentName];
    if (entry && !entry.syncedFrom) continue; // hand-authored override — never touched

    const global = readAgentReportDefault(agentName);
    if (!global) continue;

    const reportId = entry ? entry.id : agentName;
    const filePath = path.join(reportsDir, `${reportId}.md`);
    const onDisk = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;

    if (onDisk === null) {
      fs.mkdirSync(reportsDir, { recursive: true });
      fs.writeFileSync(filePath, global.content);
      reports[agentName] = { id: reportId, syncedFrom: { version: global.version, hash: sha256(global.content) } };
      summary.materialized.push(agentName);
      changed = true;
      continue;
    }

    if (!entry) {
      summary.unchanged.push(agentName);
      continue;
    }

    const currentHash = sha256(onDisk);
    if (currentHash !== entry.syncedFrom.hash) {
      summary.staleCustomized.push(agentName);
      continue;
    }

    if (global.version > entry.syncedFrom.version) {
      fs.writeFileSync(filePath, global.content);
      reports[agentName] = { id: reportId, syncedFrom: { version: global.version, hash: sha256(global.content) } };
      summary.refreshed.push(agentName);
      changed = true;
      continue;
    }

    summary.unchanged.push(agentName);
  }

  if (changed) {
    fs.writeFileSync(configPath, JSON.stringify({ ...cfg, reports }, null, 2));
  }
  return summary;
}

// Handoff sync — mirrors apps/maestro/src/core/handoff-sync.ts's syncProjectHandoffs() (see that
// file's header for the full reasoning). Unlike the report mirror above, this one does NOT restate
// the five branches: `decideSync` comes out of lib/maestro-agent-sync.cjs, which is the same
// compiled `sync-decision.ts` the app runs, and `handoffRoutes` out of lib/maestro-session.cjs, so
// the terminal path and the app cannot disagree about either the candidate routes or the verdict.
//
// The store read is the one thing wrapped in its own try/catch: `node:sqlite` may not exist on
// this session's `node`, and with no global tier there is nothing to sync FROM — the seed still
// reaches agents through the hook, which requires it out of maestro-session.cjs.
function syncProjectHandoffs(configPath, projectDir) {
  const summary = { materialized: [], refreshed: [], staleCustomized: [], unchanged: [] };
  if (!fs.existsSync(configPath)) return summary;
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (cfg.version !== 3) return summary;

  const { handoffRoutes, handoffPairs, isValidHandoffId } = require("./lib/maestro-session.cjs");
  const { decideSync } = require("./lib/maestro-agent-sync.cjs");

  let readHandoffDefault;
  try {
    ({ readHandoffDefault } = require("./lib/maestro-handoff-defaults.cjs"));
  } catch {
    return summary; // no node:sqlite on this node — degrade to nothing synced
  }

  const handoffs = { ...(cfg.handoffs || {}) };
  const wired = handoffPairs(handoffRoutes(cfg.workflows, cfg.workflow_instances));
  const candidates = [...new Set([...Object.keys(handoffs), ...wired])].filter(isValidHandoffId);
  let changed = false;

  for (const id of candidates) {
    const entry = handoffs[id];
    const global = readHandoffDefault(id);

    const [sender, receiver] = id.split("/");
    const filePath = path.join(projectDir, ".claude", "handoffs", sender, `${receiver}.md`);
    const onDisk = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;

    const tracking = entry
      ? entry.syncedFrom
        ? { kind: "tracked", hash: entry.syncedFrom.hash }
        : { kind: "detached" }
      : { kind: "untracked" };

    const verdict = decideSync({
      tracking,
      localHash: onDisk === null ? null : sha256(onDisk),
      hasTemplate: global !== null,
      templateAdvanced: !!global && !!(entry && entry.syncedFrom) && global.version > entry.syncedFrom.version,
    });

    // `no-template` is the only silent branch that still writes. A global row deleted on the app's
    // /templates Handoffs tab leaves this project's entry tracking a version that no longer exists
    // and can never advance; the file stays (the project tier is the user's own and wins at the
    // hook either way) and the dead tracking is cleared. Mirrors handoff-sync.ts exactly.
    if (verdict === "no-template") {
      if (entry && entry.syncedFrom) {
        handoffs[id] = { id };
        changed = true;
      }
      continue;
    }
    if (verdict === "detached") continue;

    if (verdict === "materialize" || verdict === "refresh") {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, global.content);
      handoffs[id] = { id, syncedFrom: { version: global.version, hash: sha256(global.content) } };
      summary[verdict === "materialize" ? "materialized" : "refreshed"].push(id);
      changed = true;
      continue;
    }

    if (verdict === "stale-customized") {
      summary.staleCustomized.push(id);
      continue;
    }

    summary.unchanged.push(id);
  }

  if (changed) {
    fs.writeFileSync(configPath, JSON.stringify({ ...cfg, handoffs }, null, 2));
  }
  return summary;
}

try {
  const claudeDir = path.join(projectDir, ".claude");
  const orchestratorSkillDir = path.join(claudeDir, "skills", "maestro");
  const scriptsDir = path.join(claudeDir, "scripts");
  ensureDir(orchestratorSkillDir);
  ensureDir(scriptsDir);
  ensureDir(path.join(scriptsDir, "lib"));

  const orchestratorSkill = installOrchestratorSkill(
    path.join(pluginRoot, "templates", "maestro", "SKILL.md"),
    path.join(orchestratorSkillDir, "SKILL.md")
  );

  // Runtime scripts the orchestrator / hooks invoke via $CLAUDE_PROJECT_DIR.
  // They run in-place inside the project, whose package.json may declare "type": "module" — so
  // hook scripts are copied as .cjs to stay CommonJS regardless. Only files that differ are
  // rewritten, so a second run reports nothing left to do.
  const scriptsWritten = [];
  for (const asset of runtimeAssets()) {
    const from = path.join(pluginRoot, ...asset.src.split("/"));
    const to = path.join(projectDir, ...asset.dest.split("/"));
    const source = fs.readFileSync(from);
    if (fs.existsSync(to) && fs.readFileSync(to).equals(source)) continue;
    ensureDir(path.dirname(to));
    fs.writeFileSync(to, source);
    if (asset.executable) fs.chmodSync(to, 0o755);
    scriptsWritten.push(asset.dest);
  }

  const { setBashHook, hooksAdded } = mergeSettings(path.join(claudeDir, "settings.json"));
  const wroteRepoGitignore = ensureRepoRootGitignore(findRepoRoot(projectDir));

  // Seed maestro.json only when there isn't one. An existing config is the user's own graph —
  // re-seeding it would silently discard every workflow and rule assignment they authored.
  // The format matches apps/maestro/src/core's writeConfig exactly (2-space indent, NO trailing
  // newline), so a project seeded here and then saved from the desktop app shows no diff.
  const configPath = path.join(claudeDir, "maestro.json");
  let seededConfig = false;
  if (!fs.existsSync(configPath)) {
    const seeded = { ...defaultV3Config(implAgents, skillMap), project_tags: projectTags };
    fs.writeFileSync(configPath, JSON.stringify(seeded, null, 2));
    seededConfig = true;
  }

  // Stamp runtimeVersion last, after every file it describes is current on disk. Mirrors
  // apps/maestro/src/core/install.ts's installRuntime() so both delivery paths produce the same
  // result — see that file's writeRuntimeVersion for why this no-ops when maestro.json is still
  // absent (a missing --impl-agents/no-git-repo edge case) rather than half-seeding one here.
  const { version: runtimeVersion } = JSON.parse(
    fs.readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8")
  );
  let runtimeVersionUpdated = false;
  if (fs.existsSync(configPath)) {
    const current = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (current.runtimeVersion !== runtimeVersion) {
      current.runtimeVersion = runtimeVersion;
      fs.writeFileSync(configPath, JSON.stringify(current, null, 2));
      runtimeVersionUpdated = true;
    }
  }

  const reportsSync = syncProjectReports(configPath, projectDir);
  const handoffsSync = syncProjectHandoffs(configPath, projectDir);

  process.stdout.write(
    JSON.stringify({
      ok: true,
      installedOrchestratorSkill: orchestratorSkill.action === "installed",
      orchestratorSkill,
      scriptsWritten,
      setBashHook,
      hooksAdded,
      wroteRepoGitignore,
      seededConfig,
      implAgents: seededConfig ? implAgents : undefined,
      projectTags: seededConfig ? projectTags : undefined,
      runtimeVersion,
      runtimeVersionUpdated,
      reportsSync,
      handoffsSync,
    }) + "\n"
  );
} catch (err) {
  process.stderr.write(`maestro-install: ${err.message}\n`);
  process.exit(1);
}
