// Pure renderer-side helpers for the agent avatar picker. No IPC — randomization is client-side
// data already available via `contracts.ts`.

import {
  AVATAR_CATEGORIES,
  AVATAR_PARTS,
  AVATAR_REQUIRED_CATEGORIES,
  type AvatarCategory,
  type AvatarLayers,
} from "../../../core/contracts.js";

/**
 * The placeholder an agent with no saved avatar renders as: the first option of every category
 * except `hat`, which stays empty.
 *
 * Deliberately CLOTHED, not "required categories only". `body`/`head`/`eyes` are the three the
 * store lets you leave empty nothing else — but a sprite composited from exactly those three is a
 * naked figure, and that is what most rows of /agents show, since most agents have never been
 * customised. A hat is the one part left off: it reads as a choice rather than a default.
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
  return layers;
}
