// mergeSlice — each branch must leave the OTHER slices untouched. workflows/rules already have
// implicit coverage through save.test.ts's round trip; this pins the "project-tags" branch added
// alongside project tags, and re-states the sibling-isolation property for all three at once so a
// widened branch (writing another slice's fields) is caught here rather than three saves later.

import { describe, it, expect } from "vitest";
import { mergeSlice, blankConfig, resolveGates, DEFAULT_GATES } from "../../src/core/config.js";
import type { MaestroConfigV3 } from "../../src/core/types.js";
import { defaultish, withSkillNodes } from "./fixtures/configs.js";

describe("mergeSlice — project-tags", () => {
  it("sets project_tags and leaves every other field untouched", () => {
    const next = mergeSlice(defaultish, { sliceType: "project-tags", slice: { project_tags: ["backend", "mobile"] } });
    expect(next.project_tags).toEqual(["backend", "mobile"]);
    expect(next.agents_available).toBe(defaultish.agents_available);
    expect(next.skills_available).toBe(defaultish.skills_available);
    expect(next.workflow_instances).toBe(defaultish.workflow_instances);
    expect(next.workflows).toBe(defaultish.workflows);
    expect(next.rules).toBe(defaultish.rules);
  });

  it("replaces, not appends — a second save overwrites rather than unions", () => {
    const once = mergeSlice(defaultish, { sliceType: "project-tags", slice: { project_tags: ["backend"] } });
    const twice = mergeSlice(once, { sliceType: "project-tags", slice: { project_tags: ["frontend"] } });
    expect(twice.project_tags).toEqual(["frontend"]);
  });

  it("can clear project_tags back to empty", () => {
    const withTags = mergeSlice(defaultish, { sliceType: "project-tags", slice: { project_tags: ["backend"] } });
    const cleared = mergeSlice(withTags, { sliceType: "project-tags", slice: { project_tags: [] } });
    expect(cleared.project_tags).toEqual([]);
  });

  it("starts absent on a blank config until a project-tags slice is saved", () => {
    expect(blankConfig().project_tags).toBeUndefined();
  });
});

describe("mergeSlice — sibling isolation", () => {
  it("a workflows save doesn't touch project_tags or rules", () => {
    const withTags: typeof defaultish = { ...defaultish, project_tags: ["backend"] };
    const next = mergeSlice(withTags, {
      sliceType: "workflows",
      slice: {
        agents_available: ["frontend"],
        skills_available: [],
        workflow_instances: [],
        workflows: [],
      },
    });
    expect(next.project_tags).toEqual(["backend"]);
    expect(next.rules).toBe(withTags.rules);
  });

  it("a rules save doesn't touch project_tags or the workflow slice", () => {
    const withTags: typeof defaultish = { ...defaultish, project_tags: ["backend"] };
    const next = mergeSlice(withTags, { sliceType: "rules", slice: { rules: [] } });
    expect(next.project_tags).toEqual(["backend"]);
    expect(next.agents_available).toBe(withTags.agents_available);
    expect(next.workflow_instances).toBe(withTags.workflow_instances);
    expect(next.workflows).toBe(withTags.workflows);
  });

  it("a project-tags save doesn't touch the workflow slice or rules", () => {
    const next = mergeSlice(defaultish, { sliceType: "project-tags", slice: { project_tags: ["mobile"] } });
    expect(next.agents_available).toBe(defaultish.agents_available);
    expect(next.workflow_instances).toBe(defaultish.workflow_instances);
    expect(next.workflows).toBe(defaultish.workflows);
    expect(next.rules).toBe(defaultish.rules);
  });
});

describe("mergeSlice — gates", () => {
  it("sets gates and leaves every other field untouched", () => {
    const next = mergeSlice(defaultish, {
      sliceType: "gates",
      slice: { gates: { confidence_check: true, use_design_check: true } },
    });
    expect(next.gates).toEqual({ confidence_check: true, use_design_check: true });
    expect(next.agents_available).toBe(defaultish.agents_available);
    expect(next.skills_available).toBe(defaultish.skills_available);
    expect(next.workflow_instances).toBe(defaultish.workflow_instances);
    expect(next.workflows).toBe(defaultish.workflows);
    expect(next.rules).toBe(defaultish.rules);
    expect(next.project_tags).toBeUndefined();
  });

  it("replaces rather than merges — unchecking a box actually writes false", () => {
    const on = mergeSlice(defaultish, {
      sliceType: "gates",
      slice: { gates: { confidence_check: true, use_design_check: true } },
    });
    const off = mergeSlice(on, {
      sliceType: "gates",
      slice: { gates: { confidence_check: false, use_design_check: false } },
    });
    expect(off.gates).toEqual({ confidence_check: false, use_design_check: false });
  });

  it("starts absent on a blank config until a gates slice is saved", () => {
    expect(blankConfig().gates).toBeUndefined();
  });

  // The whole point of turning the `else` catch-all into an explicit arm: the slice added AFTER
  // this one would otherwise have inherited the gates write, silently.
  it("leaves gates alone on every other slice's save, and vice versa", () => {
    const withGates = mergeSlice(defaultish, {
      sliceType: "gates",
      slice: { gates: { confidence_check: true, use_design_check: false } },
    });

    const afterWorkflows = mergeSlice(withGates, {
      sliceType: "workflows",
      slice: { agents_available: ["frontend"], skills_available: [], workflow_instances: [], workflows: [] },
    });
    expect(afterWorkflows.gates).toEqual({ confidence_check: true, use_design_check: false });

    const afterRules = mergeSlice(withGates, { sliceType: "rules", slice: { rules: [] } });
    expect(afterRules.gates).toEqual({ confidence_check: true, use_design_check: false });

    const afterTags = mergeSlice(withGates, { sliceType: "project-tags", slice: { project_tags: ["mobile"] } });
    expect(afterTags.gates).toEqual({ confidence_check: true, use_design_check: false });

    // …and the other direction: a gates save disturbs none of the three.
    const tagged = mergeSlice(withGates, { sliceType: "project-tags", slice: { project_tags: ["backend"] } });
    const afterGates = mergeSlice(tagged, {
      sliceType: "gates",
      slice: { gates: { confidence_check: false, use_design_check: true } },
    });
    expect(afterGates.project_tags).toEqual(["backend"]);
    expect(afterGates.rules).toBe(tagged.rules);
    expect(afterGates.workflows).toBe(tagged.workflows);
    expect(afterGates.workflow_instances).toBe(tagged.workflow_instances);
    expect(afterGates.agents_available).toBe(tagged.agents_available);
    expect(afterGates.skills_available).toBe(tagged.skills_available);
  });
});

describe("resolveGates", () => {
  it("reads a well-formed block as written", () => {
    expect(resolveGates(withSkillNodes)).toEqual({ confidence_check: true, use_design_check: false });
  });

  it("resolves an absent block, and a null config, to both off", () => {
    expect(resolveGates(defaultish)).toEqual(DEFAULT_GATES);
    expect(resolveGates(null)).toEqual(DEFAULT_GATES);
  });

  it("resolves a partial block per field, filling the missing one with false", () => {
    const cfg = { ...defaultish, gates: { use_design_check: true } } as unknown as MaestroConfigV3;
    expect(resolveGates(cfg)).toEqual({ confidence_check: false, use_design_check: true });
  });

  // Strict `=== true` throughout: this is the difference between "skip" and a gate that turns
  // itself on because someone hand-edited the file with a string.
  it("resolves every non-boolean value to off rather than to something truthy", () => {
    for (const bad of ["true", 1, {}, [], "yes"]) {
      const cfg = {
        ...defaultish,
        gates: { confidence_check: bad, use_design_check: bad },
      } as unknown as MaestroConfigV3;
      expect(resolveGates(cfg), `${JSON.stringify(bad)} must resolve to off`).toEqual(DEFAULT_GATES);
    }
  });

  it("resolves a gates field that is not a plain object to both off", () => {
    for (const bad of [[], "gates", 3, true, null]) {
      const cfg = { ...defaultish, gates: bad } as unknown as MaestroConfigV3;
      expect(resolveGates(cfg)).toEqual(DEFAULT_GATES);
    }
  });

  it("returns a fresh object each time, so a caller cannot mutate DEFAULT_GATES", () => {
    const a = resolveGates(null);
    a.confidence_check = true;
    expect(DEFAULT_GATES.confidence_check).toBe(false);
    expect(resolveGates(null).confidence_check).toBe(false);
  });
});
