// Asset URL map for the agent avatar picker.
//
// Every PNG is imported individually so Vite fingerprints each one and resolves it correctly under
// the packaged `file://` build's `base: "./"`. Do NOT put these in `public/` and reference them by
// absolute path — that breaks in the packaged app even though it works fine under `pnpm dev`. See
// apps/maestro/CLAUDE.md's "things that bite" section.
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
// See `AVATAR_PARTS`'s doc comment in contracts.ts for why there is no "Child" option.
//
// `sex` is the one category that is not itself drawn once: it drives TWO fixed extra layers — the
// body silhouette and the head silhouette, imported below as `SEX_LAYER_URLS` — because the
// upstream pack ships those as two separately-cropped images that must always agree on the same
// male/female choice. `AVATAR_LAYER_URLS.sex` reuses the body images as the picker swatch's
// thumbnail; `avatar-canvas.tsx` draws the head layer as a second, explicit step.

import bodyMale from "./body/male.png";
import bodyFemale from "./body/female.png";

import headMale from "./head/male.png";
import headFemale from "./head/female.png";

import eyesBrows from "./eyes/brows.png";
import eyesCyclops from "./eyes/cyclops.png";
import eyesCyclops2 from "./eyes/cyclops2.png";
import eyesBrowsThin from "./eyes/brows_thin.png";

import hairPlain from "./hair/plain.png";
import hairBangslong from "./hair/bangslong.png";
import hairBob from "./hair/bob.png";
import hairBuzzcut from "./hair/buzzcut.png";
import hairDreadlocksShort from "./hair/dreadlocks_short.png";
import hairPixie from "./hair/pixie.png";
import hairAfro from "./hair/afro.png";
import hairCurlyShort from "./hair/curly_short.png";
import hairMop from "./hair/mop.png";
import hairCornrows from "./hair/cornrows.png";
import hairUnkempt from "./hair/unkempt.png";
import hairHighAndTight from "./hair/high_and_tight.png";
import hairFlatTopFade from "./hair/flat_top_fade.png";
import hairCurlyShort2 from "./hair/curly_short2.png";
import hairSpiked from "./hair/spiked.png";
import hairCowlick from "./hair/cowlick.png";
import hairJewfro from "./hair/jewfro.png";
import hairNatural from "./hair/natural.png";
import hairLonghawk from "./hair/longhawk.png";
import hairSwoop from "./hair/swoop.png";

import torsoTshirtMale from "./torso/tshirt/male.png";
import torsoTshirtFemale from "./torso/tshirt/female.png";
import torsoTshirtButtonedMale from "./torso/tshirt_buttoned/male.png";
import torsoTshirtButtonedFemale from "./torso/tshirt_buttoned/female.png";
import torsoLeatherArmourMale from "./torso/leather_armour/male.png";
import torsoLeatherArmourFemale from "./torso/leather_armour/female.png";
import torsoPlateArmourMale from "./torso/plate_armour/male.png";
import torsoPlateArmourFemale from "./torso/plate_armour/female.png";
import torsoChainmailMale from "./torso/chainmail/male.png";
import torsoChainmailFemale from "./torso/chainmail/female.png";
import torsoLegionArmourMale from "./torso/legion_armour/male.png";
import torsoLegionArmourFemale from "./torso/legion_armour/female.png";
import torsoLongsleeveMale from "./torso/longsleeve/male.png";
import torsoLongsleeveFemale from "./torso/longsleeve/female.png";
import torsoPoloMale from "./torso/polo/male.png";
import torsoPoloFemale from "./torso/polo/female.png";
import torsoVneckMale from "./torso/vneck/male.png";
import torsoVneckFemale from "./torso/vneck/female.png";
import torsoOverallsMale from "./torso/overalls/male.png";
import torsoOverallsFemale from "./torso/overalls/female.png";
import torsoSuspendersMale from "./torso/suspenders/male.png";
import torsoSuspendersFemale from "./torso/suspenders/female.png";
import torsoShortsleevePlainMale from "./torso/shortsleeve_plain/male.png";
import torsoShortsleevePlainFemale from "./torso/shortsleeve_plain/female.png";
import torsoHenleyMale from "./torso/henley/male.png";
import torsoHenleyFemale from "./torso/henley/female.png";
import torsoScoopSweaterMale from "./torso/scoop_sweater/male.png";
import torsoScoopSweaterFemale from "./torso/scoop_sweater/female.png";
import torsoScoopTeeMale from "./torso/scoop_tee/male.png";
import torsoScoopTeeFemale from "./torso/scoop_tee/female.png";
import torsoSleeveless2Male from "./torso/sleeveless2/male.png";
import torsoSleeveless2Female from "./torso/sleeveless2/female.png";
import torsoLongsleeveButtonedMale from "./torso/longsleeve_buttoned/male.png";
import torsoLongsleeveButtonedFemale from "./torso/longsleeve_buttoned/female.png";
import torsoLongsleeveVneckMale from "./torso/longsleeve_vneck/male.png";
import torsoLongsleeveVneckFemale from "./torso/longsleeve_vneck/female.png";

import legsPantsMale from "./legs/pants/male.png";
import legsPantsFemale from "./legs/pants/female.png";
import legsShortsMale from "./legs/shorts/male.png";
import legsShortsFemale from "./legs/shorts/female.png";
import legsSkirtPlainMale from "./legs/skirt_plain/male.png";
import legsSkirtPlainFemale from "./legs/skirt_plain/female.png";
import legsSkirtLegionMale from "./legs/skirt_legion/male.png";
import legsSkirtLegionFemale from "./legs/skirt_legion/female.png";
import legsFormalMale from "./legs/formal/male.png";
import legsFormalFemale from "./legs/formal/female.png";
import legsCuffedMale from "./legs/cuffed/male.png";
import legsCuffedFemale from "./legs/cuffed/female.png";
import legsLeggingsMale from "./legs/leggings/male.png";
import legsLeggingsFemale from "./legs/leggings/female.png";
import legsHoseMale from "./legs/hose/male.png";
import legsHoseFemale from "./legs/hose/female.png";
import legsPantaloonsMale from "./legs/pantaloons/male.png";
import legsPantaloonsFemale from "./legs/pantaloons/female.png";
import legsFormalStripedMale from "./legs/formal_striped/male.png";
import legsFormalStripedFemale from "./legs/formal_striped/female.png";
import legsLeggings2Male from "./legs/leggings2/male.png";
import legsLeggings2Female from "./legs/leggings2/female.png";
import legsPlateGreavesMale from "./legs/plate_greaves/male.png";
import legsPlateGreavesFemale from "./legs/plate_greaves/female.png";
import legsCargoPantsMale from "./legs/cargo_pants/male.png";
import legsCargoPantsFemale from "./legs/cargo_pants/female.png";

import feetShoesBasicMale from "./feet/shoes_basic/male.png";
import feetShoesBasicFemale from "./feet/shoes_basic/female.png";
import feetBootsBasicMale from "./feet/boots_basic/male.png";
import feetBootsBasicFemale from "./feet/boots_basic/female.png";
import feetSandalsMale from "./feet/sandals/male.png";
import feetSandalsFemale from "./feet/sandals/female.png";
import feetShoesGhilliesMale from "./feet/shoes_ghillies/male.png";
import feetShoesGhilliesFemale from "./feet/shoes_ghillies/female.png";
import feetBootsFoldMale from "./feet/boots_fold/male.png";
import feetBootsFoldFemale from "./feet/boots_fold/female.png";
import feetBootsRimmedMale from "./feet/boots_rimmed/male.png";
import feetBootsRimmedFemale from "./feet/boots_rimmed/female.png";
import feetSlippersMale from "./feet/slippers/male.png";
import feetSlippersFemale from "./feet/slippers/female.png";
import feetSocksHighMale from "./feet/socks_high/male.png";
import feetSocksHighFemale from "./feet/socks_high/female.png";
import feetPlateBootsMale from "./feet/plate_boots/male.png";
import feetPlateBootsFemale from "./feet/plate_boots/female.png";
import feetSocksAnkleMale from "./feet/socks_ankle/male.png";
import feetSocksAnkleFemale from "./feet/socks_ankle/female.png";
import feetSocksTabiMale from "./feet/socks_tabi/male.png";
import feetSocksTabiFemale from "./feet/socks_tabi/female.png";
import feetShoesRevisedMale from "./feet/shoes_revised/male.png";
import feetShoesRevisedFemale from "./feet/shoes_revised/female.png";
import feetShoesSaraMale from "./feet/shoes_sara/male.png";
import feetShoesSaraFemale from "./feet/shoes_sara/female.png";
import feetBootsRevisedMale from "./feet/boots_revised/male.png";
import feetBootsRevisedFemale from "./feet/boots_revised/female.png";
import feetSabatonsMale from "./feet/sabatons/male.png";
import feetSabatonsFemale from "./feet/sabatons/female.png";

import hatBandana from "./hat/bandana.png";
import hatBowler from "./hat/bowler.png";
import hatCrown from "./hat/crown.png";
import hatBarbarianHelmet from "./hat/barbarian_helmet.png";
import hatTophat from "./hat/tophat.png";
import hatLegionHelmet from "./hat/legion_helmet.png";
import hatHood from "./hat/hood.png";
import hatWizard from "./hat/wizard.png";
import hatCavalier from "./hat/cavalier.png";
import hatMail from "./hat/mail.png";
import hatNorman from "./hat/norman.png";
import hatTiara from "./hat/tiara.png";
import hatHoodSack from "./hat/hood_sack.png";
import hatLeatherCap from "./hat/leather_cap.png";
import hatKerchief from "./hat/kerchief.png";
import hatBonnie from "./hat/bonnie.png";
import hatCelestialMoon from "./hat/celestial_moon.png";
import hatHeadbandThick from "./hat/headband_thick.png";
import hatVisorRound from "./hat/visor_round.png";

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

/**
 * The body and head silhouettes, keyed by `sex`. Not part of `AVATAR_LAYER_URLS`/`AVATAR_CATEGORIES`
 * — `sex` is a single picker category, but it draws these two separate images at two different
 * points in the render order (see `AVATAR_RENDER_ORDER` below and `avatar-canvas.tsx`).
 */
export const SEX_LAYER_URLS: { body: Record<string, string>; head: Record<string, string> } = {
  body: { male: bodyMale, female: bodyFemale },
  head: { male: headMale, female: headFemale },
};

export const AVATAR_LAYER_URLS: {
  sex: Record<string, string>;
  eyes: Record<string, string>;
  hair: Record<string, string>;
  torso: Record<string, VariantMap>;
  legs: Record<string, VariantMap>;
  feet: Record<string, VariantMap>;
  hat: Record<string, string>;
} = {
  // The swatch thumbnail for "Male"/"Female" is the body silhouette — see `SEX_LAYER_URLS` above.
  sex: SEX_LAYER_URLS.body,
  eyes: {
    brows: eyesBrows,
    cyclops: eyesCyclops,
    cyclops2: eyesCyclops2,
    brows_thin: eyesBrowsThin,
  },
  hair: {
    plain: hairPlain,
    bangslong: hairBangslong,
    bob: hairBob,
    buzzcut: hairBuzzcut,
    dreadlocks_short: hairDreadlocksShort,
    pixie: hairPixie,
    afro: hairAfro,
    curly_short: hairCurlyShort,
    mop: hairMop,
    cornrows: hairCornrows,
    unkempt: hairUnkempt,
    high_and_tight: hairHighAndTight,
    flat_top_fade: hairFlatTopFade,
    curly_short2: hairCurlyShort2,
    spiked: hairSpiked,
    cowlick: hairCowlick,
    jewfro: hairJewfro,
    natural: hairNatural,
    longhawk: hairLonghawk,
    swoop: hairSwoop,
  },
  torso: {
    tshirt: { male: torsoTshirtMale, female: torsoTshirtFemale },
    tshirt_buttoned: { male: torsoTshirtButtonedMale, female: torsoTshirtButtonedFemale },
    leather_armour: { male: torsoLeatherArmourMale, female: torsoLeatherArmourFemale },
    plate_armour: { male: torsoPlateArmourMale, female: torsoPlateArmourFemale },
    chainmail: { male: torsoChainmailMale, female: torsoChainmailFemale },
    legion_armour: { male: torsoLegionArmourMale, female: torsoLegionArmourFemale },
    longsleeve: { male: torsoLongsleeveMale, female: torsoLongsleeveFemale },
    polo: { male: torsoPoloMale, female: torsoPoloFemale },
    vneck: { male: torsoVneckMale, female: torsoVneckFemale },
    overalls: { male: torsoOverallsMale, female: torsoOverallsFemale },
    suspenders: { male: torsoSuspendersMale, female: torsoSuspendersFemale },
    shortsleeve_plain: { male: torsoShortsleevePlainMale, female: torsoShortsleevePlainFemale },
    henley: { male: torsoHenleyMale, female: torsoHenleyFemale },
    scoop_sweater: { male: torsoScoopSweaterMale, female: torsoScoopSweaterFemale },
    scoop_tee: { male: torsoScoopTeeMale, female: torsoScoopTeeFemale },
    sleeveless2: { male: torsoSleeveless2Male, female: torsoSleeveless2Female },
    longsleeve_buttoned: { male: torsoLongsleeveButtonedMale, female: torsoLongsleeveButtonedFemale },
    longsleeve_vneck: { male: torsoLongsleeveVneckMale, female: torsoLongsleeveVneckFemale },
  },
  legs: {
    pants: { male: legsPantsMale, female: legsPantsFemale },
    shorts: { male: legsShortsMale, female: legsShortsFemale },
    skirt_plain: { male: legsSkirtPlainMale, female: legsSkirtPlainFemale },
    skirt_legion: { male: legsSkirtLegionMale, female: legsSkirtLegionFemale },
    formal: { male: legsFormalMale, female: legsFormalFemale },
    cuffed: { male: legsCuffedMale, female: legsCuffedFemale },
    leggings: { male: legsLeggingsMale, female: legsLeggingsFemale },
    hose: { male: legsHoseMale, female: legsHoseFemale },
    pantaloons: { male: legsPantaloonsMale, female: legsPantaloonsFemale },
    formal_striped: { male: legsFormalStripedMale, female: legsFormalStripedFemale },
    leggings2: { male: legsLeggings2Male, female: legsLeggings2Female },
    plate_greaves: { male: legsPlateGreavesMale, female: legsPlateGreavesFemale },
    cargo_pants: { male: legsCargoPantsMale, female: legsCargoPantsFemale },
  },
  feet: {
    shoes_basic: { male: feetShoesBasicMale, female: feetShoesBasicFemale },
    boots_basic: { male: feetBootsBasicMale, female: feetBootsBasicFemale },
    sandals: { male: feetSandalsMale, female: feetSandalsFemale },
    shoes_ghillies: { male: feetShoesGhilliesMale, female: feetShoesGhilliesFemale },
    boots_fold: { male: feetBootsFoldMale, female: feetBootsFoldFemale },
    boots_rimmed: { male: feetBootsRimmedMale, female: feetBootsRimmedFemale },
    slippers: { male: feetSlippersMale, female: feetSlippersFemale },
    socks_high: { male: feetSocksHighMale, female: feetSocksHighFemale },
    plate_boots: { male: feetPlateBootsMale, female: feetPlateBootsFemale },
    socks_ankle: { male: feetSocksAnkleMale, female: feetSocksAnkleFemale },
    socks_tabi: { male: feetSocksTabiMale, female: feetSocksTabiFemale },
    shoes_revised: { male: feetShoesRevisedMale, female: feetShoesRevisedFemale },
    shoes_sara: { male: feetShoesSaraMale, female: feetShoesSaraFemale },
    boots_revised: { male: feetBootsRevisedMale, female: feetBootsRevisedFemale },
    sabatons: { male: feetSabatonsMale, female: feetSabatonsFemale },
  },
  hat: {
    bandana: hatBandana,
    bowler: hatBowler,
    crown: hatCrown,
    barbarian_helmet: hatBarbarianHelmet,
    tophat: hatTophat,
    legion_helmet: hatLegionHelmet,
    hood: hatHood,
    wizard: hatWizard,
    cavalier: hatCavalier,
    mail: hatMail,
    norman: hatNorman,
    tiara: hatTiara,
    hood_sack: hatHoodSack,
    leather_cap: hatLeatherCap,
    kerchief: hatKerchief,
    bonnie: hatBonnie,
    celestial_moon: hatCelestialMoon,
    headband_thick: hatHeadbandThick,
    visor_round: hatVisorRound,
  },
};

/**
 * The URL for one layer's option, given the currently selected sex — the one lookup that knows
 * `torso`/`legs`/`feet` are nested by body variant and everything else is flat. Every call site
 * (the canvas, the picker's swatches) goes through this rather than indexing `AVATAR_LAYER_URLS`
 * directly, so a future body-variant-aware category only needs an entry in
 * `BODY_VARIANT_CATEGORIES`, not a change at every call site.
 */
export function resolveAvatarUrl(category: AvatarCategory, id: string, sexId: string | null): string | undefined {
  if (isBodyVariantCategory(category)) {
    const variant: BodyVariant = sexId === "female" ? "female" : "male";
    return AVATAR_LAYER_URLS[category][id]?.[variant];
  }
  return (AVATAR_LAYER_URLS[category] as Record<string, string>)[id];
}

/**
 * Bottom to top — verified by compositing in the prototyping session (body+legs+feet+torso+head+
 * eyes+hair at (0,0) on a 64x64 canvas produced a correctly-aligned character; hat goes last, on
 * top of hair). Deliberately NOT the same order as `AVATAR_CATEGORIES` (which is display order for
 * the picker's rows) — a body is drawn under its legs and feet, not over them.
 *
 * The head silhouette is NOT a member of this array — it is not a category with its own slot in
 * `AvatarLayers`. `avatar-canvas.tsx` draws it as one extra, hardcoded step right after `torso`
 * (before `eyes`), sourced from `SEX_LAYER_URLS.head[layers.sex]`.
 */
export const AVATAR_RENDER_ORDER: AvatarCategory[] = ["sex", "legs", "feet", "torso", "eyes", "hair", "hat"];
