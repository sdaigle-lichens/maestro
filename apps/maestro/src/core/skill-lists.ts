// The one reader of the configurable start / end skill lists in `maestro.json`.
//
// Shared by the desktop app (via core) and the runtime scripts (bundled into
// plugins/maestro/scripts/lib/maestro-skill-lists.cjs), so the two cannot disagree. It takes
// `unknown` and never throws: the scripts feed it whatever JSON.parse returned, and an injected
// command that fails aborts the whole skill invocation.

export interface ResolvedSkillLists {
  maestroStart: string[];
  toMaestroTasksStart: string[];
  maestroEnd: string[];
}

/** The two bundled gate skills — what a pre-`start_skills` project's `gates` booleans stand for. */
export const LEGACY_CONFIDENCE_SKILL = "confidence-check";
export const LEGACY_DESIGN_SKILL = "use-code-architecture-design-check";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Non-empty strings only, trimmed, de-duplicated in first-seen order. Anything else is dropped,
 * including an id with internal whitespace (never a valid skill id, and it would break the
 * scripts' one-line output).
 */
function ids(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (id && !/\s/.test(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Resolve the three skill lists.
 *
 *  - `start_skills` a plain object: authoritative, a missing key is an empty list.
 *  - otherwise the legacy `gates` booleans (strict `=== true`) give the maestro start list, and
 *    `/to-maestro-tasks` keeps its old behaviour of running both gate skills.
 *  - `end_skills.maestro` is read the same way (no legacy form: absent is empty).
 *  - Every degenerate input (absent, corrupt, `version !== 3`, wrong types) gives empty maestro
 *    lists and the legacy `/to-maestro-tasks` default of both.
 */
export function resolveSkillLists(cfg: unknown): ResolvedSkillLists {
  const legacyBoth = [LEGACY_CONFIDENCE_SKILL, LEGACY_DESIGN_SKILL];
  if (!isPlainObject(cfg) || cfg.version !== 3) {
    return { maestroStart: [], toMaestroTasksStart: legacyBoth, maestroEnd: [] };
  }

  const maestroEnd = isPlainObject(cfg.end_skills) ? ids(cfg.end_skills.maestro) : [];

  if (isPlainObject(cfg.start_skills)) {
    return {
      maestroStart: ids(cfg.start_skills.maestro),
      toMaestroTasksStart: ids(cfg.start_skills.to_maestro_tasks),
      maestroEnd,
    };
  }

  const gates = isPlainObject(cfg.gates) ? cfg.gates : {};
  const maestroStart: string[] = [];
  if (gates.confidence_check === true) maestroStart.push(LEGACY_CONFIDENCE_SKILL);
  if (gates.use_code_architecture_design_check === true) maestroStart.push(LEGACY_DESIGN_SKILL);
  return { maestroStart, toMaestroTasksStart: legacyBoth, maestroEnd };
}
