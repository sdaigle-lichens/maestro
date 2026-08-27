// Asset URL map for the agent avatar picker.
//
// Every PNG is imported individually (there are only 30-odd) so Vite fingerprints each one and
// resolves it correctly under the packaged `file://` build's `base: "./"`. Do NOT put these in
// `public/` and reference them by absolute path — that breaks in the packaged app even though it
// works fine under `pnpm dev`. See apps/maestro/CLAUDE.md's "things that bite" section.
//
// `torso`, `legs`, and `feet` are BODY-VARIANT-AWARE. Measured by compositing: the upstream LPC
// pack crops every worn item to fit a specific body silhouette. For torso the pack literally
// labels the two cuts `male`/`female`. Legs and feet have no folder named `female` at all — only
// `male` and `thin` — but `CREDITS.csv`'s own notes settle what `thin` actually is: the pants row
// reads "original male pants by wulax, edited for **female** by Joe White," and the shoes row
// "edited for **female** base by Joe White." `thin` is the female cut under a body-shape name
// rather than a gender name. Composited side by side, `female body + male-cut pants` shows a
// visible gap at the waistline (the pants are cut for the wider male hip); `female body + thin-cut
// pants` aligns cleanly. `hat`/`hair`/`eyes` are NOT variant-aware: the upstream pack has only one
// `adult` cut for hats and no gendered cut for eyes either, so there is nothing to select between.
// See `AVATAR_PARTS`'s doc comment in contracts.ts for why there is no "Child" body/head option.

import bodyMale from "./body/male.png";
import bodyFemale from "./body/female.png";

import headMale from "./head/male.png";
import headFemale from "./head/female.png";

import eyesBrows from "./eyes/brows.png";
import eyesCyclops from "./eyes/cyclops.png";
import eyesCyclops2 from "./eyes/cyclops2.png";

import hairPlain from "./hair/plain.png";
import hairBangslong from "./hair/bangslong.png";
import hairBob from "./hair/bob.png";
import hairBuzzcut from "./hair/buzzcut.png";
import hairDreadlocksShort from "./hair/dreadlocks_short.png";

import torsoTshirtMale from "./torso/tshirt/male.png";
import torsoTshirtFemale from "./torso/tshirt/female.png";
import torsoTshirtButtonedMale from "./torso/tshirt_buttoned/male.png";
import torsoTshirtButtonedFemale from "./torso/tshirt_buttoned/female.png";
import torsoLeatherArmourMale from "./torso/leather_armour/male.png";
import torsoLeatherArmourFemale from "./torso/leather_armour/female.png";
import torsoPlateArmourMale from "./torso/plate_armour/male.png";
import torsoPlateArmourFemale from "./torso/plate_armour/female.png";

import legsPantsMale from "./legs/pants/male.png";
import legsPantsFemale from "./legs/pants/female.png";
import legsShortsMale from "./legs/shorts/male.png";
import legsShortsFemale from "./legs/shorts/female.png";
import legsSkirtPlainMale from "./legs/skirt_plain/male.png";
import legsSkirtPlainFemale from "./legs/skirt_plain/female.png";
import legsSkirtLegionMale from "./legs/skirt_legion/male.png";
import legsSkirtLegionFemale from "./legs/skirt_legion/female.png";

import feetShoesBasicMale from "./feet/shoes_basic/male.png";
import feetShoesBasicFemale from "./feet/shoes_basic/female.png";
import feetBootsBasicMale from "./feet/boots_basic/male.png";
import feetBootsBasicFemale from "./feet/boots_basic/female.png";
import feetSandalsMale from "./feet/sandals/male.png";
import feetSandalsFemale from "./feet/sandals/female.png";
import feetShoesGhilliesMale from "./feet/shoes_ghillies/male.png";
import feetShoesGhilliesFemale from "./feet/shoes_ghillies/female.png";

import hatBandana from "./hat/bandana.png";
import hatBowler from "./hat/bowler.png";
import hatCrown from "./hat/crown.png";
import hatBarbarianHelmet from "./hat/barbarian_helmet.png";

import type { AvatarCategory } from "../../../../core/contracts.js";

/** The two body silhouettes a variant-aware garment is cut for. Anything but "female" gets "male". */
export type BodyVariant = "male" | "female";

/** Categories whose options are cut per body silhouette, rather than one size fitting both. */
export const BODY_VARIANT_CATEGORIES = ["torso", "legs", "feet"] as const;
export type BodyVariantCategory = (typeof BODY_VARIANT_CATEGORIES)[number];

function isBodyVariantCategory(cat: AvatarCategory): cat is BodyVariantCategory {
  return (BODY_VARIANT_CATEGORIES as readonly string[]).includes(cat);
}

type VariantMap = Record<BodyVariant, string>;

export const AVATAR_LAYER_URLS: {
  body: Record<string, string>;
  head: Record<string, string>;
  eyes: Record<string, string>;
  hair: Record<string, string>;
  torso: Record<string, VariantMap>;
  legs: Record<string, VariantMap>;
  feet: Record<string, VariantMap>;
  hat: Record<string, string>;
} = {
  body: { male: bodyMale, female: bodyFemale },
  head: { male: headMale, female: headFemale },
  eyes: { brows: eyesBrows, cyclops: eyesCyclops, cyclops2: eyesCyclops2 },
  hair: {
    plain: hairPlain,
    bangslong: hairBangslong,
    bob: hairBob,
    buzzcut: hairBuzzcut,
    dreadlocks_short: hairDreadlocksShort,
  },
  torso: {
    tshirt: { male: torsoTshirtMale, female: torsoTshirtFemale },
    tshirt_buttoned: { male: torsoTshirtButtonedMale, female: torsoTshirtButtonedFemale },
    leather_armour: { male: torsoLeatherArmourMale, female: torsoLeatherArmourFemale },
    plate_armour: { male: torsoPlateArmourMale, female: torsoPlateArmourFemale },
  },
  legs: {
    pants: { male: legsPantsMale, female: legsPantsFemale },
    shorts: { male: legsShortsMale, female: legsShortsFemale },
    skirt_plain: { male: legsSkirtPlainMale, female: legsSkirtPlainFemale },
    skirt_legion: { male: legsSkirtLegionMale, female: legsSkirtLegionFemale },
  },
  feet: {
    shoes_basic: { male: feetShoesBasicMale, female: feetShoesBasicFemale },
    boots_basic: { male: feetBootsBasicMale, female: feetBootsBasicFemale },
    sandals: { male: feetSandalsMale, female: feetSandalsFemale },
    shoes_ghillies: { male: feetShoesGhilliesMale, female: feetShoesGhilliesFemale },
  },
  hat: { bandana: hatBandana, bowler: hatBowler, crown: hatCrown, barbarian_helmet: hatBarbarianHelmet },
};

/**
 * The URL for one layer's option, given the currently selected body — the one lookup that knows
 * `torso`/`legs`/`feet` are nested by body variant and everything else is flat. Every call site
 * (the canvas, the picker's swatches) goes through this rather than indexing `AVATAR_LAYER_URLS`
 * directly, so a future body-variant-aware category only needs an entry in
 * `BODY_VARIANT_CATEGORIES`, not a change at every call site.
 */
export function resolveAvatarUrl(category: AvatarCategory, id: string, bodyId: string | null): string | undefined {
  if (isBodyVariantCategory(category)) {
    const variant: BodyVariant = bodyId === "female" ? "female" : "male";
    return AVATAR_LAYER_URLS[category][id]?.[variant];
  }
  return (AVATAR_LAYER_URLS[category] as Record<string, string>)[id];
}

/**
 * Bottom to top — verified by compositing in the prototyping session (body+legs+feet+torso+head+
 * eyes+hair at (0,0) on a 64x64 canvas produced a correctly-aligned character; hat goes last, on
 * top of hair). Deliberately NOT the same order as `AVATAR_CATEGORIES` (which is display order for
 * the picker's rows) — a body is drawn under its legs and feet, not over them.
 */
export const AVATAR_RENDER_ORDER: AvatarCategory[] = ["body", "legs", "feet", "torso", "head", "eyes", "hair", "hat"];
