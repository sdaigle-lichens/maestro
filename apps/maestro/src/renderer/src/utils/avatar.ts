// Pure renderer-side helpers for the agent avatar picker. No IPC — randomization is client-side
// data already available via `contracts.ts`.

import {
  AVATAR_CATEGORIES,
  AVATAR_PARTS,
  AVATAR_REQUIRED_CATEGORIES,
  type AvatarCategory,
  type AvatarLayers,
} from "../../../core/contracts.js";

/** A neutral placeholder — first option of every required category, nothing in the optional ones. */
export function defaultAvatarLayers(): AvatarLayers {
  const layers = {} as AvatarLayers;
  for (const cat of AVATAR_CATEGORIES) {
    const required = (AVATAR_REQUIRED_CATEGORIES as readonly AvatarCategory[]).includes(cat);
    layers[cat] = required ? AVATAR_PARTS[cat][0].id : null;
  }
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
