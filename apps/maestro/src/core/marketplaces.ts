// The user's local plugin marketplaces, read from `~/.claude/` at the moment they are asked for.
//
// WHAT THIS REPLACES. The web app read `/tmp/marketplace-data.json` — a file a shell hook computed
// on the HOST and bind-mounted into the container, because a local marketplace's `installLocation`
// in `known_marketplaces.json` is a host path and nothing under it exists inside Docker. The
// desktop app runs on the host, so the indirection has no reason to exist; deleting this consumer
// is what lets the precompute file (and the script that writes it) be retired with the Docker path.
//
// WHY IT DOESN'T CALL `@repo/claude-fs`, WHICH HAS THESE READERS. Two reasons, both structural:
//
//   • `claude-fs` fixes `CLAUDE_DIR` from `process.env.HOME` at module-evaluation time, so a test
//     cannot point it at a fixture without re-importing the module graph. Everything here takes an
//     explicit `home`, the same lever `claude-cli.ts` already uses, so the scaffold and preview
//     tests run against a temp directory instead of the developer's real marketplaces.
//   • `claude-preview.ts` must be unable to start a process, and the test that guarantees it walks
//     only RELATIVE imports — a hop into a workspace package would leave the graph unwalked. Every
//     module preview reaches is therefore a relative one, and this is one of them.
//
// Sync on purpose: `previewClaudeRun` is synchronous, and the whole file is a few hundred bytes.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { MarketplaceEntry } from "./contracts.js";
export type { MarketplaceEntry };

export interface MarketplaceOptions {
  /** Home directory to read `.claude/` under. Defaults to the real one. */
  home?: string;
  /**
   * Include non-`directory`-sourced entries (GitHub, etc.) too.
   *
   * Defaults to false, which is the create-forms' own requirement: writing into a GitHub-sourced
   * marketplace would write into the plugin cache, which the next `claude plugin marketplace
   * update` overwrites. The global Marketplace tab has no such requirement — it only ever
   * reads — so it opts in to see the marketplaces `known_marketplaces.json` actually holds,
   * rather than silently dropping every one that isn't a local directory.
   */
  includeRemote?: boolean;
}

/** One entry of `~/.claude/plugins/known_marketplaces.json`. */
interface KnownMarketplace {
  source?: { source?: string };
  installLocation?: string;
}

function homeDir(opts: MarketplaceOptions): string {
  return opts.home ?? process.env.HOME ?? os.homedir();
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Plugin names a marketplace repo's manifest lists. Empty for a path that isn't one. */
export function marketplacePlugins(marketplacePath: string): string[] {
  const manifest = readJson<{ plugins?: Array<{ name?: string }> }>(
    path.join(marketplacePath, ".claude-plugin", "marketplace.json")
  );
  return (manifest?.plugins ?? []).map((p) => String(p?.name ?? "")).filter(Boolean);
}

/**
 * The user's local plugin marketplaces.
 *
 * By default, only `source: "directory"` entries — the ones a create form can write into.
 * GitHub-sourced marketplaces are excluded because writing into one would write into the plugin
 * cache — a directory the next `claude plugin marketplace update` overwrites, so the user's new
 * skill would vanish without ever having been anywhere they could commit it.
 *
 * `opts.includeRemote: true` lifts that filter for a caller that only reads — the global
 * Marketplace tab — so a GitHub-sourced marketplace isn't silently missing from "marketplaces
 * I've added."
 */
export function listMarketplaces(opts: MarketplaceOptions = {}): MarketplaceEntry[] {
  const known =
    readJson<Record<string, KnownMarketplace>>(
      path.join(homeDir(opts), ".claude", "plugins", "known_marketplaces.json")
    ) ?? {};

  return Object.entries(known)
    .filter(([, m]) => (opts.includeRemote || m?.source?.source === "directory") && !!m.installLocation)
    .map(([name, m]) => ({
      name,
      path: m.installLocation!,
      plugins: marketplacePlugins(m.installLocation!),
      owner: marketplaceOwner(m.installLocation!),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Where a marketplace NAME lives on disk, or null.
 *
 * Every path a create flow writes to is derived here, from a name the user picked out of a list
 * this module produced — never from a path that crossed the process boundary. That is what stops
 * a renderer (buggy or otherwise) from aiming a scaffold at an arbitrary directory.
 */
export function marketplacePath(name: string, opts: MarketplaceOptions = {}): string | null {
  return listMarketplaces(opts).find((m) => m.name === name)?.path ?? null;
}

/** The `owner` block of a marketplace manifest, so a new plugin can inherit its author. */
export function marketplaceOwner(marketplacePath: string): { name: string; email: string } | null {
  const manifest = readJson<{ owner?: { name?: string; email?: string } }>(
    path.join(marketplacePath, ".claude-plugin", "marketplace.json")
  );
  const owner = manifest?.owner;
  return owner?.name ? { name: owner.name, email: owner.email ?? "" } : null;
}
