// Maestro's half of the skill-gap contract with code-graph (0.3.20): the gap shapes maestro EMITS
// (report defaults, handoff seeds) satisfy code-graph's vendored schema. The end-to-end handling of
// the vendored example lives in scribe-gap-retention.test.ts. Fixtures: test/fixtures/README.md.

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readAllAgentReportDefaults } from "../../src/core/report-defaults.js";
import { scribeSeedShapes } from "../helpers/scribe-seed-payloads.js";
import { GAP_EXAMPLE, GAP_SCHEMA, gapBodyViolations } from "../helpers/skill-gaps-contract.js";

let tmp: string | undefined;
afterEach(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

/** Every `{ "skill_gaps": ... }` inline-code example in a report body, parsed. */
function emittedGapExamples(content: string): unknown[] {
  const out: unknown[] = [];
  for (const m of content.matchAll(/`(\{ "skill_gaps":[^`]*\})`/g)) out.push(JSON.parse(m[1]));
  return out;
}

describe("the vendored code-graph contract is internally consistent", () => {
  it("the vendored example satisfies the vendored schema", () => {
    expect(gapBodyViolations(GAP_EXAMPLE)).toEqual([]);
  });

  it("the schema still has the shape the hand-written check relies on", () => {
    expect(GAP_SCHEMA.required).toEqual(["skill_gaps"]);
    expect(GAP_SCHEMA.properties.skill_gaps.type).toBe("array");
    expect(GAP_SCHEMA.properties.skill_gaps.items.required).toEqual(["skill", "missing"]);
    expect(GAP_SCHEMA.properties.skill_gaps.items.properties.skill.type).toBe("string");
    expect(GAP_SCHEMA.properties.skill_gaps.items.properties.missing.type).toBe("string");
  });

  it("the check rejects bodies the schema forbids (negative control)", () => {
    expect(gapBodyViolations({})).not.toEqual([]);
    expect(gapBodyViolations({ skill_gaps: "x" })).not.toEqual([]);
    expect(gapBodyViolations({ skill_gaps: [{ skill: "a" }] })).not.toEqual([]);
    expect(gapBodyViolations({ skill_gaps: [{ skill: 1, missing: "m" }] })).not.toEqual([]);
    expect(gapBodyViolations({ skill_gaps: [{ skill: "a", missing: 2 }] })).not.toEqual([]);
    expect(gapBodyViolations({ concept_skill_gaps: [{ skill: "a", missing: "m" }] })).not.toEqual([]);
    expect(gapBodyViolations({ skill_gaps: [] })).toEqual([]);
  });
});

describe("the gap example maestro emits satisfies the vendored schema", () => {
  it("every agent report default that carries a gap note emits a valid example", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-117-"));
    const defaults = readAllAgentReportDefaults(path.join(tmp, "report-defaults.sqlite"));
    const withNote = Object.entries(defaults).filter(([, d]) => d.content.includes('"skill_gaps"'));
    // Every non-scribe default tells its agent how to report a gap (a vacuous pass would hide a rename).
    expect(withNote.map(([name]) => name).sort()).toEqual(["backend", "frontend", "infra", "mobile", "test"]);
    for (const [name, d] of withNote) {
      const examples = emittedGapExamples(d.content);
      expect(examples, `${name} has no parsable skill_gaps example`).toHaveLength(1);
      expect(gapBodyViolations(examples[0]), name).toEqual([]);
      // Same top-level shape as code-graph's published example.
      expect(Object.keys(examples[0] as object)).toEqual(Object.keys(GAP_EXAMPLE as object));
    }
  });

  it("the scribe report default emits no gap example that breaks the schema, and keeps the ack line", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-117-"));
    const scribe = readAllAgentReportDefaults(path.join(tmp, "report-defaults.sqlite")).scribe;
    expect(scribe).toBeDefined();
    for (const ex of emittedGapExamples(scribe.content)) expect(gapBodyViolations(ex)).toEqual([]);
    expect(scribe.content).toContain("SKILL_GAPS_HANDLED:");
  });

  for (const sender of ["reviewer", "refactor"] as const) {
    it(`the shipped ${sender} -> scribe seed shapes carry skill_gaps arrays the schema accepts`, () => {
      const current = scribeSeedShapes(sender).filter((s) => "skill_gaps" in s);
      expect(current.length).toBeGreaterThan(0);
      for (const shape of current) {
        expect(gapBodyViolations({ skill_gaps: shape.skill_gaps }), sender).toEqual([]);
      }
    });
  }
});
