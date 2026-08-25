# claude-fs

A shared utility package for reading Claude Code's `~/.claude/` filesystem. Consumed by the Maestro desktop app's **main process** (which is where its node-side logic lives, under `apps/maestro/src/core/`) — to populate selectors, discovery lists and the `/tools` dashboard with live data from the machine. `apps/help-server` was its second consumer until that app was folded into Maestro; the plugin, marketplace and curated-plugin reads it did are now `src/core/plugins.ts` and `src/core/curated.ts`.

## Purpose

Abstracts all `~/.claude/` path construction and JSON parsing so consumers never hard-code paths or handle missing-file errors themselves.

## Directory constants (`src/config/directories.ts`)

| Export                   | Path                             |
| ------------------------ | -------------------------------- |
| `CLAUDE_DIR`             | `~/.claude`                      |
| `PLUGINS_DIR`            | `~/.claude/plugins`              |
| `MARKETPLACES_CACHE_DIR` | `~/.claude/plugins/marketplaces` |

## API

### `readJsonSafe<T>(filePath)` — `src/utils/parser.ts`

Returns parsed JSON or `null` on any error (missing file, parse error). Used internally by all other functions; exported for ad-hoc reads.

### Marketplace functions — `src/marketplace.ts`

| Function                                 | Source file                                 | Returns                                            |
| ---------------------------------------- | ------------------------------------------- | -------------------------------------------------- |
| `getKnownMarketplaces()`                 | `~/.claude/plugins/known_marketplaces.json` | All registered marketplaces keyed by name          |
| `getLocalMarketplaces()`                 | same                                        | Only `source.source === 'directory'` entries       |
| `getMarketplacePluginsFromPath(dirPath)` | `<dirPath>/.claude-plugin/marketplace.json` | Plugin names listed in that marketplace's manifest |

`KnownMarketplace` shape:

```ts
{
  source: { source: 'github' | 'directory'; repo?: string; path?: string }
  installLocation: string   // host filesystem path
  lastUpdated: string
  autoUpdate?: boolean
}
```

### Plugin functions — `src/plugin.ts`

| Function                             | Source file                                      | Returns                                                         |
| ------------------------------------ | ------------------------------------------------ | --------------------------------------------------------------- |
| `getInstalledPlugins()`              | `~/.claude/plugins/installed_plugins.json`       | Flat list of `InstalledPlugin` (one entry per scope per plugin) |
| `isPluginInstalled(key)`             | same                                             | Boolean                                                         |
| `getInstalledPluginsByMarketplace()` | same                                             | `Record<marketplaceName, pluginName[]>`                         |
| `getCachedMarketplacePlugins(name)`  | `~/.claude/plugins/marketplaces/<name>/plugins/` | Plugins cached from a GitHub-sourced marketplace                |

Plugin key format: `<pluginName>@<marketplaceName>`.

`CachedPlugin` is only populated for GitHub-sourced marketplaces — local/directory marketplaces use `getMarketplacePluginsFromPath` instead.

## Adding a new reader

1. Add a new file under `src/` (or extend an existing one).
2. Export the new type/function from `src/index.ts`.
3. Keep all path construction inside this package — consumers should never import `PLUGINS_DIR` to build paths themselves.
