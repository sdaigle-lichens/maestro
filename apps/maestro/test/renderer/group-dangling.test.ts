// `095`: a collapsed plugin group's header indicator — count of dangling skills, plus the reason
// only when they all share one.

import { describe, it, expect } from "vitest";
import { summarizeGroupDangling } from "../../src/renderer/src/utils/group-dangling.js";
import type { DanglingSkillRef } from "../../src/renderer/src/utils/maestro.js";

const refs: Record<string, DanglingSkillRef> = {
  a: { id: "a", reason: "plugin-not-enabled", where: [] },
  b: { id: "b", reason: "plugin-not-enabled", where: [] },
  c: { id: "c", reason: "not-found", where: [] },
};
const find = (id: string) => refs[id];

describe("summarizeGroupDangling", () => {
  it("is zero with no reason when nothing is dangling", () => {
    expect(summarizeGroupDangling(["x", "y"], find)).toEqual({ count: 0, reason: undefined });
    expect(summarizeGroupDangling([], find)).toEqual({ count: 0, reason: undefined });
  });

  it("carries the reason when one skill is dangling", () => {
    expect(summarizeGroupDangling(["x", "c"], find)).toEqual({ count: 1, reason: "not-found" });
  });

  it("carries the shared reason when several dangle for the same cause", () => {
    expect(summarizeGroupDangling(["a", "b", "x"], find)).toEqual({ count: 2, reason: "plugin-not-enabled" });
  });

  it("drops the reason when the reasons differ", () => {
    expect(summarizeGroupDangling(["a", "c"], find)).toEqual({ count: 2, reason: undefined });
  });

  it("counts a repeated id once", () => {
    expect(summarizeGroupDangling(["a", "a"], find)).toEqual({ count: 1, reason: "plugin-not-enabled" });
  });
});
