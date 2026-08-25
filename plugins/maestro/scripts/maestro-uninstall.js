#!/usr/bin/env node
// Uninstalls / disables the Maestro orchestrator in a project. The inverse of
// maestro-install.js. Idempotent — safe to re-run.
//
//   node maestro-uninstall.js [projectDir] [--purge] [--delete-maestro-tasks]
//
// Default: removes every Maestro hook registered against .claude/scripts/ from
//   <project>/.claude/settings.json (only the keys Maestro added; all other keys
//   are preserved), deletes the ephemeral session files (maestro_session.json,
//   maestro_session.log.jsonl, maestro_session_tasks.json), and cleans up any
//   legacy `agent: "maestro"` key left by older installs.
// --purge: additionally removes the installed orchestrator skill (and any
//   SKILL.md.bak the installer's managed-region migration left behind), the
//   project-copied runtime scripts, and the user-authored config (maestro.json) —
//   i.e. everything the install pipeline produced. Keep this list in sync with the
//   files maestro-install.js copies into .claude/scripts/.
//
//   In --purge mode, this also *reports* on the file-based task queue at
//   .claude/maestro-tasks/ but never deletes it here — it's user-authored
//   content, not an install artifact. The caller shows the report to the user
//   and only passes --delete-maestro-tasks on a follow-up run if they agree.
// --delete-maestro-tasks: requires --purge. Deletes .claude/maestro-tasks/.
//   Pass only after the user has explicitly agreed — this script doesn't
//   prompt; the calling skill owns that confirmation.
//
// Default (no --purge): never touches maestro.json or maestro-tasks/ — those
// are user-authored and kept so a later /maestro-install can restore things.
// Prints a JSON summary to stdout.

const fs = require("fs");
const path = require("path");
const { tasksDir, listTaskFiles, statusPath } = require("./lib/maestro-tasks.cjs");

const args = process.argv.slice(2);
const purge = args.includes("--purge");
const deleteMaestroTasks = args.includes("--delete-maestro-tasks");
const projectDir = args.find((a) => !a.startsWith("--")) || process.env.CLAUDE_PROJECT_DIR || process.cwd();

if (deleteMaestroTasks && !purge) {
  process.stderr.write("maestro-uninstall: --delete-maestro-tasks requires --purge\n");
  process.exit(1);
}

// Every runtime script the install path registers a hook for. Keep in sync with
// HOOK_REGISTRATIONS in apps/maestro/src/core/install.ts — the desktop app's
// installer registers all of these in the PROJECT's settings.json (pointing at
// $CLAUDE_PROJECT_DIR/.claude/scripts/), where the old skill-based install only
// ever registered bash-validation.sh and left the rest to the plugin's hooks.json.
// An uninstall that removed only the latter would leave a project firing hooks at
// scripts --purge has just deleted.
const HOOK_SCRIPTS = [
  "bash-validation.sh",
  "maestro-session-log.cjs",
  "maestro-subagent-log.cjs",
  "maestro-inject-agent-context.cjs",
  "maestro-validate-tasks.cjs",
  "maestro-session-cleanup.cjs",
];

// Strip every Maestro hook from settings.json, dropping entries left empty and
// events left with no entries. Matched on the script basename inside the command
// (not on an exact string) so a hand-requoted command is still removed — the same
// key the installer uses to decide a hook is already present.
function removeMaestroHooks(settings) {
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== "object") return false;
  let changed = false;
  for (const event of Object.keys(hooks)) {
    const entries = hooks[event];
    if (!Array.isArray(entries)) continue;
    let touched = false;
    for (const entry of entries) {
      if (!entry || !Array.isArray(entry.hooks)) continue;
      const before = entry.hooks.length;
      entry.hooks = entry.hooks.filter(
        (h) =>
          !(
            h &&
            typeof h.command === "string" &&
            h.command.includes(".claude/scripts/") &&
            HOOK_SCRIPTS.some((s) => h.command.includes(s))
          )
      );
      if (entry.hooks.length !== before) touched = true;
    }
    if (!touched) continue; // leave events we didn't touch exactly as the user wrote them
    changed = true;
    const kept = entries.filter((e) => !(e && Array.isArray(e.hooks) && e.hooks.length === 0));
    if (kept.length === 0) delete hooks[event];
    else hooks[event] = kept;
  }
  if (changed && Object.keys(hooks).length === 0) delete settings.hooks;
  return changed;
}

// Removes the Maestro hooks (and any legacy `agent: "maestro"` from older installs)
// from settings.json in one read/write. Returns which keys were touched.
function cleanSettings(settingsPath) {
  if (!fs.existsSync(settingsPath)) return { removedAgentSetting: false, removedHooks: false };
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    return { removedAgentSetting: false, removedHooks: false };
  }
  let removedAgentSetting = false;
  if (settings.agent === "maestro") {
    delete settings.agent;
    removedAgentSetting = true;
  }
  const removedHooks = removeMaestroHooks(settings);
  if (removedAgentSetting || removedHooks) {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }
  return { removedAgentSetting, removedHooks };
}

function removeIfPresent(p) {
  if (!fs.existsSync(p)) return false;
  fs.rmSync(p, { recursive: true, force: true });
  return true;
}

try {
  const claudeDir = path.join(projectDir, ".claude");

  const { removedAgentSetting, removedHooks } = cleanSettings(path.join(claudeDir, "settings.json"));
  const removedSession = [
    removeIfPresent(path.join(claudeDir, "maestro_session.json")),
    removeIfPresent(path.join(claudeDir, "maestro_session.log.jsonl")),
    removeIfPresent(path.join(claudeDir, "maestro_session_tasks.json")),
  ].some(Boolean);

  const purged = [];
  if (purge) {
    const targets = [
      path.join(claudeDir, "skills", "maestro", "SKILL.md"),
      // Backup left by the installer when it migrates a pre-managed-regions skill.
      path.join(claudeDir, "skills", "maestro", "SKILL.md.bak"),
      path.join(claudeDir, "scripts", "maestro-set-session-workflow.cjs"),
      path.join(claudeDir, "scripts", "maestro-render-orchestrator.cjs"),
      path.join(claudeDir, "scripts", "maestro-task-status.cjs"),
      path.join(claudeDir, "scripts", "bash-validation.sh"),
      // Hook scripts the desktop app copies in (as .cjs, so they run under a
      // "type": "module" project) instead of running them from the plugin root.
      path.join(claudeDir, "scripts", "maestro-session-log.cjs"),
      path.join(claudeDir, "scripts", "maestro-subagent-log.cjs"),
      path.join(claudeDir, "scripts", "maestro-inject-agent-context.cjs"),
      path.join(claudeDir, "scripts", "maestro-validate-tasks.cjs"),
      path.join(claudeDir, "scripts", "maestro-session-cleanup.cjs"),
      path.join(claudeDir, "scripts", "lib", "maestro-session.cjs"),
      path.join(claudeDir, "scripts", "lib", "maestro-tasks.cjs"),
      path.join(claudeDir, "scripts", "lib", "maestro-skill-regions.cjs"),
      // Handoff protocols the app installs. NOT .claude/handoffs/ — that path is
      // the user's own override and nothing here put it there.
      path.join(claudeDir, "templates", "handoffs"),
      path.join(claudeDir, "maestro.json"),
    ];
    for (const t of targets) if (removeIfPresent(t)) purged.push(path.relative(projectDir, t));
  }

  // Report-only by default — .claude/maestro-tasks/ is user-authored content,
  // not an install artifact, so it's never deleted just because --purge ran.
  let maestroTasks = null;
  if (purge) {
    const files = listTaskFiles(projectDir);
    const hasStatusJson = fs.existsSync(statusPath(projectDir));
    let deleted = false;
    if (deleteMaestroTasks && (files.length > 0 || hasStatusJson)) {
      deleted = removeIfPresent(tasksDir(projectDir));
      if (deleted) purged.push(path.relative(projectDir, tasksDir(projectDir)));
    }
    maestroTasks = {
      dir: path.relative(projectDir, tasksDir(projectDir)),
      fileCount: files.length,
      files,
      hasStatusJson,
      deleted,
    };
  }

  process.stdout.write(
    JSON.stringify({
      ok: true,
      removedAgentSetting,
      removedHooks,
      removedSession,
      purged: purge ? purged : null,
      maestroTasks,
      keptConfig: !purge,
    }) + "\n"
  );
} catch (err) {
  process.stderr.write(`maestro-uninstall: ${err.message}\n`);
  process.exit(1);
}
