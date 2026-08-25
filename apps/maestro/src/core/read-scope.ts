// What a run can read, worked out before it runs.
//
// The confirmation dialog has always named what a run may WRITE. It said nothing about what the run
// may read, and reads are the larger surface by a long way: file reads and searches are
// auto-approved by the permission system and never raise a prompt, so the directory list a session
// is started with is the whole bound on what the model can see. Nothing about that is discovered at
// runtime — it is fully determined before anything spawns — so leaving it implicit was the app
// granting read access to whatever it happened to pass along.
//
// Two things make the answer here honest rather than merely plausible:
//
//   • It is built from the EFFECTIVE settings, resolved through `SettingsPort` (the Agent SDK's own
//     merge engine), not from what the app intended. A `~/.claude/settings.json` can add readable
//     directories and permission rules this app never chose, and a disclosure that echoed the app's
//     arguments would be wrong in exactly the cases that matter.
//   • Every value keeps its origin. A flat list of directories cannot distinguish "the app pointed
//     the run here" from "a file on disk widened it", and those are different things to consent to.
//
// This module is PURE — path arithmetic over a snapshot someone else resolved. That is what lets
// `claude-preview.ts` import it while remaining unable to start a process.

import path from "node:path";
import type {
  ClaudePermissionRule,
  ClaudeReadDirectory,
  ClaudeReadScope,
  ClaudeWriteTarget,
  EffectiveSettingsSnapshot,
  SettingsSourceInfo,
  SettingsTier,
} from "./contracts.js";

/**
 * How many permission rules are listed before the rest are merely counted.
 *
 * A machine with a well-used `~/.claude/settings.json` can carry hundreds of `allow` entries, and a
 * disclosure nobody scrolls to the end of is not a disclosure. The count of what was dropped stays,
 * because "and 240 more" is itself information about the configuration.
 */
export const RULE_DISPLAY_CAP = 40;

/** Is `child` the same path as `parent`, or inside it? Lexical — nothing is stat-ed. */
export function withinDirectory(parent: string, child: string): boolean {
  if (!parent || !child) return false;
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel));
}

/** The first tier whose file actually contains `value` in `pick`, low→high. Null when none does. */
function attribute(
  sources: SettingsSourceInfo[],
  pick: (s: SettingsSourceInfo) => string[],
  value: string
): { tier: SettingsTier; file: string | null } | null {
  for (const source of sources) {
    if (pick(source).includes(value)) return { tier: source.tier, file: source.path };
  }
  return null;
}

/** How a tier reads in a sentence — the dialog shows the file too, so this stays short. */
function tierLabel(tier: SettingsTier): string {
  switch (tier) {
    case "user":
      return "your user settings";
    case "project":
      return "the project's committed settings";
    case "local":
      return "this machine's local project settings";
    case "managed":
      return "managed (administrator) settings";
    case "flag":
      return "a settings file passed on the command line";
  }
}

export interface ReadScopeInput {
  /** The project the window has open. "" when there is none. */
  projectRoot: string;
  /** Where the run will start — for a create-* flow, not necessarily the open project. */
  cwd: string;
  /** What the same preview says the run may write, so the two can be compared. */
  targets: ClaudeWriteTarget[];
  /**
   * Trees THIS APP adds beyond the working directory — what it passes as `additionalDirectories`.
   *
   * Empty for a previewed run: `018` passes none, so a run reads its cwd and nothing else. The
   * session pane is the first caller to use it, for the marketplaces resolved out of
   * `known_marketplaces.json`. They are listed with `origin: "app"` rather than folded in with the
   * settings-contributed ones, because "the app chose this" and "a file you have not read chose
   * this" are the two answers this disclosure exists to keep apart.
   */
  additional?: Array<{ path: string; note: string }>;
  /**
   * Trees a PERSON opened, mid-session, by answering a permission prompt.
   *
   * The only origin on this list that did not exist before the run started, and the only one that
   * can be taken back. It is here rather than folded into `additional` because "the app opened this
   * for you" and "you opened this, in this conversation, and can close it again" are different
   * things — and the second one is the one a header has to be able to show and revoke.
   */
  granted?: Array<{ path: string; note: string }>;
  /** The resolved cascade, or null when it could not be resolved. */
  settings: EffectiveSettingsSnapshot | null;
  /** Why `settings` is null. Required when it is — "nothing applied" is not the same answer. */
  unresolved?: string | null;
}

/**
 * The read scope for one previewed run.
 *
 * Deliberately reports the working directory even when the settings resolution failed: the cwd is
 * the app's own choice and is knowable without reading anything, so an unresolved cascade narrows
 * what can be *claimed*, not what can be *listed*.
 */
export function buildReadScope(input: ReadScopeInput): ClaudeReadScope {
  const { projectRoot, cwd, targets, settings } = input;
  const sources = settings?.sources ?? [];
  const unresolved = settings ? null : (input.unresolved ?? "The settings files were not consulted.");

  const directories: ClaudeReadDirectory[] = [
    {
      path: cwd,
      origin: "cwd",
      tier: null,
      file: null,
      note: "The run's working directory. Everything under it can be read or searched without a prompt.",
    },
  ];

  const seen = new Set([path.resolve(cwd)]);

  // The app's own additions first, so the list reads outward from what the app chose before it
  // reaches what a settings file added.
  for (const extra of input.additional ?? []) {
    const resolved = path.resolve(cwd, extra.path);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    directories.push({ path: resolved, origin: "app", tier: null, file: null, note: extra.note });
  }

  // Then what the user granted during the session, so the two things the APP is responsible for
  // read first and the one thing the PERSON authorised reads next to them rather than buried under
  // whatever a settings file contributed.
  for (const grant of input.granted ?? []) {
    const resolved = path.resolve(cwd, grant.path);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    directories.push({ path: resolved, origin: "session", tier: null, file: null, note: grant.note });
  }

  for (const dir of settings?.effective.additionalDirectories ?? []) {
    const resolved = path.resolve(cwd, dir);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    const from = attribute(sources, (s) => s.permissions.additionalDirectories, dir);
    directories.push({
      path: resolved,
      origin: "settings",
      tier: from?.tier ?? null,
      file: from?.file ?? null,
      note: from
        ? `Added by ${tierLabel(from.tier)} — the app did not ask for this directory.`
        : "Added by the resolved settings; no file that was read claims it.",
    });
  }

  const readable = (target: string) => directories.some((d) => withinDirectory(d.path, target));
  const projectReadable = projectRoot !== "" && readable(projectRoot);
  const writesOutsideReadScope = targets.map((t) => t.path).filter((p) => !readable(p));

  const rules: ClaudePermissionRule[] = [];
  for (const list of ["deny", "ask", "allow"] as const) {
    // Deny first, then ask, then allow: if the list is capped, the entries that RESTRICT a run are
    // the ones worth keeping. An allow list truncated at 40 costs the user nothing they were not
    // already consenting to; a deny rule dropped off the end would be the one surprise here.
    for (const rule of settings?.effective[list] ?? []) {
      const from = attribute(sources, (s) => s.permissions[list], rule);
      rules.push({ list, rule, tier: from?.tier ?? null, file: from?.file ?? null });
    }
  }

  const mode = settings?.effective.defaultMode ?? null;

  return {
    directories,
    projectRoot,
    projectReadable,
    writesOutsideReadScope,
    summary: summarise({ projectRoot, cwd, directories, projectReadable, writesOutsideReadScope, unresolved }),
    rules: rules.slice(0, RULE_DISPLAY_CAP),
    rulesOmitted: Math.max(0, rules.length - RULE_DISPLAY_CAP),
    sources,
    defaultMode: mode
      ? {
          mode,
          tier:
            attribute(sources, (s) => (s.permissions.defaultMode ? [s.permissions.defaultMode] : []), mode)?.tier ??
            null,
        }
      : null,
    unresolved,
  };
}

/**
 * The sentence the dialog leads with.
 *
 * The case it exists for: a create-* run's working directory is the TARGET — a marketplace repo —
 * and not the open project. That is right for writing and backwards for exploring, and it is
 * invisible from a path list unless something says it out loud. So the summary always states the
 * relationship between the tree being read and the project the user is looking at, rather than
 * leaving them to diff two absolute paths in a modal.
 */
function summarise(args: {
  projectRoot: string;
  cwd: string;
  directories: ClaudeReadDirectory[];
  projectReadable: boolean;
  writesOutsideReadScope: string[];
  unresolved: string | null;
}): string {
  const { projectRoot, cwd, directories, projectReadable, writesOutsideReadScope, unresolved } = args;
  const fromApp = directories.filter((d) => d.origin === "app").length;
  const granted = directories.filter((d) => d.origin === "session").length;
  const extra = directories.filter((d) => d.origin === "settings").length;
  const parts: string[] = [];

  if (projectRoot && !withinDirectory(projectRoot, cwd)) {
    parts.push(
      projectReadable
        ? `This run reads ${cwd}, which is outside the open project — the project is readable too, but only because the settings added it.`
        : `This run reads ${cwd}, which is outside the open project. Nothing in ${projectRoot} is in scope: the run cannot see the repository you have open.`
    );
  } else if (projectRoot) {
    parts.push(`This run reads the open project at ${cwd}.`);
  } else {
    parts.push(`This run reads ${cwd}.`);
  }

  if (fromApp > 0) {
    parts.push(
      `The app also opened ${fromApp} ${fromApp === 1 ? "directory" : "directories"} for reading, listed below.`
    );
  }
  // Said in its own sentence, and said with "you": a grant the user cannot recognise as their own
  // is indistinguishable from the app having widened the scope on its own.
  if (granted > 0) {
    parts.push(
      `You granted ${granted} more ${granted === 1 ? "path" : "paths"} during this session; ${
        granted === 1 ? "it lasts" : "they last"
      } until the session ends and ${granted === 1 ? "is" : "are"} revocable here.`
    );
  }
  if (extra > 0) {
    parts.push(`${extra} further ${extra === 1 ? "directory was" : "directories were"} added by settings files.`);
  }
  if (writesOutsideReadScope.length > 0) {
    parts.push(
      `It may also write ${writesOutsideReadScope.length === 1 ? "a path" : "paths"} it cannot read: ${writesOutsideReadScope.join(", ")}.`
    );
  }
  if (unresolved) parts.push(`${unresolved} A settings file could widen this list.`);

  return parts.join(" ");
}
