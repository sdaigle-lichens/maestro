// `091`: the mark/notice components render nothing when there is nothing dangling (no provider =
// the default empty report), and the reason wording covers every reason the core can return.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import SkillRefMark, {
  SkillRefNotice,
  SKILL_REF_REASON_LABEL,
} from "../../src/renderer/src/components/skill-ref-mark.js";

describe("skill-ref-mark", () => {
  it("labels all four reasons", () => {
    expect(SKILL_REF_REASON_LABEL).toEqual({
      "plugin-not-installed": "plugin not installed",
      "plugin-not-enabled": "plugin not enabled",
      "skill-not-in-plugin": "skill not in plugin",
      "not-found": "not found",
    });
  });

  it("renders nothing for a skill that resolves (empty report)", () => {
    expect(renderToStaticMarkup(createElement(SkillRefMark, { id: "local" }))).toBe("");
  });

  it("renders no notice when there are no suggestions", () => {
    expect(renderToStaticMarkup(createElement(SkillRefNotice))).toBe("");
  });
});
