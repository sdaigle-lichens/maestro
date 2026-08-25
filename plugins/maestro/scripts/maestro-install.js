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
//   2. copies runtime scripts + handoff templates → <project>/.claude/scripts/ and
//      <project>/.claude/templates/handoffs/ (always refreshed). Includes the hook scripts
//      (maestro-inject-agent-context, maestro-subagent-log, maestro-session-log,
//      maestro-validate-tasks — copied as .cjs) and maestro-session-cleanup.cjs, so every hook
//      this install registers runs from a project-local copy rather than
//      ${CLAUDE_PLUGIN_ROOT} — see apps/maestro/src/core/install.ts's header for why.
//   3. merges the full Maestro hook set into <project>/.claude/settings.json (preserves other
//      keys): the bash-validation PreToolUse guard plus SubagentStart/SubagentStop/PreToolUse/
//      PostToolUse/SessionEnd, mirroring plugins/ai-tools-manager/hooks/hooks.json one-for-one.
//   4. adds an `# Maestro` section to the repo-root .gitignore ignoring every nested
//      .claude/maestro_session*.{json,jsonl} across the repo / monorepo (the `**/` glob covers
//      root-level .claude/ too, so no per-package .gitignore is needed)
//   5. seeds <project>/.claude/maestro.json from defaultV3Config — ONLY when absent. An existing
//      config is the user's authored graph and is never touched.
//
// It does NOT render the orchestrator skill's managed region: rendering consumes maestro.json,
// so it runs afterwards via maestro-render-orchestrator.cjs (the /maestro-install and
// /maestro-update skills both do this as their next step).
//
// This manifest (STATIC_ASSETS / HOOK_SCRIPTS / handoffAssets / HOOK_REGISTRATIONS below) mirrors
// apps/maestro/src/core/install.ts's one-for-one. If this list and that one ever diverge again,
// that's a bug in one of them — see that file's `RuntimeAsset`/`HOOK_REGISTRATIONS` for the
// reasoning behind each entry.
//
//   node maestro-install.js [projectDir] [--impl-agents backend,frontend] [--skill-map '{"frontend":["react"]}']
//
// The two flags only affect a fresh seed. The /maestro-install skill fills them in from its repo
// analysis; omitted, the seed falls back to ["backend"] with no skills attached. Editing the graph
// afterwards is the desktop app's job (apps/maestro) — or a hand-edit plus /maestro-update.
//
// `--skill-map` is only HALF of what actually gets seeded: this script also reads
// `~/.claude/maestro-skill-tags.sqlite` (global, keyed by skill id — the Maestro desktop app's
// Skills tab writes it) and unions a tag-derived skillMap in on top, so a skill the user has
// already tagged `backend`/`frontend`/`mobile`/`test`/`reviewer`/`refactor`/`scribe` is wired to
// that agent with no Claude session involved at all — the SKILL.md only needs to best-fit-guess
// (via AskUserQuestion) whatever `--skill-map` doesn't already cover from tags.
//
// Prints a JSON summary to stdout.

const fs = require("fs");
const path = require("path");
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
// looked at it. Wrapped in try/catch: an older `node` on this session's PATH (this script runs
// under whatever `node` invoked it, not Electron's bundled one) or a missing db file just means no
// tags to add — the install proceeds exactly as it did before this feature existed.
let tagSkillMap = {};
try {
  const { readAllSkillTags, skillMapFromTags } = require("./lib/maestro-skill-tags.cjs");
  tagSkillMap = skillMapFromTags(readAllSkillTags(), discoverProjectSkillIds(projectDir), seededAgentNames(implAgents));
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

const GITIGNORE_HEADER = "# Maestro ephemeral session state — recreated each session, removed at SessionEnd";

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
// plugins/ai-tools-manager/hooks/hooks.json one-for-one (see apps/maestro/src/core/install.ts's
// HOOK_REGISTRATIONS, which this list is kept in lockstep with) — every hook the plugin would
// otherwise run from ${CLAUDE_PLUGIN_ROOT}, plus the bash-validation guard.
const HOOK_REGISTRATIONS = [
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
];

// Every file this install copies into a project, `{ src, dest, executable? }` relative to the
// plugin root / project root respectively.
const STATIC_ASSETS = [
  { src: "scripts/maestro-set-session-workflow.cjs", dest: ".claude/scripts/maestro-set-session-workflow.cjs" },
  { src: "scripts/maestro-render-orchestrator.cjs", dest: ".claude/scripts/maestro-render-orchestrator.cjs" },
  { src: "scripts/maestro-task-status.cjs", dest: ".claude/scripts/maestro-task-status.cjs" },
  { src: "scripts/lib/maestro-session.cjs", dest: ".claude/scripts/lib/maestro-session.cjs" },
  { src: "scripts/lib/maestro-tasks.cjs", dest: ".claude/scripts/lib/maestro-tasks.cjs" },
  { src: "scripts/lib/maestro-skill-regions.cjs", dest: ".claude/scripts/lib/maestro-skill-regions.cjs" },
  { src: "scripts/bash-validation.sh", dest: ".claude/scripts/bash-validation.sh", executable: true },
  // SessionEnd cleanup. NOT the plugin's maestro-session-cleanup.sh — that one also tears down the
  // per-project web-app container, which is the plugin's business and not a project-local install's.
  { src: "scripts/maestro-session-cleanup.cjs", dest: ".claude/scripts/maestro-session-cleanup.cjs" },
  ...HOOK_SCRIPTS.map((name) => ({ src: `scripts/${name}.js`, dest: `.claude/scripts/${name}.cjs` })),
];

// Handoff-protocol templates, installed to `.claude/templates/handoffs/`. See
// apps/maestro/src/core/install.ts's handoffAssets() for why that destination (not
// `.claude/handoffs/`, which is left free as the user's override).
function handoffAssets(pluginRoot) {
  const base = path.join(pluginRoot, "templates", "handoffs");
  if (!fs.existsSync(base)) return [];
  const out = [];
  const walk = (rel) => {
    for (const entry of fs
      .readdirSync(path.join(base, rel), { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(next);
      else if (entry.name.endsWith(".md")) {
        out.push({ src: `templates/handoffs/${next}`, dest: `.claude/templates/handoffs/${next}` });
      }
    }
  };
  walk("");
  return out;
}

function runtimeAssets(pluginRoot) {
  return [...STATIC_ASSETS, ...handoffAssets(pluginRoot)];
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

  // Runtime scripts + handoff templates the orchestrator / hooks invoke via $CLAUDE_PROJECT_DIR.
  // They run in-place inside the project, whose package.json may declare "type": "module" — so
  // hook scripts are copied as .cjs to stay CommonJS regardless. Only files that differ are
  // rewritten, so a second run reports nothing left to do.
  const scriptsWritten = [];
  for (const asset of runtimeAssets(pluginRoot)) {
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
    fs.writeFileSync(configPath, JSON.stringify(defaultV3Config(implAgents, skillMap), null, 2));
    seededConfig = true;
  }

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
    }) + "\n"
  );
} catch (err) {
  process.stderr.write(`maestro-install: ${err.message}\n`);
  process.exit(1);
}
