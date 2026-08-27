// The avatar picker's two sources of truth — contracts.ts's part list and the renderer's asset
// manifest — must never silently drift: every id one side names has to resolve to a real PNG the
// other side knows about, or the picker renders a broken image / can't find an option to select.
//
// `torso`/`legs`/`feet` are nested by body variant (male/female) rather than flat like every other
// category — see `resolveAvatarUrl` in manifest.ts — so they get their own parity check instead of
// the generic loop.

import { describe, it, expect } from "vitest";

import { AVATAR_CATEGORIES, AVATAR_PARTS, type AvatarCategory } from "../../src/core/contracts.js";
import {
  AVATAR_LAYER_URLS,
  AVATAR_RENDER_ORDER,
  BODY_VARIANT_CATEGORIES,
  resolveAvatarUrl,
  type BodyVariantCategory,
} from "../../src/renderer/src/assets/avatar/manifest.js";

const VARIANT_SET: readonly string[] = BODY_VARIANT_CATEGORIES;
const FLAT_CATEGORIES = AVATAR_CATEGORIES.filter(
  (cat): cat is Exclude<AvatarCategory, BodyVariantCategory> => !VARIANT_SET.includes(cat)
);

describe("avatar contracts/manifest parity", () => {
  it("has a manifest category for every contracts category, and vice versa", () => {
    expect(Object.keys(AVATAR_LAYER_URLS).sort()).toEqual([...AVATAR_CATEGORIES].sort());
  });

  for (const cat of FLAT_CATEGORIES) {
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

  for (const cat of BODY_VARIANT_CATEGORIES) {
    it(`${cat}: every AVATAR_PARTS id has a manifest entry, and vice versa`, () => {
      const partIds = AVATAR_PARTS[cat].map((opt) => opt.id).sort();
      const manifestIds = Object.keys(AVATAR_LAYER_URLS[cat]).sort();
      expect(manifestIds).toEqual(partIds);
    });

    it(`${cat}: every id has both a male and a female variant, each a non-empty string`, () => {
      for (const opt of AVATAR_PARTS[cat]) {
        const variants = AVATAR_LAYER_URLS[cat][opt.id];
        expect(variants).toBeDefined();
        for (const bodyId of ["male", "female"] as const) {
          expect(typeof variants[bodyId]).toBe("string");
          expect(variants[bodyId].length).toBeGreaterThan(0);
        }
      }
    });

    it(`${cat}: resolveAvatarUrl picks the matching variant, and falls back to male for anything else`, () => {
      for (const opt of AVATAR_PARTS[cat]) {
        expect(resolveAvatarUrl(cat, opt.id, "female")).toBe(AVATAR_LAYER_URLS[cat][opt.id].female);
        expect(resolveAvatarUrl(cat, opt.id, "male")).toBe(AVATAR_LAYER_URLS[cat][opt.id].male);
        expect(resolveAvatarUrl(cat, opt.id, null)).toBe(AVATAR_LAYER_URLS[cat][opt.id].male);
      }
    });

    it(`${cat}: the male and female crops are actually different files (not one variant aliased to the other)`, () => {
      for (const opt of AVATAR_PARTS[cat]) {
        const variants = AVATAR_LAYER_URLS[cat][opt.id];
        expect(variants.male).not.toBe(variants.female);
      }
    });
  }

  it("resolveAvatarUrl is a passthrough for every flat category", () => {
    for (const cat of FLAT_CATEGORIES) {
      for (const opt of AVATAR_PARTS[cat]) {
        expect(resolveAvatarUrl(cat, opt.id, "female")).toBe(AVATAR_LAYER_URLS[cat][opt.id]);
      }
    }
  });

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

  it("body/head have no Child option — every worn layer is cut for an adult frame", () => {
    expect(AVATAR_PARTS.body.map((o) => o.id)).not.toContain("child");
    expect(AVATAR_PARTS.head.map((o) => o.id)).not.toContain("child");
  });
});
