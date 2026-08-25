import path from "node:path";
import { PLUGINS_DIR } from "./config/directories.js";
import { readJsonSafe } from "./utils/parser.js";

export interface KnownMarketplace {
  source: { source: "github" | "directory"; repo?: string; path?: string };
  installLocation: string;
  lastUpdated: string;
  autoUpdate?: boolean;
}

export async function getKnownMarketplaces(): Promise<Record<string, KnownMarketplace>> {
  return (
    (await readJsonSafe<Record<string, KnownMarketplace>>(path.join(PLUGINS_DIR, "known_marketplaces.json"))) ?? {}
  );
}

export async function getLocalMarketplaces(): Promise<Record<string, KnownMarketplace>> {
  const all = await getKnownMarketplaces();
  return Object.fromEntries(Object.entries(all).filter(([, m]) => m.source.source === "directory"));
}

export async function getMarketplacePluginsFromPath(dirPath: string): Promise<string[]> {
  type Manifest = { plugins?: Array<{ name: string }> };
  const manifest = await readJsonSafe<Manifest>(path.join(dirPath, ".claude-plugin", "marketplace.json"));
  return (manifest?.plugins ?? []).map((p) => p.name);
}
