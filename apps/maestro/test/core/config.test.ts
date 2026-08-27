// mergeSlice — each branch must leave the OTHER slices untouched. workflows/rules already have
// implicit coverage through save.test.ts's round trip; this pins the "project-tags" branch added
// alongside project tags, and re-states the sibling-isolation property for all three at once so a
// widened branch (writing another slice's fields) is caught here rather than three saves later.

import { describe, it, expect } from "vitest";
import { mergeSlice, blankConfig } from "../../src/core/config.js";
import { defaultish } from "./fixtures/configs.js";

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
