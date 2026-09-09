// `043`: the Handoffs tab's Create row sources its pair picker from a user-picked project's own
// `agents_available` instead of the bundled 7 agent names — this is the pure piece of that
// decision (what to show / whether Create can work), split out so "no project picked yet" and
// "picked but empty" are each one assertion instead of a DOM query away.

import { describe, it, expect } from "vitest";
import { resolveAgentPickerState } from "../../src/renderer/src/utils/handoff-picker.js";

describe("resolveAgentPickerState", () => {
  it("offers no options and disables Create with no project picked", () => {
    expect(resolveAgentPickerState(null, [])).toEqual({ options: [], createDisabled: true });
    // Even if stale agents from a previously viewed project linger in state, no viewed root wins.
    expect(resolveAgentPickerState(null, ["backend", "test"])).toEqual({ options: [], createDisabled: true });
  });

  it("disables Create when the picked project has no configured agents", () => {
    expect(resolveAgentPickerState("/repo", [])).toEqual({ options: [], createDisabled: true });
  });

  it("populates options from the picked project's real agents and enables Create", () => {
    expect(resolveAgentPickerState("/repo", ["backend", "frontend", "custom-agent"])).toEqual({
      options: ["backend", "frontend", "custom-agent"],
      createDisabled: false,
    });
  });
});
