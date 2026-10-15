// Which skills a project can actually invoke — the one place Maestro asks.
//
// Maestro's seeds and defaults used to name skills that shipped inside its own plugin, so a skill
// id in `maestro.json` always resolved. The design-check skills now come from an opt-in plugin, so
// an id can dangle: the plugin is not installed, or not enabled for this project, or the project
// never had the skill. Two things need the answer, and they must agree:
//
//   - the SEED (`defaultV3Config`) names an optional skill only when it is available, so a fresh
//     config never starts life with a dangling reference;
//   - `maestro-stale-refs.cjs` (run by `/maestro-update`) reports the references that already
//     dangle in an existing config, and suggests the fix.
//
// Synchronous, `fs`-only and free of workspace imports, so it bundles to a plain CJS lib
// (plugins/maestro/scripts/lib/maestro-skill-availability.cjs) the standalone scripts `require`.
// Never throws: an unreadable file is "nothing known", and a caller must treat that as
// "unavailable" rather than as a failure.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { walkProjectSkillIds } from "./skill-resolve.js";
import type { UnavailableReason, DanglingSkillRef, SkillRefReport } from "./contracts.js";

/** Everything availability is decided from. Built once per question by `readSkillSources`. */
export interface SkillSources {
  /** Bare ids of the project's own skills, from every `.claude/skills` in the tree. */
  projectSkillIds: string[];
  /** Bare ids under `~/.claude/skills`. */
  userSkillIds: string[];
  /** Names (before the `@marketplace`) of plugins switched on in the project or user settings. */
  enabledPlugins: string[];
  /** Skill ids each INSTALLED plugin ships, by plugin name. Enabled or not. */
  installedPluginSkills: Record<string, string[]>;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pluginName(key: string): string {
  const at = key.lastIndexOf("@");
  return at === -1 ? key : key.slice(0, at);
}

function skillDirIds(skillsDir: string): string[] {
  try {
    return fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && fs.existsSync(path.join(skillsDir, e.name, "SKILL.md")))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Plugins whose `enabledPlugins` value is `true` in the project's `settings.json` /
 * `settings.local.json` or the user's `settings.json`. A later file overrides an earlier one, so a
 * project can switch off what the user switched on.
 */
export function readEnabledPlugins(projectRoot: string, homeDir: string = os.homedir()): string[] {
  const state = new Map<string, boolean>();
  const files = [
    path.join(homeDir, ".claude", "settings.json"),
    path.join(projectRoot, ".claude", "settings.json"),
    path.join(projectRoot, ".claude", "settings.local.json"),
  ];
  for (const file of files) {
    const json = readJson(file);
    if (!isObject(json) || !isObject(json.enabledPlugins)) continue;
    for (const [key, value] of Object.entries(json.enabledPlugins)) state.set(pluginName(key), value === true);
  }
  return Array.from(state, ([name, on]) => (on ? name : "")).filter(Boolean);
}

function readInstalledPluginSkills(homeDir: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const json = readJson(path.join(homeDir, ".claude", "plugins", "installed_plugins.json"));
  if (!isObject(json) || !isObject(json.plugins)) return out;
  for (const [key, installs] of Object.entries(json.plugins)) {
    if (!Array.isArray(installs)) continue;
    const name = pluginName(key);
    for (const install of installs) {
      if (!isObject(install) || typeof install.installPath !== "string") continue;
      out[name] = Array.from(new Set([...(out[name] ?? []), ...skillDirIds(path.join(install.installPath, "skills"))]));
    }
  }
  return out;
}

/** Read every source. `homeDir` is a parameter so a test can point it at a scratch directory. */
export function readSkillSources(projectRoot: string, homeDir: string = os.homedir()): SkillSources {
  return {
    projectSkillIds: walkProjectSkillIds(projectRoot).map((e) => e.id),
    userSkillIds: skillDirIds(path.join(homeDir, ".claude", "skills")),
    enabledPlugins: readEnabledPlugins(projectRoot, homeDir),
    installedPluginSkills: readInstalledPluginSkills(homeDir),
  };
}

export type { UnavailableReason };

/**
 * `null` when `id` resolves, otherwise why not.
 *
 *  - `plugin:skill` resolves when that plugin is enabled and ships the skill. When the installed
 *    plugin list is unreadable the plugin being enabled is taken as enough — better a missed
 *    warning than a false one.
 *  - a bare id resolves as a project or user skill, or as a skill of any installed plugin (Claude
 *    Code resolves an unambiguous bare plugin skill name).
 */
export function whyUnavailable(sources: SkillSources, id: string): UnavailableReason | null {
  const colon = id.indexOf(":");
  if (colon > 0) {
    const plugin = id.slice(0, colon);
    const skill = id.slice(colon + 1);
    const shipped = sources.installedPluginSkills[plugin];
    const enabled = sources.enabledPlugins.includes(plugin);
    if (!shipped && !enabled) return "plugin-not-installed";
    if (!enabled) return "plugin-not-enabled";
    if (shipped && !shipped.includes(skill)) return "skill-not-in-plugin";
    return null;
  }
  if (sources.projectSkillIds.includes(id) || sources.userSkillIds.includes(id)) return null;
  if (Object.values(sources.installedPluginSkills).some((skills) => skills.includes(id))) return null;
  return "not-found";
}

/** The first candidate that resolves, or null. Order is preference. */
export function firstAvailableSkill(sources: SkillSources, candidates: string[]): string | null {
  return candidates.find((id) => whyUnavailable(sources, id) === null) ?? null;
}

// ---------------------------------------------------------------------------
// Optional skills the seed can name
// ---------------------------------------------------------------------------

/**
 * Optional skills a fresh seed names when — and only when — the project can invoke them. Each value
 * is the plugin-namespaced id to write; absent when it does not resolve.
 */
export interface SeedSkills {
  /** The design check the Refactor workflow leads with and `/to-maestro-tasks` runs at its start. */
  designCheck?: string;
}

/** Preference order, first available wins. */
const DESIGN_CHECK_CANDIDATES = ["code-graph:use-code-architecture-design-check"];

/** Resolve the optional seed skills against what `projectRoot` can actually invoke. */
export function seedSkillsFor(projectRoot: string, homeDir?: string): SeedSkills {
  if (!projectRoot) return {};
  const found = firstAvailableSkill(readSkillSources(projectRoot, homeDir), DESIGN_CHECK_CANDIDATES);
  return found ? { designCheck: found } : {};
}

// ---------------------------------------------------------------------------
// Dangling references in an existing config
// ---------------------------------------------------------------------------

export type { DanglingSkillRef };
export type StaleRefsReport = SkillRefReport;

function strings(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim())
    : [];
}

/** Every skill id `cfg` references, with where. Tolerates any shape: it is fed `JSON.parse` output. */
export function collectSkillRefs(cfg: unknown): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  const add = (id: string, where: string) => refs.set(id, [...(refs.get(id) ?? []), where]);
  if (!isObject(cfg)) return refs;

  for (const id of strings(cfg.skills_available)) add(id, "skills_available");
  if (Array.isArray(cfg.workflow_instances)) {
    for (const inst of cfg.workflow_instances) {
      if (!isObject(inst)) continue;
      const name = typeof inst.name === "string" ? inst.name : "?";
      for (const id of strings(inst.loaded_skills)) add(id, `instance ${name} loaded_skills`);
      for (const id of strings(inst.referenced_skills)) add(id, `instance ${name} referenced_skills`);
    }
  }
  if (isObject(cfg.start_skills)) {
    for (const id of strings(cfg.start_skills.maestro)) add(id, "start_skills.maestro");
    for (const id of strings(cfg.start_skills.to_maestro_tasks)) add(id, "start_skills.to_maestro_tasks");
  }
  if (isObject(cfg.end_skills)) {
    for (const id of strings(cfg.end_skills.maestro)) add(id, "end_skills.maestro");
  }
  if (Array.isArray(cfg.workflows)) {
    for (const wf of cfg.workflows) {
      if (!isObject(wf) || !Array.isArray(wf.nodes)) continue;
      const wfName = typeof wf.name === "string" ? wf.name : "?";
      for (const node of wf.nodes) {
        if (isObject(node) && node.type === "skill" && typeof node.skill === "string" && node.skill) {
          add(node.skill, `workflow ${wfName} skill node`);
        }
      }
    }
  }
  return refs;
}

/**
 * A project that keeps a concept-skill list but cannot use the plugin that maintains it:
 *  - a root `scribe.config.json` is a code-graph project; suggest enabling the plugin if it is off.
 *  - the legacy `.claude/concept-skills.json` with code-graph off suggests migrating to code-graph
 *    (installed from its own marketplace, not maestro's).
 */
function pluginSuggestions(projectRoot: string, sources: SkillSources): string[] {
  const codeGraphOn = sources.enabledPlugins.includes("code-graph");
  const out: string[] = [];
  if (!codeGraphOn && isObject(readJson(path.join(projectRoot, "scribe.config.json")))) {
    out.push(
      "This project has a scribe.config.json (a code-graph project) but the code-graph plugin is not enabled. " +
        "Install it from the code-graph marketplace and enable it for this project."
    );
  }
  if (!codeGraphOn && isObject(readJson(path.join(projectRoot, ".claude", "concept-skills.json")))) {
    out.push(
      "This project keeps a concept-skill list (.claude/concept-skills.json) but the code-graph plugin is not enabled. " +
        "Install code-graph from its own marketplace (it is not in Maestro's), then migrate via /code-graph-install."
    );
  }
  return out;
}

/**
 * An authored config (it has workflows) with no `start_skills` was upgraded by copying files alone:
 * nothing reads the old `gates`, so Step 1 silently runs no skills. A re-install writes the defaults.
 * An empty or blank config is not "upgraded", so it is not flagged.
 */
function missingListsSuggestions(cfg: unknown): string[] {
  if (!isObject(cfg) || !Array.isArray(cfg.workflows) || cfg.workflows.length === 0) return [];
  if (isObject(cfg.start_skills)) return [];
  return [
    "This project's maestro.json has no start_skills, so /maestro and /to-maestro-tasks run no start skills. " +
      "Re-install Maestro (/maestro-install, or Update on the app's /maestro page) to write the defaults, then adjust them on the /maestro page.",
  ];
}

/**
 * Report skill ids in `cfg` that do not resolve, plus plugin suggestions. Advisory only: a bare id
 * is flagged only when NOTHING installed ships it, so a skill from a plugin that is installed but
 * not switched on is not called dangling.
 */
export function findStaleSkillRefs(projectRoot: string, cfg: unknown, homeDir?: string): StaleRefsReport {
  const sources = readSkillSources(projectRoot, homeDir);
  const dangling: DanglingSkillRef[] = [];
  for (const [id, where] of collectSkillRefs(cfg)) {
    const reason = whyUnavailable(sources, id);
    if (reason) dangling.push({ id, reason, where });
  }
  const suggestions = dangling.map((d) => {
    const used = d.where.join(", ");
    switch (d.reason) {
      case "plugin-not-installed":
        return `"${d.id}" (${used}) names plugin "${d.id.split(":")[0]}", which is not installed. Install it, or remove the reference in the Maestro app.`;
      case "plugin-not-enabled":
        return `"${d.id}" (${used}) names plugin "${d.id.split(":")[0]}", which is installed but not enabled for this project. Enable it, or remove the reference in the Maestro app.`;
      case "skill-not-in-plugin":
        return `"${d.id}" (${used}): the plugin is enabled but ships no such skill. Fix the id in the Maestro app.`;
      default:
        return `"${d.id}" (${used}) is not a project, user or installed-plugin skill. Remove the reference in the Maestro app, or add the skill.`;
    }
  });
  return {
    dangling,
    suggestions: [...suggestions, ...missingListsSuggestions(cfg), ...pluginSuggestions(projectRoot, sources)],
  };
}
