// The avatar picker's two sources of truth — contracts.ts's part list and the renderer's asset
// manifest — must never silently drift: every id one side names has to resolve to a real PNG the
// other side knows about, or the picker renders a broken image / can't find an option to select.

import { describe, it, expect } from "vitest";

import { AVATAR_CATEGORIES, AVATAR_PARTS } from "../../src/core/contracts.js";
import { AVATAR_LAYER_URLS, AVATAR_RENDER_ORDER } from "../../src/renderer/src/assets/avatar/manifest.js";

describe("avatar contracts/manifest parity", () => {
  it("has a manifest category for every contracts category, and vice versa", () => {
    expect(Object.keys(AVATAR_LAYER_URLS).sort()).toEqual([...AVATAR_CATEGORIES].sort());
  });

  for (const cat of AVATAR_CATEGORIES) {
    it(`${cat}: every AVATAR_PARTS id has a manifest URL, and vice versa`, () => {
      const partIds = AVATAR_PARTS[cat].map((opt) => opt.id).sort();
      const manifestIds = Object.keys(AVATAR_LAYER_URLS[cat]).sort();
      expect(manifestIds).toEqual(partIds);
    });

    it(`${cat}: every manifest URL is a non-empty string`, () => {
      for (const url of Object.values(AVATAR_LAYER_URLS[cat])) {
        expect(typeof url).toBe("string");
        expect(url.length).toBeGreaterThan(0);
      }
    });
  }

  it("AVATAR_RENDER_ORDER is a permutation of AVATAR_CATEGORIES", () => {
    expect([...AVATAR_RENDER_ORDER].sort()).toEqual([...AVATAR_CATEGORIES].sort());
    expect(new Set(AVATAR_RENDER_ORDER).size).toBe(AVATAR_CATEGORIES.length);
  });

  it("body and head are required categories, never optional", () => {
    // Both must always be rendered per the asset-sourcing notes: body is headless (neck down) and
    // head sits in the same frame's empty upper portion — a picker that let either go "none"
    // would leave a hole in the composite.
    expect(AVATAR_CATEGORIES).toContain("body");
    expect(AVATAR_CATEGORIES).toContain("head");
  });
});
