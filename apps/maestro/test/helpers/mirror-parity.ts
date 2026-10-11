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
  /** `cp plugins/maestro/<src> <dest>` — the fix, ready to paste. */
  fix: string;
}

export function staleMirrors(pluginRoot: string, projectRoot: string, assets: MirrorAsset[]): StaleMirror[] {
  const stale: StaleMirror[] = [];
  for (const { src, dest } of assets) {
    const from = path.join(pluginRoot, ...src.split("/"));
    const to = path.join(projectRoot, ...dest.split("/"));
    const fix = `cp plugins/maestro/${src} ${dest}`;
    if (!fs.existsSync(to)) {
      stale.push({ src, dest, reason: "missing", fix });
      continue;
    }
    if (!fs.readFileSync(to).equals(fs.readFileSync(from))) stale.push({ src, dest, reason: "differs", fix });
  }
  return stale;
}

/** One line per stale mirror, for an assertion message. */
export function describeStale(stale: StaleMirror[]): string {
  return stale.map((s) => `${s.dest} ${s.reason === "missing" ? "is missing" : "is stale"} — ${s.fix}`).join("\n");
}
