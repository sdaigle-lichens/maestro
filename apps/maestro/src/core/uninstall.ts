// Removing Maestro's runtime half from a project, from the app.
//
// PORTED FROM plugins/maestro/scripts/maestro-uninstall.js. The mirror of install.ts,
// and deliberately not symmetrical with it: install writes files the app owns, uninstall deletes
// files the USER may have hours of work in. That asymmetry is the whole design here.
//
//   THE TWO LEVELS ARE THE CONTRACT. The default removes the registered hooks and the ephemeral
//   session files and KEEPS `.claude/maestro.json` — someone who wants the hooks to stop firing
//   has not asked to throw away their workflow graph and rule assignments. Only an explicit purge
//   also removes the orchestrator skill, the copied scripts, and the config. Collapsing the two
//   into one action, or making purge the default, turns "stop the hooks" into silent data loss.
//
// Three rules this file exists to enforce:
//
//   1. REMOVE ONLY OUR OWN. `.claude/settings.json` is a file users hand-edit. A command is ours
//      only if it points into `.claude/scripts/` AND names a script we register — other hooks,
//      other matchers, other events, and every non-hook key survive untouched. A settings file
//      emptied or clobbered on uninstall is a worse bug than anything install can cause.
//   2. NOTHING, OR EVERYTHING ASKED FOR. Like install, the settings preflight runs before the
//      first deletion, so a project whose settings.json doesn't parse is left exactly as it was
//      instead of half-uninstalled.
//   3. PURGE DELETES WHAT INSTALL CREATED — no more, no less. Targets come from the runtime
//      manifest plus a sweep of the two directories the app owns (`.claude/scripts/` and
//      `.claude/templates/handoffs/`), so a project installed by an OLDER release is not left with
//      orphans of scripts that release shipped. `.claude/handoffs/` is the user's override
//      location and is never touched.

import fs from "node:fs";
import path from "node:path";
import { maestroJsonPath } from "./config.js";
import { orchestratorSkillPath } from "./render.js";
import { tasksDirFor } from "./tasks.js";
import {
  HOOK_REGISTRATIONS,
  installStatus,
  projectPath,
  readSettings,
  requirePluginRoot,
  runtimeAssets,
  settingsPathFor,
  writeJsonAtomic,
  type Settings,
} from "./install.js";
import type { MaestroTasksFinding, UninstallPlan, UninstallReport } from "./contracts.js";

export type { UninstallPlan, UninstallReport };

export interface UninstallOptions {
  /**
   * Also delete the orchestrator skill, the copied runtime scripts, the installed handoff
   * protocols and `maestro.json`. Destructive and irreversible — never default it to true.
   */
  purge?: boolean;
  /**
   * Also delete `.claude/maestro-tasks/` — the file-based task queue `/to-maestro-tasks` writes.
   * A second, independent opt-in on top of `purge` (an error without it): that queue is
   * user-authored content, not an install artifact, and a purge alone must never take it.
   */
  deleteMaestroTasks?: boolean;
  /** Where the app's runtime files live. Defaults to the same lookup install uses. */
  pluginRoot?: string;
}

const MAESTRO_TASKS_REL = ".claude/maestro-tasks";

/**
 * What's in the file-based task queue right now, independent of which uninstall level runs — the
 * read that fills the plan's `maestroTasks`, so the UI can show the user what a follow-up
 * `deleteMaestroTasks` purge would take before they opt into it.
 */
function findMaestroTasks(projectRoot: string): MaestroTasksFinding {
  const dir = tasksDirFor(projectRoot);
  let files: string[] = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    files = [];
  }
  return { dir: MAESTRO_TASKS_REL, files, hasStatusJson: fs.existsSync(path.join(dir, "status.json")) };
}

/**
 * The per-session files the runtime writes into `.claude/`.
 *
 * Same list as `maestro-session-cleanup.cjs`'s EPHEMERAL — these are recreated by the next session
 * and are gitignored by the install, so deleting them loses nothing. `maestro_session_tasks.json`
 * is a ledger of step labels, NOT the user's tasks (those live in Claude Code's task system).
 */
const SESSION_FILES = ["maestro_session.json", "maestro_session.log.jsonl", "maestro_session_tasks.json"];

// ── which hook commands are ours ───────────────────────────────────────────

const HOOK_SCRIPT_NAMES = new Set(HOOK_REGISTRATIONS.map((r) => r.script));

/**
 * Every `.claude/scripts/<name>` reference in a command string.
 *
 * Matched by pattern rather than by exact string so a user who re-quoted or re-prefixed a command
 * still gets it removed — the same tolerance `hasHook` uses to decide a hook is already present.
 * Stopping at quotes, whitespace and shell separators is what keeps the captured name a filename.
 */
const SCRIPT_REFERENCE = /\.claude[/\\]scripts[/\\]([^"'\s;|&]+)/g;

/**
 * Does this command run one of the scripts we register?
 *
 * Both halves are required. Path alone would claim a user's own script that happens to live in
 * `.claude/scripts/`; name alone would claim `~/bin/maestro-session-log.cjs`, which is not ours to
 * delete. And the comparison is on the whole basename, not a substring, so a user's
 * `maestro-session-log-wrapper.cjs` survives.
 */
function maestroScriptIn(command: unknown): string | null {
  if (typeof command !== "string") return null;
  for (const m of command.matchAll(SCRIPT_REFERENCE)) {
    const name = path.posix.basename(m[1]);
    if (HOOK_SCRIPT_NAMES.has(name)) return name;
  }
  return null;
}

/** Hook ids in `settings` that belong to Maestro, in the order they appear. */
function maestroHookIds(settings: Settings): string[] {
  const ids: string[] = [];
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== "object") return ids;
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry || !Array.isArray(entry.hooks)) continue;
      for (const h of entry.hooks) {
        const script = h && maestroScriptIn(h.command);
        if (script) ids.push(`${event}:${script}`);
      }
    }
  }
  return ids;
}

/**
 * Strip every Maestro hook from `settings` in place. Returns the ids removed.
 *
 * Entries and event lists are pruned only where WE emptied them: an entry the user left empty, and
 * an event we never matched, come out exactly as they went in. That is the difference between
 * "removed our hooks" and "tidied the user's settings file", and only the first is ours to do.
 */
function removeMaestroHooks(settings: Settings): string[] {
  const removed: string[] = [];
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== "object") return removed;

  for (const event of Object.keys(hooks)) {
    const entries = hooks[event];
    if (!Array.isArray(entries)) continue;
    const emptied = new Set<unknown>();
    for (const entry of entries) {
      if (!entry || !Array.isArray(entry.hooks)) continue;
      const kept = entry.hooks.filter((h) => {
        const script = h && maestroScriptIn(h.command);
        if (script) removed.push(`${event}:${script}`);
        return !script;
      });
      if (kept.length === entry.hooks.length) continue;
      entry.hooks = kept;
      if (kept.length === 0) emptied.add(entry);
    }
    if (emptied.size === 0) continue;
    const keptEntries = entries.filter((e) => !emptied.has(e));
    if (keptEntries.length === 0) delete hooks[event];
    else hooks[event] = keptEntries;
  }

  if (removed.length > 0 && Object.keys(hooks).length === 0) delete settings.hooks;
  return removed;
}

// ── what a purge would delete ──────────────────────────────────────────────

/** Files under `dir`, project-relative with `/` separators, recursively, sorted. */
function filesUnder(projectRoot: string, dir: string): string[] {
  const abs = projectPath(projectRoot, dir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...filesUnder(projectRoot, rel));
    else out.push(rel);
  }
  return out.sort();
}

/**
 * Is this file in `.claude/scripts/` one the app put there?
 *
 * The manifest covers what the CURRENT release installs; this predicate covers what an older one
 * did. `maestro-` is the app's namespace inside its own scripts directory and `bash-validation.sh`
 * is the one exception it shipped under another name — anything else in there is the user's.
 */
function looksAppInstalled(rel: string): boolean {
  const name = path.posix.basename(rel);
  return name.startsWith("maestro-") || name === "bash-validation.sh";
}

/**
 * Everything a purge would delete, project-relative, existing-only.
 *
 * MOST CONSEQUENTIAL FIRST. A full install is ~37 files, nearly all of them handoff templates, and
 * the confirmation renders this list in order — with `maestro.json` last it would sit below the
 * fold of the scroll box, which is the one file the user cannot get back. De-duplicated because
 * the manifest and the sweep overlap on every current install.
 */
export function purgeTargets(projectRoot: string, pluginRoot?: string): string[] {
  const rel = (abs: string) => path.relative(projectRoot, abs).split(path.sep).join("/");
  const candidates = [
    rel(maestroJsonPath(projectRoot)),
    rel(orchestratorSkillPath(projectRoot)),
    // Left by the installer when it migrates a skill that predates the managed regions. Purge is
    // the only thing that removes it; a default uninstall keeps the user's prose.
    `${rel(orchestratorSkillPath(projectRoot))}.bak`,
    ...runtimeAssets(pluginRoot).map((a) => a.dest),
    // Scripts and handoff protocols an older release installed and this one no longer ships.
    ...filesUnder(projectRoot, ".claude/scripts").filter(looksAppInstalled),
    ...filesUnder(projectRoot, ".claude/templates/handoffs"),
  ];

  const seen = new Set<string>();
  return candidates.filter((c) => {
    if (seen.has(c) || !fs.existsSync(projectPath(projectRoot, c))) return false;
    seen.add(c);
    return true;
  });
}

/**
 * Remove directories left empty by `removed`, deepest first, stopping at `.claude`.
 *
 * `.claude/scripts` has to go for `InstallStatus.installed` to read false after a purge. Pruning
 * only EMPTY directories is what makes that safe: a user's own script in there keeps the directory
 * alive, and `.claude` itself is never removed — it is the user's, not ours.
 */
function pruneEmptyDirs(projectRoot: string, removed: string[]): string[] {
  const stop = projectPath(projectRoot, ".claude");
  const dirs = new Set<string>();
  for (const relPath of removed) {
    let dir = path.dirname(projectPath(projectRoot, relPath));
    while (dir !== stop && dir.startsWith(stop + path.sep)) {
      dirs.add(dir);
      dir = path.dirname(dir);
    }
  }
  const pruned: string[] = [];
  // Longest path first: a child is always a strictly longer string than its parent, so this
  // visits leaves before the directories that contain them.
  for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
    try {
      fs.rmdirSync(dir); // throws ENOTEMPTY when anything is left, which is exactly the guard
      pruned.push(path.relative(projectRoot, dir).split(path.sep).join("/"));
    } catch {
      /* not empty, or already gone */
    }
  }
  return pruned;
}

// ── the plan ───────────────────────────────────────────────────────────────

/**
 * What each level would remove from `projectRoot` as it stands. Reads only; writes nothing.
 *
 * The UI calls this to fill the purge confirmation, so every path in `purgeFiles` is one that
 * exists right now — the dialog can never promise to delete a file the user doesn't have.
 */
export function uninstallPlan(projectRoot: string, pluginRoot?: string): UninstallPlan {
  let settings: Settings = {};
  let settingsUnreadable = false;
  try {
    settings = readSettings(settingsPathFor(projectRoot));
  } catch {
    settingsUnreadable = true;
  }

  const hooks = settingsUnreadable ? [] : maestroHookIds(settings);
  const sessionFiles = SESSION_FILES.map((f) => `.claude/${f}`).filter((f) =>
    fs.existsSync(projectPath(projectRoot, f))
  );
  const legacyAgentSetting = !settingsUnreadable && settings.agent === "maestro";
  const purgeFiles = purgeTargets(projectRoot, pluginRoot);

  return {
    projectRoot,
    hooks,
    sessionFiles,
    legacyAgentSetting,
    purgeFiles,
    purgeRemovesConfig: fs.existsSync(maestroJsonPath(projectRoot)),
    maestroTasks: findMaestroTasks(projectRoot),
    empty: hooks.length === 0 && sessionFiles.length === 0 && !legacyAgentSetting && purgeFiles.length === 0,
    settingsUnreadable,
  };
}

// ── uninstall ──────────────────────────────────────────────────────────────

/**
 * Remove Maestro's runtime from `projectRoot`. Idempotent, and a no-op on a project that has
 * nothing installed — `report.noop` says so and nothing is written.
 *
 * Ordering mirrors install: the one thing that can refuse — an unparseable settings.json — is
 * checked before the first deletion. Without that preflight a purge could delete every script and
 * then fail to unregister the hooks that point at them, leaving the project firing hooks at files
 * that no longer exist.
 */
export async function uninstallRuntime(projectRoot: string, options: UninstallOptions = {}): Promise<UninstallReport> {
  const { purge = false, deleteMaestroTasks = false } = options;
  if (!projectRoot) throw new Error("No project is open.");
  if (!fs.existsSync(projectRoot)) throw new Error(`${projectRoot} does not exist.`);
  if (deleteMaestroTasks && !purge) throw new Error("deleteMaestroTasks requires purge.");

  // Preflight, all of it before the first deletion: the runtime manifest (which both the purge
  // targets and the closing status read) and the settings file. Either can refuse; neither may
  // refuse halfway through.
  const pluginRoot = requirePluginRoot(options.pluginRoot);
  const targets = purge ? purgeTargets(projectRoot, pluginRoot) : [];
  const settingsPath = settingsPathFor(projectRoot);
  const settings = readSettings(settingsPath);

  const hooksRemoved = removeMaestroHooks(settings);
  let legacyAgentSettingRemoved = false;
  if (settings.agent === "maestro") {
    delete settings.agent;
    legacyAgentSettingRemoved = true;
  }
  if (hooksRemoved.length > 0 || legacyAgentSettingRemoved) {
    // A settings.json with nothing left in it once our hooks are gone is one the install created;
    // deleting it is what makes a purge leave the tree as it found it. Guarded on the object being
    // provably empty, so no key of the user's can be lost this way.
    if (purge && Object.keys(settings).length === 0) fs.rmSync(settingsPath, { force: true });
    else writeJsonAtomic(settingsPath, settings);
  }

  const sessionFilesRemoved: string[] = [];
  for (const file of SESSION_FILES) {
    const rel = `.claude/${file}`;
    const abs = projectPath(projectRoot, rel);
    if (!fs.existsSync(abs)) continue;
    fs.rmSync(abs, { force: true });
    sessionFilesRemoved.push(rel);
  }

  const purged: string[] = [];
  for (const target of targets) {
    fs.rmSync(projectPath(projectRoot, target), { recursive: true, force: true });
    purged.push(target);
  }

  // Independent of the loop above on purpose: .claude/maestro-tasks/ is never in `targets`, so a
  // plain purge can't take it — only a purge that also opted into deleteMaestroTasks does.
  let maestroTasksDeleted = false;
  if (purge && deleteMaestroTasks) {
    const tasksDir = projectPath(projectRoot, MAESTRO_TASKS_REL);
    if (fs.existsSync(tasksDir)) {
      fs.rmSync(tasksDir, { recursive: true, force: true });
      purged.push(MAESTRO_TASKS_REL);
      maestroTasksDeleted = true;
    }
  }

  const dirsPruned = pruneEmptyDirs(projectRoot, [...purged, ...sessionFilesRemoved]);

  const status = await installStatus(projectRoot, pluginRoot);

  const warnings: string[] = [];
  if (status.pluginHooksActive) {
    warnings.push(
      "The maestro plugin is also installed on this machine and registers Maestro's hooks globally, so they will keep firing in this project. Disable the plugin to stop them — the app does not edit your global Claude configuration."
    );
  }
  if (purge && status.configFile) {
    warnings.push(`${maestroJsonPath(projectRoot)} could not be deleted.`);
  }

  return {
    projectRoot,
    purge,
    hooksRemoved,
    sessionFilesRemoved,
    legacyAgentSettingRemoved,
    purged,
    maestroTasksDeleted,
    dirsPruned,
    configKept: fs.existsSync(maestroJsonPath(projectRoot)),
    noop:
      hooksRemoved.length === 0 &&
      sessionFilesRemoved.length === 0 &&
      !legacyAgentSettingRemoved &&
      purged.length === 0,
    warnings,
    status,
  };
}
