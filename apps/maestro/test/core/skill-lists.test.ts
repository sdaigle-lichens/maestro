// resolveSkillLists — the one reader of start_skills / end_skills, shared by the app and the
// runtime scripts. Pins the authoritative start_skills object, id cleaning and ordering, and that
// no input can make it throw.

import { describe, it, expect } from "vitest";
import { resolveSkillLists } from "../../src/core/skill-lists.js";

const v3 = (extra: Record<string, unknown>) => ({ version: 3, ...extra });

const EMPTY = { maestroStart: [], toMaestroTasksStart: [], maestroEnd: [] };

describe("resolveSkillLists — no start_skills", () => {
  it("is empty everywhere, and the old gates booleans are never read", () => {
    expect(resolveSkillLists(v3({}))).toEqual(EMPTY);
    expect(
      resolveSkillLists(v3({ gates: { confidence_check: true, use_code_architecture_design_check: true } }))
    ).toEqual(EMPTY);
  });
});

describe("resolveSkillLists — start_skills / end_skills", () => {
  it("reads the three lists as written, in order", () => {
    const r = resolveSkillLists(
      v3({
        start_skills: { maestro: ["b", "a"], to_maestro_tasks: ["c", "d", "e"] },
        end_skills: { maestro: ["z", "y"] },
      })
    );
    expect(r).toEqual({ maestroStart: ["b", "a"], toMaestroTasksStart: ["c", "d", "e"], maestroEnd: ["z", "y"] });
  });

  it("passes plugin-namespaced ids through untouched", () => {
    const r = resolveSkillLists(
      v3({
        start_skills: { maestro: ["concept-skills:use-code-architecture-design-check", "plain"], to_maestro_tasks: [] },
      })
    );
    expect(r.maestroStart).toEqual(["concept-skills:use-code-architecture-design-check", "plain"]);
  });

  it("treats a missing key as an empty list (authoritative, no legacy default)", () => {
    const r = resolveSkillLists(v3({ start_skills: { maestro: ["a"] } }));
    expect(r.maestroStart).toEqual(["a"]);
    expect(r.toMaestroTasksStart).toEqual([]);
    expect(resolveSkillLists(v3({ start_skills: { to_maestro_tasks: ["a"] } })).maestroStart).toEqual([]);
  });

  it("de-duplicates in first-seen order and drops non-strings, empties and ids with whitespace", () => {
    const r = resolveSkillLists(
      v3({ start_skills: { maestro: ["a", "b", "a", "", "  ", 3, null, "c d", " b ", {}, "c"], to_maestro_tasks: [] } })
    );
    expect(r.maestroStart).toEqual(["a", "b", "c"]);
  });

  it("reads end_skills.maestro the same way, with no legacy form", () => {
    expect(resolveSkillLists(v3({})).maestroEnd).toEqual([]);
    expect(resolveSkillLists(v3({ end_skills: { maestro: ["x", "x", "y"] } })).maestroEnd).toEqual(["x", "y"]);
    expect(resolveSkillLists(v3({ end_skills: "x" })).maestroEnd).toEqual([]);
    expect(resolveSkillLists(v3({ end_skills: { maestro: "x" } })).maestroEnd).toEqual([]);
  });

  it("reads empty lists when start_skills is not a plain object", () => {
    for (const bad of [[], "a", 3, null, true]) {
      const r = resolveSkillLists(v3({ start_skills: bad }));
      expect(r.maestroStart, JSON.stringify(bad)).toEqual([]);
      expect(r.toMaestroTasksStart).toEqual([]);
    }
  });

  it("treats a non-array list as empty", () => {
    const r = resolveSkillLists(v3({ start_skills: { maestro: "a", to_maestro_tasks: { 0: "a" } } }));
    expect(r.maestroStart).toEqual([]);
    expect(r.toMaestroTasksStart).toEqual([]);
  });

  it("returns fresh arrays each call", () => {
    const a = resolveSkillLists(null);
    a.toMaestroTasksStart.push("mutated");
    expect(resolveSkillLists(null).toMaestroTasksStart).toEqual([]);
  });
});

describe("resolveSkillLists — degenerate input", () => {
  const degenerate: [string, unknown][] = [
    ["null", null],
    ["undefined", undefined],
    ["a string", "{}"],
    ["a number", 3],
    ["an array", []],
    ["version 2", { version: 2, start_skills: { maestro: ["a"] }, gates: { confidence_check: true } }],
    ["no version", { start_skills: { maestro: ["a"] } }],
    ["version as a string", { version: "3", start_skills: { maestro: ["a"] } }],
  ];
  it.each(degenerate)("%s -> empty lists, no throw", (_l, input) => {
    expect(resolveSkillLists(input)).toEqual(EMPTY);
  });
});
