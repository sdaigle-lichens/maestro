import path from "node:path";

export const CLAUDE_DIR = path.join(process.env.HOME ?? "", ".claude");
export const PLUGINS_DIR = path.join(CLAUDE_DIR, "plugins");
export const MARKETPLACES_CACHE_DIR = path.join(PLUGINS_DIR, "marketplaces");
