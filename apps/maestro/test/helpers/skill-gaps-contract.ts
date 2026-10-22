// code-graph's published skill-gap contract (0.3.20), vendored under test/fixtures/ — see the README
// there. Nothing here reads outside the maestro repo.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

export const GAP_EXAMPLE_TEXT = fs.readFileSync(path.join(fixtures, "code-graph-skill-gaps.example.json"), "utf8");
export const GAP_EXAMPLE: unknown = JSON.parse(GAP_EXAMPLE_TEXT);
export const GAP_SCHEMA = JSON.parse(
  fs.readFileSync(path.join(fixtures, "code-graph-skill-gaps.schema.json"), "utf8")
) as {
  required: string[];
  properties: {
    skill_gaps: {
      type: string;
      items: { type: string; required: string[]; properties: Record<string, { type: string }> };
    };
  };
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * A hand-written check of the vendored schema's rules (no validator dependency): the body is an
 * object with a `skill_gaps` array whose items are objects with the required string fields. Reads
 * the required keys and types from the schema file itself. Returns the violations; [] means valid.
 */
export function gapBodyViolations(body: unknown): string[] {
  const out: string[] = [];
  if (!isObject(body)) return ["body is not an object"];
  for (const key of GAP_SCHEMA.required) if (!(key in body)) out.push(`missing required "${key}"`);
  const gaps = body.skill_gaps;
  if (gaps === undefined) return out;
  if (!Array.isArray(gaps)) return [...out, "skill_gaps is not an array"];
  const item = GAP_SCHEMA.properties.skill_gaps.items;
  gaps.forEach((g, i) => {
    if (!isObject(g)) return void out.push(`skill_gaps[${i}] is not an object`);
    for (const key of item.required) if (!(key in g)) out.push(`skill_gaps[${i}] missing "${key}"`);
    for (const [key, spec] of Object.entries(item.properties)) {
      if (key in g && spec.type === "string" && typeof g[key] !== "string")
        out.push(`skill_gaps[${i}].${key} is not a string`);
    }
  });
  return out;
}
