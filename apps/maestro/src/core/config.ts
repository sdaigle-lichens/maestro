// Read / merge / write of <project>/.claude/maestro.json.
//
// PORTED FROM apps/ai-tools-manager/src/utils/maestro.ts (readConfig + the body of
// submitMaestroConfig) and plugins/maestro/scripts/lib/maestro-session.cjs (readJson).
//
// The on-disk format is load-bearing: `JSON.stringify(cfg, null, 2)` with NO trailing newline.
// The web app and the /maestro-app skill both wrote it that way and had to stay byte-identical;
// now there is one writer, but the format is preserved so existing repos show no spurious diff.

import fs from "node:fs";
import path from "node:path";
import type { MaestroConfigV3, MaestroRulesSlice, MaestroWorkflowsSlice } from "./types.js";

export function maestroJsonPath(projectRoot: string): string {
  return path.join(projectRoot, ".claude", "maestro.json");
}

export function blankConfig(): MaestroConfigV3 {
  return {
    version: 3,
    agents_available: [],
    skills_available: [],
    workflow_instances: [],
    workflows: [],
    rules: [],
  };
}

export function readJsonSafe<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Read a project's config. A missing file yields `null` so the caller can decide between
 * seeding a default canvas (first install) and reporting "not configured" — the web app
 * conflated those by always seeding.
 *
 * A present-but-corrupt or wrong-version file yields a blank config, matching the old
 * `readConfig` fallback: we never hand back a half-parsed object.
 */
export function readConfig(projectRoot: string): MaestroConfigV3 | null {
  const p = maestroJsonPath(projectRoot);
  if (!fs.existsSync(p)) return null;
  const parsed = readJsonSafe<MaestroConfigV3>(p);
  if (!parsed) return blankConfig();
  return parsed.version === 3 ? parsed : blankConfig();
}

/** Serialize in the canonical on-disk format. Exported so tests can assert byte equality. */
export function serializeConfig(cfg: MaestroConfigV3): string {
  return JSON.stringify(cfg, null, 2);
}

export function writeConfig(projectRoot: string, cfg: MaestroConfigV3): string {
  const claudeDir = path.join(projectRoot, ".claude");
  if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });
  const p = maestroJsonPath(projectRoot);
  fs.writeFileSync(p, serializeConfig(cfg));
  return p;
}

export type ConfigSlice =
  | { sliceType: "workflows"; slice: MaestroWorkflowsSlice }
  | { sliceType: "rules"; slice: MaestroRulesSlice };

/**
 * Merge one slice into a config, leaving the other slice untouched.
 *
 * This separation is the reason /workflows saves can't clobber /rules assignments and vice
 * versa — widening either branch to write the other's fields reintroduces that bug.
 */
export function mergeSlice(current: MaestroConfigV3, input: ConfigSlice): MaestroConfigV3 {
  const next: MaestroConfigV3 = { ...current, version: 3 };
  if (input.sliceType === "workflows") {
    next.agents_available = input.slice.agents_available;
    next.skills_available = input.slice.skills_available;
    next.workflow_instances = input.slice.workflow_instances;
    next.workflows = input.slice.workflows;
  } else {
    next.rules = input.slice.rules;
  }
  return next;
}
