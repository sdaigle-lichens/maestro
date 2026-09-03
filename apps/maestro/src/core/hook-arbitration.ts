// Which copy of a Maestro hook runs when both delivery paths are live.
//
// Two things can register the same hooks. A project installed by `installRuntime()` or
// `maestro-install.js` registers them in its own `.claude/settings.json`, pointing at
// `$CLAUDE_PROJECT_DIR/.claude/scripts/`; the maestro plugin registers them globally from its
// `hooks.json`, pointing into the marketplace cache. A machine with both used to fire every hook
// TWICE — every tool call logged twice, every subagent's context injected twice, and, because the
// two copies are independently versioned snapshots, sometimes from two DIFFERENT runtime versions.
//
// The arbitration lives here, in scripts this repo owns, rather than in the user's global
// configuration — which the app reads to notice things and never writes. The rule:
//
//   THE PLUGIN'S COPY OF A HOOK STANDS DOWN WHEN THE PROJECT REGISTERS THAT SAME HOOK ITSELF.
//
// Project-local wins because it is the copy the user can see, refresh and commit. Precedence is
// per hook, not per project: a partial install (some registrations missing) still gets the plugin
// covering the rest, so an incomplete install degrades to "everything runs" rather than "one hook
// silently never fires". Nothing at all is suppressed for a project with no local install — that
// is the case the plugin's global hooks exist to serve, and it keeps working untouched.
//
// KEYED ON THE REGISTRATION, NEVER ON THE TWIN FILE EXISTING. Plain `/maestro-uninstall` removes
// the registrations and deliberately LEAVES `.claude/scripts/` on disk (only `--purge` deletes
// them). A file-existence test would then suppress the plugin's hooks in favour of hooks nobody
// runs — turning Maestro off entirely instead of falling back to the plugin, which is a worse
// failure than the double-firing this fixes.
//
// Note this can only take effect once the plugin cache holds a copy of these scripts that carries
// the guard, i.e. after a `plugin.json` version bump — see the `updating-maestro` skill.

import fs from "node:fs";
import path from "node:path";

// Exported for uninstall.ts and install.ts, which read the same settings.json with the same
// tolerance for keys neither module wrote.
export interface HookCommand {
  type?: string;
  command?: string;
  [k: string]: unknown;
}
export interface HookEntry {
  matcher?: string;
  hooks?: HookCommand[];
  [k: string]: unknown;
}
export interface Settings {
  hooks?: Partial<Record<string, HookEntry[]>>;
  [k: string]: unknown;
}

/**
 * Does `settings` register `script` on `event`?
 *
 * Keyed on the script's basename appearing anywhere in a command string, not on an exact command
 * match: users re-quote paths, and both callers need the same tolerance — the installer so a
 * re-quoted command doesn't get a duplicate entry that fires twice, the runtime guard so a
 * re-quoted command is still recognised as the project owning that hook.
 */
export function settingsRegisterScript(settings: Settings, event: string, script: string): boolean {
  const entries = settings.hooks?.[event];
  if (!Array.isArray(entries)) return false;
  return entries.some(
    (e) =>
      e &&
      Array.isArray(e.hooks) &&
      e.hooks.some((h) => h && typeof h.command === "string" && h.command.includes(script))
  );
}

/**
 * The project-local twin of a plugin script: same stem, always `.cjs`.
 *
 * The installer renames every copied hook script to `.cjs` because a project's package.json may
 * say `"type": "module"`, which would make node parse their `require()` as ESM. The stem rule also
 * covers `maestro-session-cleanup.sh`, whose project twin is `maestro-session-cleanup.cjs`.
 */
export function projectTwinName(scriptPath: string): string {
  return path.basename(scriptPath).replace(/\.(js|cjs|sh)$/, "") + ".cjs";
}

/**
 * Settings files a project's own hooks can be registered in, in the order Claude Code merges them.
 * `settings.local.json` is the user's untracked tier — the installer never writes it, but a user
 * who moved our hooks there still owns those hooks and must not get them fired twice.
 */
const PROJECT_SETTINGS_FILES = ["settings.json", "settings.local.json"] as const;

/**
 * Should this copy of a hook script stand down in favour of the project's own?
 *
 * `scriptPath` is the running script (`__filename`), `cwd` the project from the hook payload, and
 * `event` the payload's `hook_event_name` when it carries one — omit it and every registered event
 * is considered, which is the safe superset.
 *
 * Always false for the project's own copy: it is the copy that should run, never the one that
 * yields. That check is what lets one source file serve as both the plugin's script and the copy
 * installed into a project.
 */
export function projectOwnsHook(scriptPath: string, cwd: string, event?: string): boolean {
  if (!cwd || !scriptPath) return false;

  const projectScripts = path.join(cwd, ".claude", "scripts");
  if (path.resolve(path.dirname(scriptPath)) === path.resolve(projectScripts)) return false;

  const twin = projectTwinName(scriptPath);
  for (const file of PROJECT_SETTINGS_FILES) {
    let settings: Settings;
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(path.join(cwd, ".claude", file), "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      settings = parsed as Settings;
    } catch {
      // Absent or unparseable ⇒ nothing project-local is registered there. An unparseable file
      // means Claude Code isn't running those hooks either, so the plugin's copy should.
      continue;
    }
    const events = event ? [event] : Object.keys(settings.hooks ?? {});
    if (events.some((e) => settingsRegisterScript(settings, e, twin))) return true;
  }
  return false;
}
