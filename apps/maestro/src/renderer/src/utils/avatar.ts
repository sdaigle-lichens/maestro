// Pure renderer-side helpers for the agent avatar picker. No IPC — randomization is client-side
// data already available via `contracts.ts`.

import {
  AVATAR_CATEGORIES,
  AVATAR_PARTS,
  AVATAR_REQUIRED_CATEGORIES,
  EYE_RECOLOR_SHAPES,
  HAIR_RECOLOR_SHAPES,
  type AvatarCategory,
  type AvatarLayers,
} from "../../../core/contracts.js";

/** A small, legible spread for `randomAvatarLayers`'s eye color — not the full color-picker range. */
const RANDOM_EYE_COLORS = ["#1c1c1c", "#3a2317", "#6b4423", "#a0522d", "#c9a227", "#7a4a1f", "#4b3b2a"];

/** Same idea for hair — natural shades plus a couple of unnatural ones, since hair actually carries those in real life. */
const RANDOM_HAIR_COLORS = [
  "#1c1c1c",
  "#3a2317",
  "#6b4423",
  "#a0522d",
  "#c9a227",
  "#7a4a1f",
  "#4b3b2a",
  "#e5e5e5",
  "#8b5fbf",
];

/**
 * A representative "native" swatch color per recolorable shape — what the color picker shows as
 * its own default value/preview when no override is set, instead of one fixed color unrelated to
 * what the shape actually looks like. Each entry is the weighted average RGB over every opaque
 * pixel of the shipped PNG, sampled offline (see the eyes/hair color-picker work) — a reasonable
 * single-color stand-in for "what this shape looks like unrecolored", since `recolorImage()` only
 * ever replaces hue+saturation and leaves lightness (the shape's own shading) alone.
 */
export const NATIVE_EYES_COLORS: Record<string, string> = {
  brows: "#972402",
  brows_thin: "#871c04",
};

export const NATIVE_HAIR_COLORS: Record<string, string> = {
  plain: "#8a2d08",
  bangslong: "#822807",
  bob: "#aa3b04",
  buzzcut: "#8d2b06",
  dreadlocks_short: "#902d06",
  pixie: "#892906",
  afro: "#a73804",
  curly_short: "#8b2e07",
  mop: "#a23203",
  cornrows: "#872706",
  unkempt: "#882907",
  high_and_tight: "#7a2004",
  flat_top_fade: "#a93e05",
  curly_short2: "#9d3004",
  spiked: "#a23604",
  cowlick: "#a93703",
  jewfro: "#732009",
  natural: "#ad3e04",
  longhawk: "#812908",
  swoop: "#922f06",
};

/** Only reached for a shape id with no sampled entry, which parity tests rule out. */
const FALLBACK_NATIVE_COLOR = "#4a2e1a";

/** The color picker's default value for `eyesColor` — the selected shape's own native color. */
export function nativeEyesColor(id: string | null): string {
  return (id !== null && NATIVE_EYES_COLORS[id]) || FALLBACK_NATIVE_COLOR;
}

/** Same, for `hairColor`. */
export function nativeHairColor(id: string | null): string {
  return (id !== null && NATIVE_HAIR_COLORS[id]) || FALLBACK_NATIVE_COLOR;
}

/**
 * The placeholder an agent with no saved avatar renders as: the first option of every category
 * except `hat`, which stays empty.
 *
 * `sex`/`eyes`/`torso`/`legs` are the categories the store never lets go empty; `hair`/`feet` are
 * optional but default to a first option here anyway so most rows of /agents (which have never
 * been customised) still render fully dressed. A hat is the one part left off: it reads as a
 * choice rather than a default.
 */
export function defaultAvatarLayers(): AvatarLayers {
  const layers = {} as AvatarLayers;
  for (const cat of AVATAR_CATEGORIES) layers[cat] = cat === "hat" ? null : AVATAR_PARTS[cat][0].id;
  return layers;
}

export function randomAvatarLayers(): AvatarLayers {
  const layers = {} as AvatarLayers;
  for (const cat of AVATAR_CATEGORIES) {
    const options = AVATAR_PARTS[cat];
    const required = (AVATAR_REQUIRED_CATEGORIES as readonly AvatarCategory[]).includes(cat);
    // required categories always pick one; optional categories get a chance at "none"
    if (!required && Math.random() < 0.4) {
      layers[cat] = null;
    } else {
      layers[cat] = options[Math.floor(Math.random() * options.length)].id;
    }
  }
  const eyesId = layers.eyes;
  layers.eyesColor =
    eyesId && EYE_RECOLOR_SHAPES.includes(eyesId) && Math.random() < 0.6
      ? RANDOM_EYE_COLORS[Math.floor(Math.random() * RANDOM_EYE_COLORS.length)]
      : null;
  const hairId = layers.hair;
  layers.hairColor =
    hairId && HAIR_RECOLOR_SHAPES.includes(hairId) && Math.random() < 0.6
      ? RANDOM_HAIR_COLORS[Math.floor(Math.random() * RANDOM_HAIR_COLORS.length)]
      : null;
  return layers;
}
