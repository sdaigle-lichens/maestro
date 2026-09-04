// The app's data access for one handoff route: resolve what's in effect, and save a project
// override. Thin — the actual decision is `handoff-resolution.ts`'s pure `resolveHandoff`; this
// module is only the `fs` + config plumbing around it, exactly as `reports.ts` is for reports.
//
// `034` builds `/templates`' Handoffs tab and `/agents`' Interactions pane on top of this plus
// `handoffRoutes()`: the routes leaving an agent come from the graph walk, and each one's resolved
// template and provenance come from `getResolvedHandoff`.

import fs from "node:fs";
import path from "node:path";
import { readConfig, writeConfig, blankConfig } from "./config.js";
import { readHandoffDefault, DEFAULT_HANDOFF_DEFAULTS_DB_PATH } from "./handoff-defaults.js";
import { resolveHandoff } from "./handoff-resolution.js";
import { handoffFilePath } from "./handoff-sync.js";
import { isValidHandoffId } from "./handoff-seeds.js";
import type { ResolvedHandoff } from "./contracts.js";

export type { ResolvedHandoff };

function readProjectHandoffFile(projectRoot: string, handoffId: string): string | null {
  try {
    const body = fs.readFileSync(handoffFilePath(projectRoot, handoffId), "utf8");
    return body.trim().length > 0 ? body : null;
  } catch {
    return null;
  }
}

/**
 * What's in effect for `handoffId` right now — project override, else global default, else the
 * shipped seed, else none.
 *
 * A `projectRoot` of `""` means no project is open: there is no project tier to consult, only the
 * global one and the seed. Same convention as `getResolvedReport`.
 */
export function getResolvedHandoff(
  projectRoot: string,
  handoffId: string,
  dbPath: string = DEFAULT_HANDOFF_DEFAULTS_DB_PATH
): ResolvedHandoff {
  if (!isValidHandoffId(handoffId)) throw new Error(`Invalid handoff id: ${String(handoffId)}`);
  const projectContent = projectRoot ? readProjectHandoffFile(projectRoot, handoffId) : null;
  // Not fatal if the store can't be opened: the seed tier is exactly what covers that, and it is
  // the whole reason `resolveHandoff` has three tiers instead of two.
  let global = null;
  try {
    global = readHandoffDefault(handoffId, dbPath);
  } catch {
    global = null;
  }
  const resolved = resolveHandoff(handoffId, projectContent, global);
  return { source: resolved.source, content: resolved.content ?? "" };
}

/**
 * Save semantics: "if you touch it, it becomes this project's override." Writes
 * `.claude/handoffs/<sender>/<receiver>.md` and records the pair in the `handoffs` slice WITHOUT
 * `syncedFrom` — dropping that field is what marks the copy detached, so `syncProjectHandoffs`
 * never overwrites it again no matter how far the global default moves on.
 */
export function saveProjectHandoffOverride(projectRoot: string, handoffId: string, content: string): ResolvedHandoff {
  if (!projectRoot) throw new Error("No project is open.");
  const filePath = handoffFilePath(projectRoot, handoffId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);

  const cfg = readConfig(projectRoot) ?? blankConfig();
  const handoffs = { ...(cfg.handoffs ?? {}), [handoffId]: { id: handoffId } };
  writeConfig(projectRoot, { ...cfg, handoffs });

  return { source: "project", content };
}
