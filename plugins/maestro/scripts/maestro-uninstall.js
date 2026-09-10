#!/usr/bin/env node
// Uninstalls / disables the Maestro orchestrator in a project. The inverse of
// maestro-install.js. Idempotent — safe to re-run.
//
//   node maestro-uninstall.js [projectDir] [--purge] [--delete-maestro-tasks]
//     [--delete-materialized-reports] [--delete-materialized-handoffs]
//
// Default: removes every Maestro hook registered against .claude/scripts/ from
//   <project>/.claude/settings.json (only the keys Maestro added; all other keys
//   are preserved), deletes the ephemeral session files (maestro_session.json,
//   maestro_session.log.jsonl, maestro_session_tasks.json), and cleans up any
//   legacy `agent: "maestro"` key left by older installs.
// --purge: additionally removes the installed orchestrator skill (and any
//   SKILL.md.bak the installer's managed-region migration left behind), the
//   project-copied runtime scripts, any `.claude/templates/handoffs/` protocol an
//   install before 0.4.2 left behind, and the user-authored config (maestro.json) —
//   i.e. everything the install pipeline produced. What counts as "the project-copied
//   runtime scripts" comes from TWO sources, unioned, mirroring
//   apps/maestro/src/core/uninstall.ts's purgeTargets(): (1) maestro-install.js's own
//   manifest — what the CURRENT release installs — required directly from that file
//   rather than re-typed here, so this can never fall behind it; and (2) a sweep of
//   .claude/scripts/ (and the now-archaeological .claude/templates/handoffs/) for
//   anything already in the app's `maestro-`/`bash-validation.sh` namespace, so a
//   script an OLDER release installed and this one no longer ships is still found.
//
//   In --purge mode, this also *reports* on the file-based task queue at
//   .claude/maestro-tasks/, and on what's materialized under .claude/reports/ and
//   .claude/handoffs/, but never deletes any of the three here — they're
//   user-authored content, not install artifacts. The caller shows the report to the
//   user and only passes the matching --delete-* flag on a follow-up run for each one
//   the user separately agrees to.
// --delete-maestro-tasks: requires --purge. Deletes .claude/maestro-tasks/.
// --delete-materialized-reports: requires --purge. Deletes .claude/reports/.
// --delete-materialized-handoffs: requires --purge. Deletes .claude/handoffs/.
//   Each of the three --delete-* flags is independent and pass only after the user has
//   explicitly agreed to THAT directory — this script doesn't prompt; the calling
//   skill owns that confirmation, one question per directory.
//
// Default (no --purge): never touches maestro.json, maestro-tasks/, reports/ or
// handoffs/ — those are user-authored and kept so a later /maestro-install can
// restore things.
// Prints a JSON summary to stdout.

const fs = require("fs");
const path = require("path");
const { tasksDir, listTaskFiles, statusPath } = require("./lib/maestro-tasks.cjs");
// The install's own manifest — REQUIRED rather than re-typed, so the hook-script set
// and the asset list this uninstall targets can never drift from what actually gets
// installed (`060`). Requiring this file has no side effect: everything that reads or
// writes a project inside it runs only under `require.main === module`.
const { HOOK_REGISTRATIONS, runtimeAssets } = require("./maestro-install.js");

const args = process.argv.slice(2);
const purge = args.includes("--purge");
const deleteMaestroTasks = args.includes("--delete-maestro-tasks");
const deleteMaterializedReports = args.includes("--delete-materialized-reports");
const deleteMaterializedHandoffs = args.includes("--delete-materialized-handoffs");
const projectDir = args.find((a) => !a.startsWith("--")) || process.env.CLAUDE_PROJECT_DIR || process.cwd();

for (const [flag, needsPurge] of [
  ["--delete-maestro-tasks", deleteMaestroTasks],
  ["--delete-materialized-reports", deleteMaterializedReports],
  ["--delete-materialized-handoffs", deleteMaterializedHandoffs],
]) {
  if (needsPurge && !purge) {
    process.stderr.write(`maestro-uninstall: ${flag} requires --purge\n`);
    process.exit(1);
  }
}

// Every script basename a Maestro hook command may reference, derived from the
// install's own registrations rather than hand-maintained here — an unlisted hook
// used to survive uninstall silently and still be reported as "nothing to remove"
// (`060`).
const HOOK_SCRIPT_NAMES = new Set(HOOK_REGISTRATIONS.map((r) => r.script));

/**
 * Every `.claude/scripts/<name>` reference in a command string.
 *
 * Matched by pattern rather than by exact string so a user who re-quoted or
 * re-prefixed a command still gets it removed — the same tolerance the installer's
 * `hasHook` uses to decide a hook is already present. Stopping at quotes, whitespace
 * and shell separators is what keeps the captured name a filename, and comparing the
 * whole basename (not a substring) is what keeps a user's own
 * `maestro-session-log-wrapper.cjs` from being claimed by `maestro-session-log.cjs`.
 */
const SCRIPT_REFERENCE = /\.claude[/\\]scripts[/\\]([^"'\s;|&]+)/g;

function maestroScriptIn(command) {
  if (typeof command !== "string") return null;
  for (const m of command.matchAll(SCRIPT_REFERENCE)) {
    const name = path.posix.basename(m[1]);
    if (HOOK_SCRIPT_NAMES.has(name)) return name;
  }
  return null;
}

// Strip every Maestro hook from settings.json, dropping entries left empty and
// events left with no entries. Returns the `<event>:<script>` ids removed.
function removeMaestroHooks(settings) {
  const removed = [];
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== "object") return removed;
  for (const event of Object.keys(hooks)) {
    const entries = hooks[event];
    if (!Array.isArray(entries)) continue;
    let touched = false;
    for (const entry of entries) {
      if (!entry || !Array.isArray(entry.hooks)) continue;
      const before = entry.hooks.length;
      entry.hooks = entry.hooks.filter((h) => {
        const script = h && maestroScriptIn(h.command);
        if (script) removed.push(`${event}:${script}`);
        return !script;
      });
      if (entry.hooks.length !== before) touched = true;
    }
    if (!touched) continue; // leave events we didn't touch exactly as the user wrote them
    const kept = entries.filter((e) => !(e && Array.isArray(e.hooks) && e.hooks.length === 0));
    if (kept.length === 0) delete hooks[event];
    else hooks[event] = kept;
  }
  if (removed.length > 0 && Object.keys(hooks).length === 0) delete settings.hooks;
  return removed;
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
  if (removedAgentSetting || removedHooks.length > 0) {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  }
  return { removedAgentSetting, removedHooks: removedHooks.length > 0 };
}

function removeIfPresent(p) {
  if (!fs.existsSync(p)) return false;
  fs.rmSync(p, { recursive: true, force: true });
  return true;
}

// Every file under `dir`, recursively, as absolute paths. Used both for the purge
// sweep (below) and for reporting what's materialized under reports/handoffs.
function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else out.push(full);
  }
  return out;
}

// `.md` files under `dir`, recursively, as paths RELATIVE TO `dir` (so a handoff's
// `<sender>/<receiver>.md` nesting survives) — used only to REPORT what .claude/reports/ and
// .claude/handoffs/ hold. Neither directory is ever a purge target; see the header.
function mdFilesUnder(dir) {
  return filesUnder(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.relative(dir, f).split(path.sep).join("/"))
    .sort();
}

// Mirrors apps/maestro/src/core/uninstall.ts's findMaterializedFiles(). Reporting only, until the
// caller separately opts into `deleted` via its own --delete-materialized-* flag.
function materializedFilesFinding(dir) {
  const files = mdFilesUnder(dir);
  return { dir: path.relative(projectDir, dir), fileCount: files.length, files, deleted: false };
}

/**
 * Is this file in `.claude/scripts/` (or the archaeological `.claude/templates/handoffs/`) one
 * THIS PLUGIN put there, under any release? `maestro-` is the app's namespace inside its own
 * scripts directory and `bash-validation.sh` is the one exception it shipped under another name —
 * anything else in there is the user's. Mirrors apps/maestro/src/core/uninstall.ts's
 * looksAppInstalled() exactly: the manifest above covers what the CURRENT release installs, this
 * predicate covers what an OLDER one did.
 */
function looksAppInstalled(absPath) {
  const name = path.basename(absPath);
  return name.startsWith("maestro-") || name === "bash-validation.sh";
}

/**
 * Everything a purge would delete, as absolute paths, existing-only, most consequential first —
 * `maestro.json` leads (it's the one file the user can't get back), same ordering
 * apps/maestro/src/core/uninstall.ts's purgeTargets() uses. Two sources, unioned and
 * de-duplicated: the manifest (what the CURRENT release installs) and a sweep of
 * `.claude/scripts/` + `.claude/templates/handoffs/` filtered by looksAppInstalled (what an OLDER
 * release left behind that this one no longer ships).
 */
function purgeTargets(claudeDir) {
  const candidates = [
    path.join(claudeDir, "maestro.json"),
    path.join(claudeDir, "skills", "maestro", "SKILL.md"),
    // Backup left by the installer when it migrates a pre-managed-regions skill.
    path.join(claudeDir, "skills", "maestro", "SKILL.md.bak"),
    ...runtimeAssets().map((a) => path.join(projectDir, ...a.dest.split("/"))),
    ...filesUnder(path.join(claudeDir, "scripts")).filter(looksAppInstalled),
    ...filesUnder(path.join(claudeDir, "templates", "handoffs")),
  ];
  const seen = new Set();
  const out = [];
  for (const c of candidates) {
    if (seen.has(c) || !fs.existsSync(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
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
    for (const t of purgeTargets(claudeDir)) if (removeIfPresent(t)) purged.push(path.relative(projectDir, t));
  }

  // Report-only, always under purge — .claude/reports/ and .claude/handoffs/ are never in
  // purgeTargets() above (see the header), so this only says what's there until one of the two
  // --delete-materialized-* flags opts into removing it.
  let materializedReports = null;
  let materializedHandoffs = null;
  if (purge) {
    const reportsDir = path.join(claudeDir, "reports");
    const handoffsDir = path.join(claudeDir, "handoffs");
    materializedReports = materializedFilesFinding(reportsDir);
    materializedHandoffs = materializedFilesFinding(handoffsDir);

    if (deleteMaterializedReports && materializedReports.fileCount > 0) {
      materializedReports.deleted = removeIfPresent(reportsDir);
      if (materializedReports.deleted) purged.push(path.relative(projectDir, reportsDir));
    }
    if (deleteMaterializedHandoffs && materializedHandoffs.fileCount > 0) {
      materializedHandoffs.deleted = removeIfPresent(handoffsDir);
      if (materializedHandoffs.deleted) purged.push(path.relative(projectDir, handoffsDir));
    }
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
      materializedReports,
      materializedHandoffs,
      keptConfig: !purge,
    }) + "\n"
  );
} catch (err) {
  process.stderr.write(`maestro-uninstall: ${err.message}\n`);
  process.exit(1);
}
