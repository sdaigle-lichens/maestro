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
import type {
  MaestroConfigV3,
  MaestroGates,
  MaestroGatesSlice,
  MaestroProjectTagsSlice,
  MaestroRulesSlice,
  MaestroTaskRoutingSlice,
  MaestroWorkflowsSlice,
} from "./types.js";

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

/**
 * Stamp `runtimeVersion` into an EXISTING `maestro.json`, leaving every other field untouched.
 *
 * No-ops (returns false, writes nothing) when there is no `maestro.json` yet — matching the
 * "no-op when maestro.json is absent" pattern the runtime hooks already follow — and when the
 * stamped version already matches, so a project already current from this call's point of view
 * costs one read and zero writes. This is the one write `install.ts` makes to the config file
 * itself; it never touches `workflows`/`rules`/anything else the user authored.
 */
export function writeRuntimeVersion(projectRoot: string, version: string): boolean {
  const cfg = readConfig(projectRoot);
  if (!cfg || cfg.runtimeVersion === version) return false;
  writeConfig(projectRoot, { ...cfg, runtimeVersion: version });
  return true;
}

export type ConfigSlice =
  | { sliceType: "workflows"; slice: MaestroWorkflowsSlice }
  | { sliceType: "rules"; slice: MaestroRulesSlice }
  | { sliceType: "project-tags"; slice: MaestroProjectTagsSlice }
  | { sliceType: "gates"; slice: MaestroGatesSlice }
  | { sliceType: "task-routing"; slice: MaestroTaskRoutingSlice };

/** Both gates off — what an absent, partial or corrupt `gates` field resolves to, per field. */
export const DEFAULT_GATES: MaestroGates = { confidence_check: false, use_code_architecture_design_check: false };

/**
 * The one reader of `gates`. Every field is compared with a strict `=== true`, so an absent
 * block, a `gates` that isn't a plain object, and a gate whose value is a string, a number or
 * `null` all resolve to off rather than to something truthy.
 *
 * `maestro-step1-gates.cjs` reimplements this rule for the runtime (it can't import from
 * src/core), so a change here needs the same change there.
 */
export function resolveGates(cfg: MaestroConfigV3 | null): MaestroGates {
  const raw = cfg && typeof cfg.gates === "object" && cfg.gates !== null ? (cfg.gates as Partial<MaestroGates>) : null;
  if (!raw) return { ...DEFAULT_GATES };
  return {
    confidence_check: raw.confidence_check === true,
    use_code_architecture_design_check: raw.use_code_architecture_design_check === true,
  };
}

/**
 * The one reader of `use_maestro_tasks`. Mirrors `resolveGates`'s strict `=== true` comparison: an
 * absent field, a corrupt/null config, a `version !== 3` config, and a non-boolean value (a
 * string, a number, `null`) all resolve to `false` rather than to something truthy.
 *
 * `maestro-step4-gate.cjs` reimplements this rule for the runtime (it can't import from src/core),
 * so a change here needs the same change there.
 */
export function resolveUseMaestroTasks(cfg: MaestroConfigV3 | null): boolean {
  if (!cfg || cfg.version !== 3) return false;
  return cfg.use_maestro_tasks === true;
}

/**
 * Merge one slice into a config, leaving the other slices untouched.
 *
 * This separation is the reason /workflows saves can't clobber /rules assignments and vice
 * versa — widening any branch to write another's fields reintroduces that bug.
 *
 * EVERY arm is an explicit `sliceType` test and there is no trailing `else`. There used to be one,
 * holding `project-tags`, which is a latent version of exactly the bug above: the next slice added
 * would have silently inherited the project-tags write. Adding an arm is the whole cost of adding
 * a slice — pay it here rather than debugging a clobber later.
 */
export function mergeSlice(current: MaestroConfigV3, input: ConfigSlice): MaestroConfigV3 {
  const next: MaestroConfigV3 = { ...current, version: 3 };
  if (input.sliceType === "workflows") {
    next.agents_available = input.slice.agents_available;
    next.skills_available = input.slice.skills_available;
    next.workflow_instances = input.slice.workflow_instances;
    next.workflows = input.slice.workflows;
  } else if (input.sliceType === "rules") {
    next.rules = input.slice.rules;
  } else if (input.sliceType === "project-tags") {
    next.project_tags = input.slice.project_tags;
  } else if (input.sliceType === "gates") {
    next.gates = input.slice.gates;
  } else if (input.sliceType === "task-routing") {
    next.use_maestro_tasks = input.slice.use_maestro_tasks;
  }
  return next;
}
