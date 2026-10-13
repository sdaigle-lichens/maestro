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
 *  - `end_skills.maestro` is read the same way; absent is empty.
 *  - Every degenerate input (absent, corrupt, `version !== 3`, wrong types, no `start_skills`)
 *    gives empty lists.
 */
export function resolveSkillLists(cfg: unknown): ResolvedSkillLists {
  if (!isPlainObject(cfg) || cfg.version !== 3) {
    return { maestroStart: [], toMaestroTasksStart: [], maestroEnd: [] };
  }
  const maestroEnd = isPlainObject(cfg.end_skills) ? ids(cfg.end_skills.maestro) : [];
  const start = isPlainObject(cfg.start_skills) ? cfg.start_skills : {};
  return { maestroStart: ids(start.maestro), toMaestroTasksStart: ids(start.to_maestro_tasks), maestroEnd };
}
