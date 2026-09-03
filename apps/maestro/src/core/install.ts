// Installing Maestro's runtime half into a project, from the app.
//
// PORTED FROM plugins/maestro/scripts/maestro-install.js, and extended. The port keeps
// every behaviour of the original (orchestrator skill install/sync/migrate, refreshed runtime
// scripts, a merged settings.json, the `# Maestro` .gitignore section); a differential test in
// test/install.test.ts holds it to that. The extension is the point of the milestone:
//
//   THE PROJECT OWNS ITS RUNTIME. The plugin's hooks.json registers the session hooks from
//   ${CLAUDE_PLUGIN_ROOT}, which resolves into the marketplace cache — a copy keyed by
//   plugin.json's version, so any edit to hooks/ or scripts/ that ships without a version bump
//   is invisible to every installed project. Registering the same hooks in the PROJECT's own
//   .claude/settings.json, pointing at $CLAUDE_PROJECT_DIR/.claude/scripts/, makes "update this
//   project's runtime" a file copy the app can do and the user can see.
//
//   What the registrations this file writes then MEAN to the plugin's own copy of the same hooks
//   is hook-arbitration.ts: the plugin's copy stands down for any hook the project registers here,
//   so both being installed is a precedence rule and not the double-firing it used to be.
//
// Three rules this file exists to enforce:
//
//   1. PROJECT-LOCAL, NEVER GLOBAL. Every path written is under `projectRoot`, and the user's
//      ~/.claude is never written — an installer that registered hooks globally would silently
//      change every other repo on the machine.
//   2. MERGE, NEVER CLOBBER. settings.json is a file users hand-edit. Unknown keys, unrelated
//      hooks and other matchers survive; an unparseable file aborts the install instead of being
//      replaced with `{}` (which is what the legacy script did, losing the user's content).
//   3. IDEMPOTENT. A second run adds no hook entry and rewrites no identical file. The presence
//      test keys on the script's basename inside the command string, so a user who re-quoted the
//      command by hand doesn't get a duplicate.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { syncManagedRegions } from "./skill-regions.js";
import { orchestratorSkillPath } from "./render.js";
import { maestroJsonPath, readConfig, readJsonSafe, writeConfig, writeRuntimeVersion } from "./config.js";
import { syncProjectReports } from "./report-sync.js";
import { detectImplAgents } from "./detect.js";
import { discoverSkills } from "./discovery.js";
import { readAllSkillTags, skillMapFromTags, type AgentAttrs } from "./skill-tags.js";
import { defaultV3Config, seededAgentNames } from "./seed.js";
import { settingsRegisterScript, type Settings } from "./hook-arbitration.js";
import { readAllProjectTags, DEFAULT_PROJECT_TAGS_DB_PATH } from "./project-tags.js";
import { readAllAgentTypes } from "./agent-types.js";
import { readAllAgentProjectTags } from "./agent-project-tags.js";
import { GLOBAL_TAG } from "./contracts.js";
import type { MaestroConfigV3 } from "./types.js";
import type { InstallReport, InstallStatus, OrchestratorSkillAction } from "./contracts.js";

export type { InstallReport, InstallStatus, OrchestratorSkillAction };

// ── locating what the app ships ────────────────────────────────────────────

/** Where the runtime files live, relative to whichever repo root we find. */
const PLUGIN_REL = path.join("plugins", "maestro");

/**
 * Walk up from `start` looking for the plugin directory that holds the runtime files.
 *
 * Same reasoning as `findUpBundledAgents` in ./discovery.ts: this module runs from
 * `apps/maestro/src/core/` under vitest and from `apps/maestro/out/main/index.js` once
 * electron-vite has bundled it, which are different depths — a fixed `../../..` silently resolves
 * to the wrong place. Exported so a test can drive it from an arbitrary depth.
 */
export function findUpPluginRoot(start: string): string | null {
  let dir = start;
  for (;;) {
    const candidate = path.join(dir, PLUGIN_REL);
    if (fs.existsSync(path.join(candidate, "templates", "maestro", "SKILL.md"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The runtime files the app installs. Found by walking up to the monorepo root when running from
 * source or from a dev/build bundle; a packaged build ships the plugin inside its resources
 * directory, outside any such tree, and sets MAESTRO_PLUGIN_ROOT instead. Env-driven rather than
 * reading Electron's `process.resourcesPath`, so src/core stays free of Electron.
 */
export function defaultPluginRoot(): string | null {
  const fromEnv = process.env.MAESTRO_PLUGIN_ROOT;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  return findUpPluginRoot(import.meta.dirname);
}

export function requirePluginRoot(pluginRoot?: string): string {
  const root = pluginRoot ?? defaultPluginRoot();
  if (!root) {
    throw new Error(
      "Cannot find the Maestro runtime files the app ships (plugins/maestro). " +
        "Set MAESTRO_PLUGIN_ROOT to that directory and retry."
    );
  }
  return root;
}

/**
 * The plugin.json `version` the app currently ships — what a fresh install or a refresh stamps
 * into a project's `maestro.json` as `runtimeVersion`. The single source both delivery paths
 * compare against: this function for the app, and `maestro-check-runtime.cjs`'s read of
 * `~/.claude/plugins/installed_plugins.json` for a bare terminal session (which has no access to
 * this repo's checkout — it reads the version the marketplace cache actually installed instead).
 */
export function shippedRuntimeVersion(pluginRoot?: string): string {
  const root = requirePluginRoot(pluginRoot);
  const manifestPath = path.join(root, ".claude-plugin", "plugin.json");
  const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { version?: string };
  if (!parsed.version) throw new Error(`${manifestPath} has no "version" field.`);
  return parsed.version;
}

// ── the manifest ───────────────────────────────────────────────────────────

export interface RuntimeAsset {
  /** Path under the plugin root, with `/` separators. */
  src: string;
  /** Destination path under the project root, with `/` separators. */
  dest: string;
  /** Copied with the executable bit, so a hook can run it directly. */
  executable?: boolean;
}

/**
 * The hook scripts the plugin runs as `.js`, copied into the project as `.cjs`.
 *
 * They keep their `.js` name in the plugin because that directory has no package.json declaring a
 * module type. Inside a project the same file sits under a package.json that may say
 * `"type": "module"`, which would make node parse their `require()` as ESM and fail the hook on
 * every tool call. The plugin's own `.cjs` scripts are copied under their existing names.
 */
const HOOK_SCRIPTS = [
  "maestro-inject-agent-context",
  "maestro-subagent-log",
  "maestro-session-log",
  "maestro-validate-tasks",
] as const;

const STATIC_ASSETS: RuntimeAsset[] = [
  // Invoked by the orchestrator skill / the app, not by a hook.
  { src: "scripts/maestro-set-session-workflow.cjs", dest: ".claude/scripts/maestro-set-session-workflow.cjs" },
  { src: "scripts/maestro-render-orchestrator.cjs", dest: ".claude/scripts/maestro-render-orchestrator.cjs" },
  { src: "scripts/maestro-task-status.cjs", dest: ".claude/scripts/maestro-task-status.cjs" },
  // Step 0's cheap staleness check — see maestro-architecture / task 027. Invoked directly by the
  // orchestrator, not registered as a hook.
  { src: "scripts/maestro-check-runtime.cjs", dest: ".claude/scripts/maestro-check-runtime.cjs" },
  // Forked-agent sync (`031`) — list / diff / update / keep / detach, driven by the `maestro` and
  // `maestro-update` skills. Copied into the project rather than left at ${CLAUDE_PLUGIN_ROOT} for
  // the same reason every other orchestrator-invoked script is: the orchestrator calls it by
  // $CLAUDE_PROJECT_DIR path, and a project-local copy is refreshable without a version bump.
  { src: "scripts/maestro-agent-forks.cjs", dest: ".claude/scripts/maestro-agent-forks.cjs" },
  // Shared libs every copied script requires via `./lib/…`.
  { src: "scripts/lib/maestro-session.cjs", dest: ".claude/scripts/lib/maestro-session.cjs" },
  { src: "scripts/lib/maestro-tasks.cjs", dest: ".claude/scripts/lib/maestro-tasks.cjs" },
  { src: "scripts/lib/maestro-skill-regions.cjs", dest: ".claude/scripts/lib/maestro-skill-regions.cjs" },
  { src: "scripts/lib/maestro-agent-sync.cjs", dest: ".claude/scripts/lib/maestro-agent-sync.cjs" },
  // PreToolUse Bash guard that blocks reading .env secrets. Runs as a bare command, hence +x.
  { src: "scripts/bash-validation.sh", dest: ".claude/scripts/bash-validation.sh", executable: true },
  // SessionEnd cleanup. NOT the plugin's maestro-session-cleanup.sh, which does the same three
  // deletions and nothing more (its container teardown went with M5) — the twin is node because
  // the .sh parses the hook payload with python3, which a project cannot assume is installed.
  // It is also the one hook with no arbitration guard: both copies `rm -f` the same three files,
  // so a double fire is unobservable and a bash reimplementation of hook-arbitration.ts to
  // suppress a no-op would cost more than it saves.
  { src: "scripts/maestro-session-cleanup.cjs", dest: ".claude/scripts/maestro-session-cleanup.cjs" },
  ...HOOK_SCRIPTS.map((name) => ({
    src: `scripts/${name}.js`,
    dest: `.claude/scripts/${name}.cjs`,
  })),
];

/**
 * Handoff-protocol templates, installed to `.claude/templates/handoffs/`.
 *
 * `maestro-inject-agent-context` looks for `<project>/.claude/handoffs/<sender>/<receiver>.md`
 * first and falls back to `<script dir>/../templates/handoffs/…`. From the copied script that
 * second path is exactly `.claude/templates/handoffs/`, so installing there needs no change to
 * the script AND leaves `.claude/handoffs/` free as the user's override — copying into the
 * override location would overwrite a customised protocol on every update.
 */
function handoffAssets(pluginRoot: string): RuntimeAsset[] {
  const base = path.join(pluginRoot, "templates", "handoffs");
  if (!fs.existsSync(base)) return [];
  const out: RuntimeAsset[] = [];
  const walk = (rel: string) => {
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

/** Every file the app copies into a project, in a stable order. */
export function runtimeAssets(pluginRoot?: string): RuntimeAsset[] {
  return [...STATIC_ASSETS, ...handoffAssets(requirePluginRoot(pluginRoot))];
}

// ── the hooks ──────────────────────────────────────────────────────────────

export type HookEvent = "SubagentStart" | "SubagentStop" | "PreToolUse" | "PostToolUse" | "SessionEnd";

export interface HookRegistration {
  event: HookEvent;
  /** Claude Code's tool/agent matcher. Mirrors plugins/maestro/hooks/hooks.json. */
  matcher: string;
  /** Basename of the target script — the idempotency key, and what the UI lists. */
  script: string;
  /** Exact `command` string written into settings.json. */
  command: string;
  /** `<Event>:<script>`; unique because one script is registered on two events. */
  id: string;
}

const SCRIPTS_VAR = "$CLAUDE_PROJECT_DIR/.claude/scripts";

/**
 * The bash-validation command string, byte-for-byte as the legacy installer wrote it.
 *
 * Unquoted and un-prefixed on purpose: maestro-uninstall.js removes it by exact string match, and
 * projects installed by the old skill already carry this exact value. Re-quoting it here would
 * duplicate the entry on those projects and orphan it on uninstall.
 */
const BASH_VALIDATION_COMMAND = `${SCRIPTS_VAR}/bash-validation.sh`;

function nodeHook(event: HookEvent, matcher: string, script: string): HookRegistration {
  return { event, matcher, script, command: `node "${SCRIPTS_VAR}/${script}"`, id: `${event}:${script}` };
}

/**
 * What the app registers in the project's `.claude/settings.json`.
 *
 * Mirrors the plugin's hooks.json one-for-one. It used to be "minus two": a SessionStart that
 * refcounted live sessions against the per-project web-app container, and the four
 * UserPromptExpansion entries that launched that container for the `create-*` commands. M5 deleted
 * both from the plugin, so there is no longer any divergence to explain — if this list and
 * hooks.json ever differ again, that is a bug in one of them.
 *
 * SubagentStop IS included even though the plan lists only four events — without it the session log
 * has dispatch entries with no matching handoff, and /session-log renders half a conversation.
 */
export const HOOK_REGISTRATIONS: HookRegistration[] = [
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

// Re-exported for uninstall.ts, which is this file's mirror: it has to read the same settings.json
// with the same tolerance for keys neither module wrote.
export type { HookCommand, HookEntry, Settings } from "./hook-arbitration.js";

/**
 * Is this registration already in `settings`?
 *
 * `settingsRegisterScript` is shared with the runtime guard in hook-arbitration.ts on purpose: the
 * installer uses it so a re-quoted command doesn't get a duplicate entry that fires the hook twice,
 * and the plugin's copy of a hook uses the same test to decide the project owns that hook and stand
 * down. Two answers to "is this script registered here?" that could disagree would put those two
 * mechanisms at odds.
 */
function hasHook(settings: Settings, reg: HookRegistration): boolean {
  return settingsRegisterScript(settings, reg.event, reg.script);
}

/** Add every missing registration to `settings` in place. Returns the ids added. */
function addMissingHooks(settings: Settings, regs: HookRegistration[] = HOOK_REGISTRATIONS): string[] {
  const added: string[] = [];
  for (const reg of regs) {
    if (hasHook(settings, reg)) continue;
    settings.hooks ??= {};
    const list = (settings.hooks[reg.event] ??= []);
    // Reuse an existing entry for the same matcher rather than adding a second one, so a user's
    // own Bash hook and ours live side by side under one matcher — as the legacy installer did.
    let entry = list.find((e) => e && e.matcher === reg.matcher && Array.isArray(e.hooks));
    if (!entry) {
      entry = { matcher: reg.matcher, hooks: [] };
      list.push(entry);
    }
    entry.hooks!.push({ type: "command", command: reg.command });
    added.push(reg.id);
  }
  return added;
}

export function settingsPathFor(projectRoot: string): string {
  return path.join(projectRoot, ".claude", "settings.json");
}

/**
 * Read the project's settings, or throw.
 *
 * The legacy installer swallowed a parse error and continued with `{}`, which then overwrote the
 * user's whole settings file with just our hook. A settings.json that doesn't parse is a mistake
 * the user has to see, and the only safe response is to write nothing.
 */
export function readSettings(settingsPath: string): Settings {
  if (!fs.existsSync(settingsPath)) return {};
  const raw = fs.readFileSync(settingsPath, "utf8");
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as Settings;
  } catch {
    throw new Error(
      `${settingsPath} is not valid JSON, so installing would overwrite it. ` +
        "Fix or move that file, then run the install again. Nothing has been written."
    );
  }
}

/** Write JSON where a crash mid-write cannot leave a truncated file behind. */
export function writeJsonAtomic(target: string, value: unknown): void {
  ensureDir(path.dirname(target));
  const tmp = `${target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, target);
}

// ── the pieces of an install ───────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function projectPath(projectRoot: string, dest: string): string {
  return path.join(projectRoot, ...dest.split("/"));
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Install / refresh the orchestrator skill. Unchanged from the legacy script:
 *   absent            → the template, copied whole
 *   has the markers   → plugin-owned regions re-synced, the rendered HANDOFFS body preserved
 *   predates them     → backed up to SKILL.md.bak and replaced (nothing can locate the regions)
 */
export function installOrchestratorSkill(
  templatePath: string,
  destPath: string
): { action: OrchestratorSkillAction; regions: string[]; backup: string | null } {
  const template = fs.readFileSync(templatePath, "utf8");
  ensureDir(path.dirname(destPath));
  if (!fs.existsSync(destPath)) {
    fs.writeFileSync(destPath, template);
    return { action: "installed", regions: [], backup: null };
  }

  const installed = fs.readFileSync(destPath, "utf8");
  const { text, synced, missing } = syncManagedRegions(installed, template);

  if (missing.length > 0) {
    const backup = `${destPath}.bak`;
    fs.writeFileSync(backup, installed);
    fs.writeFileSync(destPath, template);
    return { action: "migrated", regions: [], backup };
  }

  if (text === installed) return { action: "unchanged", regions: [], backup: null };
  fs.writeFileSync(destPath, text);
  return { action: "synced", regions: synced, backup: null };
}

const GITIGNORE_HEADER = "# Maestro ephemeral session state — recreated each session, removed at SessionEnd";

const GITIGNORE_ENTRIES = [
  "**/.claude/maestro_session.json",
  "**/.claude/maestro_session.log.jsonl",
  "**/.claude/maestro_session_tasks.json",
];

/** Append the missing entries under the Maestro header. Returns true if the file changed. */
function appendGitignoreEntries(gitignorePath: string, entries: string[]): boolean {
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

/** The git toplevel for `startDir`, or null when it isn't a repo. */
export function findRepoRoot(startDir: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: startDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Belt-and-suspenders for monorepos: ignore EVERY nested .claude session file across the tree
 * from the repo-root .gitignore. Each entry starts with a recursive-wildcard segment, so it
 * matches .claude/ at any depth (including the root) and a session log left behind in any
 * package is covered without a per-package .gitignore.
 */
function ensureRepoRootGitignore(repoRoot: string | null): boolean {
  if (!repoRoot) return false;
  return appendGitignoreEntries(path.join(repoRoot, ".gitignore"), GITIGNORE_ENTRIES);
}

// ── status ─────────────────────────────────────────────────────────────────

/**
 * Digest of a set of runtime files, by content.
 *
 * `read` returns the bytes on one side (what the app ships) or null for a file the project is
 * missing, so an incomplete install can never hash equal to a complete one. Order comes from the
 * manifest, and each entry mixes in its destination path, so moving a file changes the id.
 */
function runtimeDigest(assets: RuntimeAsset[], read: (a: RuntimeAsset) => Buffer | null): string {
  const h = createHash("sha256");
  for (const asset of assets) {
    const bytes = read(asset);
    h.update(asset.dest)
      .update("\0")
      .update(bytes ? sha256(bytes) : "absent")
      .update("\n");
  }
  // Hook registration is part of the runtime's identity: adding a hook to HOOK_REGISTRATIONS
  // without touching a script still makes every installed project out of date.
  for (const reg of HOOK_REGISTRATIONS) h.update(reg.id).update("\0").update(reg.command).update("\n");
  return h.digest("hex").slice(0, 12);
}

export async function installStatus(projectRoot: string, pluginRoot?: string): Promise<InstallStatus> {
  const root = requirePluginRoot(pluginRoot);
  const assets = runtimeAssets(root);

  const scriptsMissing: string[] = [];
  const scriptsOutOfDate: string[] = [];
  for (const asset of assets) {
    const dest = projectPath(projectRoot, asset.dest);
    if (!fs.existsSync(dest)) {
      scriptsMissing.push(asset.dest);
      continue;
    }
    if (sha256(fs.readFileSync(dest)) !== sha256(fs.readFileSync(path.join(root, ...asset.src.split("/"))))) {
      scriptsOutOfDate.push(asset.dest);
    }
  }

  const skillPath = orchestratorSkillPath(projectRoot);
  const hasSkill = fs.existsSync(skillPath);
  let skillOutOfDate = false;
  if (hasSkill) {
    const installed = fs.readFileSync(skillPath, "utf8");
    const template = fs.readFileSync(path.join(root, "templates", "maestro", "SKILL.md"), "utf8");
    const sync = syncManagedRegions(installed, template);
    // A pre-managed-regions install (missing markers) is out of date too — installing migrates it.
    skillOutOfDate = sync.missing.length > 0 || sync.text !== installed;
  }

  const settingsPath = settingsPathFor(projectRoot);
  let settings: Settings = {};
  let settingsUnreadable = false;
  try {
    settings = readSettings(settingsPath);
  } catch {
    settingsUnreadable = true;
  }
  const hooksRegistered: string[] = [];
  const hooksMissing: string[] = [];
  for (const reg of HOOK_REGISTRATIONS) {
    (settingsUnreadable || !hasHook(settings, reg) ? hooksMissing : hooksRegistered).push(reg.id);
  }

  const scriptsDir = fs.existsSync(path.join(projectRoot, ".claude", "scripts"));
  const installed = hasSkill && scriptsDir;
  const stale =
    installed &&
    (scriptsMissing.length > 0 || scriptsOutOfDate.length > 0 || hooksMissing.length > 0 || skillOutOfDate);

  return {
    projectRoot,
    installed,
    orchestratorSkill: hasSkill,
    scriptsDir,
    configFile: fs.existsSync(maestroJsonPath(projectRoot)),
    orchestratorSkillOutOfDate: skillOutOfDate,
    scriptsMissing,
    scriptsOutOfDate,
    hooksRegistered,
    hooksMissing,
    shippedRuntimeId: runtimeDigest(assets, (a) => fs.readFileSync(path.join(root, ...a.src.split("/")))),
    installedRuntimeId: runtimeDigest(assets, (a) => {
      const dest = projectPath(projectRoot, a.dest);
      return fs.existsSync(dest) ? fs.readFileSync(dest) : null;
    }),
    stale,
    settingsUnreadable,
  };
}

// ── install ────────────────────────────────────────────────────────────────

/**
 * Install or update Maestro's runtime in `projectRoot`. Idempotent.
 *
 * Ordering is deliberate. Everything that can refuse — a missing plugin root, an unparseable
 * settings.json — is checked BEFORE the first byte is written, so a rejected install leaves the
 * project exactly as it was and the user can fix the cause and press the button again. Past that
 * point every step is a copy or an append that re-running completes.
 *
 * `reportsDbPath` overrides the global report-defaults store the report sync step reads —
 * exposed only so tests don't touch the real machine's `~/.claude/maestro-report-defaults.sqlite`
 * (mirrors `skill-tags.ts`'s tests taking an explicit `dbPath`); every real caller omits it.
 * `projectTagsDbPath` is the same test-isolation escape hatch for the first-install seed's read of
 * the global Project Tags catalog, below.
 */
export async function installRuntime(
  projectRoot: string,
  pluginRoot?: string,
  reportsDbPath?: string,
  projectTagsDbPath?: string
): Promise<InstallReport> {
  if (!projectRoot) throw new Error("No project is open.");
  if (!fs.existsSync(projectRoot)) throw new Error(`${projectRoot} does not exist.`);
  const root = requirePluginRoot(pluginRoot);

  // Preflight: parse settings.json before writing anything. Throws with a message the UI shows.
  const settingsPath = settingsPathFor(projectRoot);
  const settings = readSettings(settingsPath);

  const assets = runtimeAssets(root);

  const orchestratorSkill = installOrchestratorSkill(
    path.join(root, "templates", "maestro", "SKILL.md"),
    orchestratorSkillPath(projectRoot)
  );

  // Copy only what differs. "Always refreshed" in the legacy script meant an unconditional
  // copyFileSync; comparing first is what lets a second run report nothing left to do.
  const scriptsWritten: string[] = [];
  for (const asset of assets) {
    const from = path.join(root, ...asset.src.split("/"));
    const to = projectPath(projectRoot, asset.dest);
    const source = fs.readFileSync(from);
    if (fs.existsSync(to) && sha256(fs.readFileSync(to)) === sha256(source)) continue;
    ensureDir(path.dirname(to));
    fs.writeFileSync(to, source);
    if (asset.executable) fs.chmodSync(to, 0o755);
    scriptsWritten.push(asset.dest);
  }
  // The scripts dir exists even when every file was already current, so status can rely on it.
  ensureDir(path.join(projectRoot, ".claude", "scripts"));

  const hooksAdded = addMissingHooks(settings);
  if (hooksAdded.length > 0) writeJsonAtomic(settingsPath, settings);

  const gitignoreUpdated = ensureRepoRootGitignore(findRepoRoot(projectRoot));

  // First install only: no maestro.json yet, so seed one right here instead of waiting for
  // /workflows' first Save — bringing the app in line with what the terminal `/maestro-install`
  // path already does today. An existing config, including its own `project_tags`, is the user's
  // own and is never touched by a re-install — same discipline as `runtimeVersion` and every other
  // field this function otherwise leaves alone. This is the same computation `main/ipc.ts`'s
  // `workflowsData` handler already does inline for the `/workflows` bootstrap fallback (kept,
  // unchanged, as the safety net for a project that somehow reaches `/workflows` with no config
  // and no install) — intentionally similar, not shared, per this module's own "PORTED" convention.
  let configSeeded: InstallReport["configSeeded"] = null;
  if (readConfig(projectRoot) === null) {
    const detection = detectImplAgents(projectRoot);
    const skills = await discoverSkills(projectRoot);
    const types = readAllAgentTypes();
    const projectTagsByAgent = readAllAgentProjectTags();
    const agentAttrs: Record<string, AgentAttrs> = {};
    for (const name of seededAgentNames(detection.implAgents)) {
      agentAttrs[name] = { type: types[name] ?? "developer", projectTag: projectTagsByAgent[name] ?? GLOBAL_TAG };
    }
    const skillMap = skillMapFromTags(
      readAllSkillTags(),
      skills.map((s) => s.id),
      agentAttrs
    );
    const catalog = readAllProjectTags(projectTagsDbPath ?? DEFAULT_PROJECT_TAGS_DB_PATH);
    const projectTags = detection.implAgents.filter((t) => catalog.includes(t));
    const seeded: MaestroConfigV3 = { ...defaultV3Config(detection.implAgents, skillMap), project_tags: projectTags };
    writeConfig(projectRoot, seeded);
    configSeeded = { implAgents: detection.implAgents, projectTags };
  }

  // Stamp last, after the files it describes are actually current on disk. The seed step above
  // guarantees maestro.json exists by this point on a first install, so this always finds one to
  // stamp now.
  const runtimeVersion = shippedRuntimeVersion(root);
  const runtimeVersionUpdated = writeRuntimeVersion(projectRoot, runtimeVersion);

  // Sync project reports from the global default tier — after maestro.json is guaranteed to
  // exist in whatever form it's going to (stamped runtimeVersion above), so a reports slice
  // written here isn't immediately clobbered by writeRuntimeVersion's own read-modify-write.
  const reportsSync = syncProjectReports(projectRoot, reportsDbPath);

  const status = await installStatus(projectRoot, root);

  const warnings: string[] = [];
  if (orchestratorSkill.action === "migrated") {
    warnings.push(
      `The orchestrator skill predates Maestro's managed regions, so it was replaced. Your previous version is at ${orchestratorSkill.backup} — copy any custom prose back across.`
    );
  }

  return {
    projectRoot,
    orchestratorSkill,
    scriptsWritten,
    hooksAdded,
    gitignoreUpdated,
    runtimeVersion,
    runtimeVersionUpdated,
    configSeeded,
    unchanged:
      orchestratorSkill.action === "unchanged" &&
      scriptsWritten.length === 0 &&
      hooksAdded.length === 0 &&
      !gitignoreUpdated &&
      !runtimeVersionUpdated &&
      configSeeded === null &&
      reportsSync.materialized.length === 0 &&
      reportsSync.refreshed.length === 0,
    warnings,
    status,
    reportsSync,
  };
}

/**
 * Refresh an ALREADY-installed project's runtime iff its stamped `runtimeVersion` doesn't match
 * what the plugin currently ships — the cheap trigger task 027 exists to add, decoupled from the
 * content-hash comparison `installStatus()` does. A project already current costs one config read
 * and a version-string compare: zero file reads of the runtime assets themselves, zero writes.
 *
 * Deliberately never installs FRESH: a project with no runtime at all (or none of it, or an
 * authored graph but no runtime) is what the install button is for. Auto-triggering that from
 * project selection would install Maestro into every repo a user happens to open in the app,
 * which is not what "close the staleness gap" asked for — only refreshing an existing install is.
 */
export async function refreshStaleRuntime(
  projectRoot: string,
  pluginRoot?: string,
  reportsDbPath?: string
): Promise<InstallReport | null> {
  const root = requirePluginRoot(pluginRoot);
  // A raw parse, not readConfig()'s blank-on-corrupt fallback: this trigger fires on every project
  // SELECTION, not an explicit user action, so it must never treat "the file is corrupt" the same
  // as "the file is a legitimately empty v3 config" — the former getting silently rewritten to the
  // latter just because the project was opened would violate "the workflow graph is untouched by a
  // refresh" far more than the field it's here to add.
  const parsed = readJsonSafe<MaestroConfigV3>(maestroJsonPath(projectRoot));
  if (!parsed || parsed.version !== 3) return null;
  const cfg = parsed;
  const shipped = shippedRuntimeVersion(root);
  if (cfg.runtimeVersion === shipped) return null;
  const status = await installStatus(projectRoot, root);
  if (!status.installed) return null;
  return installRuntime(projectRoot, root, reportsDbPath);
}
