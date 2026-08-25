import { readdir } from "node:fs/promises";
import path from "node:path";
import { PLUGINS_DIR, MARKETPLACES_CACHE_DIR } from "./config/directories.js";
import { readJsonSafe } from "./utils/parser.js";

// ---------------------------------------------------------------------------
// Installed plugins (~/.claude/plugins/installed_plugins.json)
// ---------------------------------------------------------------------------

export interface InstalledPlugin {
  key: string;
  pluginName: string;
  marketplace: string;
  scope: string;
  version: string;
  installedAt: string;
  installPath: string;
  projectPath?: string;
}

type RawInstalledPlugins = {
  version?: number;
  plugins: Record<
    string,
    Array<{
      scope: string;
      version: string;
      installedAt: string;
      installPath: string;
      projectPath?: string;
    }>
  >;
};

async function readInstalledPluginsRaw(): Promise<RawInstalledPlugins | null> {
  return readJsonSafe<RawInstalledPlugins>(path.join(PLUGINS_DIR, "installed_plugins.json"));
}

export async function getInstalledPlugins(): Promise<InstalledPlugin[]> {
  const data = await readInstalledPluginsRaw();
  if (!data) return [];

  return Object.entries(data.plugins).flatMap(([key, installs]) => {
    const atIdx = key.lastIndexOf("@");
    const pluginName = atIdx === -1 ? key : key.slice(0, atIdx);
    const marketplace = atIdx === -1 ? "" : key.slice(atIdx + 1);
    return installs.map((install) => ({
      key,
      pluginName,
      marketplace,
      scope: install.scope,
      version: install.version,
      installedAt: install.installedAt,
      installPath: install.installPath,
      projectPath: install.projectPath,
    }));
  });
}

export async function isPluginInstalled(key: string): Promise<boolean> {
  const data = await readInstalledPluginsRaw();
  return key in (data?.plugins ?? {});
}

export async function getInstalledPluginsByMarketplace(): Promise<Record<string, string[]>> {
  const data = await readInstalledPluginsRaw();
  if (!data) return {};

  const result: Record<string, string[]> = {};
  for (const key of Object.keys(data.plugins)) {
    const atIdx = key.lastIndexOf("@");
    if (atIdx === -1) continue;
    const pluginName = key.slice(0, atIdx);
    const marketplace = key.slice(atIdx + 1);
    (result[marketplace] ??= []).push(pluginName);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Cached marketplace plugins (~/.claude/plugins/marketplaces/<name>/plugins/)
// Only populated for github-sourced marketplaces.
// ---------------------------------------------------------------------------

export interface CachedPlugin {
  name: string;
  description: string;
  marketplace: string;
}

export async function getCachedMarketplacePlugins(marketplaceName: string): Promise<CachedPlugin[]> {
  const pluginsDir = path.join(MARKETPLACES_CACHE_DIR, marketplaceName, "plugins");
  try {
    const pluginDirs = await readdir(pluginsDir);
    const results: CachedPlugin[] = [];
    for (const pluginName of pluginDirs) {
      const pluginJson = await readJsonSafe<{ name?: string; description?: string }>(
        path.join(pluginsDir, pluginName, ".claude-plugin", "plugin.json")
      );
      if (!pluginJson) continue;
      results.push({ name: pluginName, description: pluginJson.description ?? "", marketplace: marketplaceName });
    }
    return results;
  } catch {
    return [];
  }
}
