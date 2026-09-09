// The avatar picker's two sources of truth — contracts.ts's part list and the renderer's asset
// manifest — must never silently drift: every id one side names has to resolve to a real PNG the
// other side knows about, or the picker renders a broken image / can't find an option to select.
//
// `torso`/`legs`/`feet` are nested by body variant (male/female) rather than flat like every other
// category — see `resolveAvatarUrl` in manifest.ts — so they get their own parity check instead of
// the generic loop.

import { describe, it, expect } from "vitest";

import {
  AVATAR_CATEGORIES,
  AVATAR_PARTS,
  AVATAR_REQUIRED_CATEGORIES,
  EYE_RECOLOR_SHAPES,
  HAIR_RECOLOR_SHAPES,
  HEX_COLOR_RE,
  type AvatarCategory,
} from "../../src/core/contracts.js";
import {
  AVATAR_LAYER_URLS,
  AVATAR_RENDER_ORDER,
  BODY_VARIANT_CATEGORIES,
  SEX_LAYER_URLS,
  resolveAvatarUrl,
  type BodyVariantCategory,
} from "../../src/renderer/src/assets/avatar/manifest.js";
import { NATIVE_EYES_COLORS, NATIVE_HAIR_COLORS } from "../../src/renderer/src/utils/avatar.js";

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

  it("sex/eyes/torso/legs are required categories, never optional", () => {
    // sex must always be rendered (a picker that let it go "none" would leave a hole where the
    // body/head silhouette belongs), and torso/legs no longer offer a "naked" none option either.
    expect(AVATAR_REQUIRED_CATEGORIES).toContain("sex");
    expect(AVATAR_REQUIRED_CATEGORIES).toContain("eyes");
    expect(AVATAR_REQUIRED_CATEGORIES).toContain("torso");
    expect(AVATAR_REQUIRED_CATEGORIES).toContain("legs");
  });

  it("hair/feet/hat stay optional", () => {
    expect(AVATAR_REQUIRED_CATEGORIES).not.toContain("hair");
    expect(AVATAR_REQUIRED_CATEGORIES).not.toContain("feet");
    expect(AVATAR_REQUIRED_CATEGORIES).not.toContain("hat");
  });

  it("sex has no Child option — every worn layer is cut for an adult frame", () => {
    expect(AVATAR_PARTS.sex.map((o) => o.id)).not.toContain("child");
  });

  it("SEX_LAYER_URLS has a body and a head URL for every sex option, and they differ", () => {
    for (const opt of AVATAR_PARTS.sex) {
      expect(typeof SEX_LAYER_URLS.body[opt.id]).toBe("string");
      expect(typeof SEX_LAYER_URLS.head[opt.id]).toBe("string");
      expect(SEX_LAYER_URLS.body[opt.id]).not.toBe(SEX_LAYER_URLS.head[opt.id]);
    }
  });

  it("AVATAR_LAYER_URLS.sex is the same object as SEX_LAYER_URLS.body — one swatch thumbnail source", () => {
    expect(AVATAR_LAYER_URLS.sex).toBe(SEX_LAYER_URLS.body);
  });

  it("every EYE_RECOLOR_SHAPES id names a real eyes option", () => {
    const eyeIds = AVATAR_PARTS.eyes.map((o) => o.id);
    for (const id of EYE_RECOLOR_SHAPES) expect(eyeIds).toContain(id);
  });

  it("every HAIR_RECOLOR_SHAPES id names a real hair option, and vice versa", () => {
    const hairIds = AVATAR_PARTS.hair.map((o) => o.id);
    expect([...HAIR_RECOLOR_SHAPES].sort()).toEqual([...hairIds].sort());
  });

  it("every EYE_RECOLOR_SHAPES id has a sampled native color, and vice versa", () => {
    expect(Object.keys(NATIVE_EYES_COLORS).sort()).toEqual([...EYE_RECOLOR_SHAPES].sort());
    for (const hex of Object.values(NATIVE_EYES_COLORS)) expect(HEX_COLOR_RE.test(hex)).toBe(true);
  });

  it("every HAIR_RECOLOR_SHAPES id has a sampled native color, and vice versa", () => {
    expect(Object.keys(NATIVE_HAIR_COLORS).sort()).toEqual([...HAIR_RECOLOR_SHAPES].sort());
    for (const hex of Object.values(NATIVE_HAIR_COLORS)) expect(HEX_COLOR_RE.test(hex)).toBe(true);
  });

  it("HEX_COLOR_RE accepts #rrggbb and rejects everything else", () => {
    expect(HEX_COLOR_RE.test("#a0522d")).toBe(true);
    expect(HEX_COLOR_RE.test("#FFF")).toBe(false);
    expect(HEX_COLOR_RE.test("a0522d")).toBe(false);
    expect(HEX_COLOR_RE.test("chartreuse")).toBe(false);
  });
});
