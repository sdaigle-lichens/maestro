// The curated marketplaces' plugins, read out of the local `~/.claude` marketplace cache.
//
// PORTED FROM apps/help-server/src/utils/marketplace.ts, unchanged in substance: this one never
// depended on the Docker mount, because `@repo/claude-fs` already reads the cache under the user's
// home directory. It fetches nothing over the network — a marketplace only appears here once
// Claude Code has cached it, so an empty list means "not added on this machine", not "offline".

import { getCachedMarketplacePlugins, getInstalledPlugins } from "@repo/claude-fs";
import type { CuratedPlugin } from "./contracts.js";

export type { CuratedPlugin };

/** The marketplaces the dashboard vouches for, with the labels the UI shows instead of the slug. */
export const CURATED_MARKETPLACES = [
  { name: "claude-plugins-official", label: "Anthropic Official" },
  { name: "astral-sh", label: "Astral" },
] as const;

export async function listCuratedPlugins(): Promise<CuratedPlugin[]> {
  const installedKeys = new Set((await getInstalledPlugins()).map((p) => p.key));

  const results: CuratedPlugin[] = [];
  for (const { name: marketplace, label } of CURATED_MARKETPLACES) {
    for (const plugin of await getCachedMarketplacePlugins(marketplace)) {
      results.push({
        name: plugin.name,
        marketplace,
        marketplaceLabel: label,
        description: plugin.description,
        isInstalled: installedKeys.has(`${plugin.name}@${marketplace}`),
        installCommand: `claude plugin install ${plugin.name}@${marketplace}`,
      });
    }
  }
  return results;
}
