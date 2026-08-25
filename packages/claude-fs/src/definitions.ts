import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { CLAUDE_DIR } from "./config/directories.js";
import { getInstalledPlugins } from "./plugin.js";
import { parseFrontmatter } from "./utils/frontmatter.js";

// A subagent or skill definition, identified by its frontmatter `name`.
export interface DefinitionInfo {
  name: string;
  description: string;
}

// A definition contributed by an installed plugin, tagged with the plugin's name.
export interface PluginDefinitionInfo extends DefinitionInfo {
  plugin: string;
}

// Installed plugins record `installPath` as a host absolute path. When ~/.claude is
// mounted at a different location (e.g. a container with a different HOME), rebase any
// path under a `.claude` segment onto the active CLAUDE_DIR. No-op when the path is
// already under CLAUDE_DIR (so it's safe on the host too).
export function rebaseOnClaudeDir(p: string): string {
  const marker = `${path.sep}.claude${path.sep}`;
  const idx = p.indexOf(marker);
  if (idx === -1) return p;
  return path.join(CLAUDE_DIR, p.slice(idx + marker.length));
}

// Read skill definitions from a directory of `<id>/SKILL.md` subfolders.
export async function readSkillsFromDir(dir: string): Promise<DefinitionInfo[]> {
  const entries = await readdir(dir).catch(() => null);
  if (entries === null) return [];
  const out: DefinitionInfo[] = [];
  for (const entry of entries) {
    const md = await readFile(path.join(dir, entry, "SKILL.md"), "utf-8").catch(() => null);
    if (md === null) continue;
    const fm = parseFrontmatter(md);
    out.push({ name: fm.name || entry, description: fm.description ?? "" });
  }
  return out;
}

// Read agent definitions from a directory. Supports both flat `<name>.md` files
// (project/user convention) and `<name>/AGENTS.md` subfolders (plugin convention).
export async function readAgentsFromDir(dir: string): Promise<DefinitionInfo[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
  if (entries === null) return [];
  const out: DefinitionInfo[] = [];
  for (const entry of entries) {
    let file: string | null = null;
    if (entry.isFile() && entry.name.endsWith(".md")) {
      file = path.join(dir, entry.name);
    } else if (entry.isDirectory()) {
      file = path.join(dir, entry.name, "AGENTS.md");
    }
    if (!file) continue;
    const md = await readFile(file, "utf-8").catch(() => null);
    if (md === null) continue;
    const fm = parseFrontmatter(md);
    if (fm.name) out.push({ name: fm.name, description: fm.description ?? "" });
  }
  return out;
}

// Global (user-scoped) skills and agents under ~/.claude.
export function getUserSkills(): Promise<DefinitionInfo[]> {
  return readSkillsFromDir(path.join(CLAUDE_DIR, "skills"));
}

export function getUserAgents(): Promise<DefinitionInfo[]> {
  return readAgentsFromDir(path.join(CLAUDE_DIR, "agents"));
}

// Skills/agents contributed by every installed plugin, tagged with the plugin name.
export async function getInstalledPluginSkills(): Promise<PluginDefinitionInfo[]> {
  const plugins = await getInstalledPlugins();
  const out: PluginDefinitionInfo[] = [];
  for (const p of plugins) {
    const skills = await readSkillsFromDir(path.join(rebaseOnClaudeDir(p.installPath), "skills"));
    for (const s of skills) out.push({ ...s, plugin: p.pluginName });
  }
  return out;
}

export async function getInstalledPluginAgents(): Promise<PluginDefinitionInfo[]> {
  const plugins = await getInstalledPlugins();
  const out: PluginDefinitionInfo[] = [];
  for (const p of plugins) {
    const agents = await readAgentsFromDir(path.join(rebaseOnClaudeDir(p.installPath), "agents"));
    for (const a of agents) out.push({ ...a, plugin: p.pluginName });
  }
  return out;
}
