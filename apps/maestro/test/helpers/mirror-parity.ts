// Which project mirrors of the plugin's runtime assets are stale? (`087`)
//
// Every `{ src, dest }` pair the install manifest copies (`runtimeAssets()` from install.ts, so the
// hook scripts' `.js` -> `.cjs` rename comes with it) is compared byte-for-byte between
// `<pluginRoot>/<src>` and `<projectRoot>/<dest>`. A missing or differing mirror is returned with
// the one command that fixes it, so a failing assertion names the file.

import fs from "node:fs";
import path from "node:path";

export interface MirrorAsset {
  src: string;
  dest: string;
}

export interface StaleMirror extends MirrorAsset {
  reason: "missing" | "differs";
  /** The one refresh command (`REFRESH_COMMAND`). */
  fix: string;
}

export function staleMirrors(pluginRoot: string, projectRoot: string, assets: MirrorAsset[]): StaleMirror[] {
  const stale: StaleMirror[] = [];
  for (const { src, dest } of assets) {
    const from = path.join(pluginRoot, ...src.split("/"));
    const to = path.join(projectRoot, ...dest.split("/"));
    const fix = REFRESH_COMMAND;
    if (!fs.existsSync(to)) {
      stale.push({ src, dest, reason: "missing", fix });
      continue;
    }
    if (!fs.readFileSync(to).equals(fs.readFileSync(from))) stale.push({ src, dest, reason: "differs", fix });
  }
  return stale;
}

/** The one command that refreshes every mirror, the rendered orchestrator and the settings hooks. */
export const REFRESH_COMMAND = "pnpm refresh:runtime";

/** One line per stale mirror, then the single command that fixes all of them. */
export function describeStale(stale: StaleMirror[]): string {
  if (stale.length === 0) return "";
  const lines = stale.map((s) => `${s.dest} ${s.reason === "missing" ? "is missing" : "is stale"} (from ${s.src})`);
  return [...lines, `Fix: run \`${REFRESH_COMMAND}\` (an agent hands the user \`! ${REFRESH_COMMAND}\`).`].join("\n");
}
