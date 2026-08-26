// Asset URL map for the agent avatar picker.
//
// Every PNG is imported individually (there are only 30) so Vite fingerprints each one and
// resolves it correctly under the packaged `file://` build's `base: "./"`. Do NOT put these in
// `public/` and reference them by absolute path — that breaks in the packaged app even though it
// works fine under `pnpm dev`. See apps/maestro/CLAUDE.md's "things that bite" section.

import bodyMale from "./body/male.png";
import bodyFemale from "./body/female.png";
import bodyChild from "./body/child.png";

import headMale from "./head/male.png";
import headFemale from "./head/female.png";
import headChild from "./head/child.png";

import eyesHuman from "./eyes/human.png";
import eyesCyclops from "./eyes/cyclops.png";
import eyesCyclops2 from "./eyes/cyclops2.png";

import hairPlain from "./hair/plain.png";
import hairBangslong from "./hair/bangslong.png";
import hairBob from "./hair/bob.png";
import hairBuzzcut from "./hair/buzzcut.png";
import hairDreadlocksShort from "./hair/dreadlocks_short.png";

import torsoTshirt from "./torso/tshirt.png";
import torsoTshirtButtoned from "./torso/tshirt_buttoned.png";
import torsoLeatherArmour from "./torso/leather_armour.png";
import torsoPlateArmour from "./torso/plate_armour.png";

import legsPants from "./legs/pants.png";
import legsShorts from "./legs/shorts.png";
import legsSkirtPlain from "./legs/skirt_plain.png";
import legsSkirtLegion from "./legs/skirt_legion.png";

import feetShoesBasic from "./feet/shoes_basic.png";
import feetBootsBasic from "./feet/boots_basic.png";
import feetSandals from "./feet/sandals.png";
import feetShoesGhillies from "./feet/shoes_ghillies.png";

import hatBandana from "./hat/bandana.png";
import hatBowler from "./hat/bowler.png";
import hatCrown from "./hat/crown.png";
import hatBarbarianHelmet from "./hat/barbarian_helmet.png";

import type { AvatarCategory } from "../../../../core/contracts.js";

export const AVATAR_LAYER_URLS: Record<AvatarCategory, Record<string, string>> = {
  body: { male: bodyMale, female: bodyFemale, child: bodyChild },
  head: { male: headMale, female: headFemale, child: headChild },
  eyes: { human: eyesHuman, cyclops: eyesCyclops, cyclops2: eyesCyclops2 },
  hair: {
    plain: hairPlain,
    bangslong: hairBangslong,
    bob: hairBob,
    buzzcut: hairBuzzcut,
    dreadlocks_short: hairDreadlocksShort,
  },
  torso: {
    tshirt: torsoTshirt,
    tshirt_buttoned: torsoTshirtButtoned,
    leather_armour: torsoLeatherArmour,
    plate_armour: torsoPlateArmour,
  },
  legs: {
    pants: legsPants,
    shorts: legsShorts,
    skirt_plain: legsSkirtPlain,
    skirt_legion: legsSkirtLegion,
  },
  feet: {
    shoes_basic: feetShoesBasic,
    boots_basic: feetBootsBasic,
    sandals: feetSandals,
    shoes_ghillies: feetShoesGhillies,
  },
  hat: { bandana: hatBandana, bowler: hatBowler, crown: hatCrown, barbarian_helmet: hatBarbarianHelmet },
};

/**
 * Bottom to top — verified by compositing in the prototyping session (body+legs+feet+torso+head+
 * eyes+hair at (0,0) on a 64x64 canvas produced a correctly-aligned character; hat goes last, on
 * top of hair). Deliberately NOT the same order as `AVATAR_CATEGORIES` (which is display order for
 * the picker's rows) — a body is drawn under its legs and feet, not over them.
 */
export const AVATAR_RENDER_ORDER: AvatarCategory[] = ["body", "legs", "feet", "torso", "head", "eyes", "hair", "hat"];
