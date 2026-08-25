// Installed plugins, and the plugins the open project's own marketplace offers.
//
// PORTED FROM apps/help-server/src/utils/plugins.ts. What changed is where the paths come from:
// the web app read `PLUGINS_DIR` / `MARKETPLACE_JSON` out of `utils/helpers.ts`, constants pinned
// to the Docker mount (`process.cwd()/../..`, i.e. the repo the container was built around). The
// desktop app runs on the host and has an OPEN PROJECT, so every path here is joined onto the
// root the caller passes in — which is also what makes this work against a project that isn't
// this repo.

import path from "node:path";
import {
  getInstalledPlugins as readInstalledPlugins,
  readJsonSafe,
  readSkillsFromDir,
  readAgentsFromDir,
} from "@repo/claude-fs";
import type { DefinitionSummary, InstalledPluginInfo, MarketplacePluginInfo } from "./contracts.js";

export type { InstalledPluginInfo, MarketplacePluginInfo };

/** Plugins installed for this machine, from `~/.claude/plugins/installed_plugins.json`. */
export async function listInstalledPlugins(): Promise<InstalledPluginInfo[]> {
  const plugins = await readInstalledPlugins();
  return plugins.map(({ key, pluginName, marketplace, scope, version, installedAt }) => ({
    key,
    pluginName,
    marketplace,
    scope,
    version,
    installedAt,
  }));
}

/** Where a project declares the marketplace it publishes. */
export function projectMarketplacePath(projectRoot: string): string {
  return path.join(projectRoot, ".claude-plugin", "marketplace.json");
}

/**
 * The plugins the open project's marketplace lists, each with the skills and agents it ships and
 * whether it is installed here.
 *
 * Empty for a project with no `.claude-plugin/marketplace.json` — which is most projects, and is
 * not an error: the tab says so rather than failing the whole dashboard payload.
 */
export async function readProjectMarketplace(projectRoot: string): Promise<MarketplacePluginInfo[]> {
  if (!projectRoot) return [];

  const marketplace = await readJsonSafe<{
    name: string;
    plugins: { name: string; description?: string; source: string }[];
  }>(projectMarketplacePath(projectRoot));
  if (!marketplace) return [];

  const installedKeys = new Set((await readInstalledPlugins()).map((p) => p.key));
  const marketplaceName = marketplace.name;
  const results: MarketplacePluginInfo[] = [];

  for (const entry of marketplace.plugins ?? []) {
    const pluginDir = path.join(projectRoot, "plugins", entry.name);

    const pluginJson = await readJsonSafe<{ name: string; version?: string; description?: string }>(
      path.join(pluginDir, ".claude-plugin", "plugin.json")
    );

    // Shared readers: skills from `<plugin>/skills/<id>/SKILL.md`, agents from `<plugin>/agents/`
    // (flat `<name>.md` or `<name>/AGENTS.md`).
    const skills: DefinitionSummary[] = await readSkillsFromDir(path.join(pluginDir, "skills"));
    const agents: DefinitionSummary[] = await readAgentsFromDir(path.join(pluginDir, "agents"));

    results.push({
      name: entry.name,
      description: entry.description ?? pluginJson?.description ?? "",
      version: pluginJson?.version ?? "",
      skills,
      agents,
      isInstalled: installedKeys.has(`${entry.name}@${marketplaceName}`),
      installCommand: `claude plugin install ${entry.name}@${marketplaceName}`,
    });
  }

  return results;
}
