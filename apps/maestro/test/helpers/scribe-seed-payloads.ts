// Realistic `<sender> -> scribe` channel payloads built from the SHIPPED seed protocols
// (`handoff-seeds.ts`), not from a hand-invented shape: the reviewer and refactor seeds always
// carry a gap array alongside their ordinary fields, and a payload that reports no gaps fills it
// with `[]`. `112`'s gap retention must tell that apart from a real gap report.

import { SEED_HANDOFFS, PRIOR_SEEDS } from "../../src/core/handoff-seeds.js";

const FENCED_JSON_RE = /```json[^\n]*\n([\s\S]*?)```/;

/** The top-level object of a seed body's fenced json block, or null when it has none / no gap key. */
function seedObject(body: string): Record<string, unknown> | null {
  const m = FENCED_JSON_RE.exec(body);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[1]);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    return "skill_gaps" in obj || "concept_skill_gaps" in obj ? obj : null;
  } catch {
    return null;
  }
}

/** Every current and prior seed body for `<sender>/scribe` whose top-level object has a gap key. */
export function scribeSeedShapes(sender: "reviewer" | "refactor"): Record<string, unknown>[] {
  const id = `${sender}/scribe`;
  const bodies = [SEED_HANDOFFS[id], ...(PRIOR_SEEDS[id] ?? [])].filter(Boolean);
  const shapes = bodies.map(seedObject).filter((o): o is Record<string, unknown> => o !== null);
  if (shapes.length === 0) throw new Error(`no seed with a gap key for ${id}`);
  return shapes;
}

const fence = (obj: unknown) => "```json\n" + JSON.stringify(obj, null, 2) + "\n```\n";

/** The seed's shape with its gap array(s) emptied — an ordinary handoff that found no gaps. */
export function noGapPayload(shape: Record<string, unknown>, marker: string): string {
  const out: Record<string, unknown> = { ...shape };
  for (const k of ["skill_gaps", "concept_skill_gaps"]) if (k in out) out[k] = [];
  out.new_code_patterns_or_rules = [marker]; // a field both the reviewer and refactor seeds carry
  return fence(out);
}

/** The seed's shape with a real gap entry — a gap report riding in an ordinary handoff payload. */
export function withGapPayload(shape: Record<string, unknown>, marker: string): string {
  const out: Record<string, unknown> = { ...shape };
  const key = "skill_gaps" in out ? "skill_gaps" : "concept_skill_gaps";
  out[key] = [{ skill: "agents-view", missing: `the tri-state chip logic ${marker}` }];
  return fence(out);
}
