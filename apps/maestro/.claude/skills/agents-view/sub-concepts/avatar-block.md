# The avatar block

`agent-avatar-block.tsx` is the `/agents` card's cosmetic avatar editor, in both view and edit mode.
See [`agents-view`](../SKILL.md) for the page it lives on.

`agent-avatar-block.tsx` is a **tabs-and-arrows** editor: seven category buttons (sex, eyes, hair,
torso, legs, feet, hat) pick the active category, the two arrows cycle that category's options, and
a dice button randomises all seven. "Sex" merges what used to be separate body/head categories —
picking male/female drives both the body and head silhouette layers at once (see `SEX_LAYER_URLS`
in `manifest.ts`), since the upstream pack always ships them as a matched pair. Optional categories
include `null` ("none") in the cycle; the four required ones (sex, eyes, torso, legs) do not — torso
and legs have no unclothed option.

## Recoloring eyes and hair

`eyes` and `hair` each carry one extra control beside the tabs/arrows, a shared `ColorControl`
(`agent-avatar-block.tsx`; `avatar-picker.tsx` has its own copy sized for its swatch-row layout):
`eyes` shows it when the selected shape is "Brows" or "Thin Brows" (`EYE_RECOLOR_SHAPES` in
`contracts.ts`), writing `AvatarLayers.eyesColor`; `hair` shows it for *every* hairstyle
(`HAIR_RECOLOR_SHAPES` — unlike eyes, there's no shape to exclude, since none of the 20 hairstyles
is a fixed-color feature the way `cyclops`'s iris is), writing `AvatarLayers.hairColor`. Both are a
freeform hex, recolored onto the sprite live in `avatar-canvas.tsx` via the same `recolorImage()`
call (`utils/recolor.ts`: convert to HSL, replace hue+saturation, keep lightness so the shading
survives) — every hair sprite in the upstream pack turned out to already use the identical
flat-ink-over-shading pattern the eyebrows do, so one algorithm covers both categories with no
per-shape tuning. This replaced an earlier fixed list of 20 pre-baked palette-swapped eyebrow PNGs,
one per named color — `eyesColor`/`hairColor` sit outside the `Record<AvatarCategory, string |
null>` shape (neither is a *choice among options* the way every other field is), so `AvatarLayers`
is `Record<AvatarCategory, string | null> & { eyesColor?: string | null; hairColor?: string |
null }`. "Cyclops"/"Cyclops (alt)" ignore the color entirely — they're a single eye shape, not an
eyebrow, and the control is hidden while either is selected.

**`ColorControl`'s swatch previews `color ?? native`, never a placeholder unrelated to the shape.**
`nativeEyesColor(id)`/`nativeHairColor(id)` (`utils/avatar.ts`) look up a per-shape hex sampled
offline from the shipped PNG — the weighted average RGB of every opaque pixel — so the swatch and
the hidden `<input type="color">`'s own value both start at what that specific shape actually looks
like unrecolored, rather than one fixed dark brown shared by every shape regardless of its real
color. `NATIVE_EYES_COLORS`/`NATIVE_HAIR_COLORS` are parity-tested against `EYE_RECOLOR_SHAPES`/
`HAIR_RECOLOR_SHAPES` in `avatar-parity.test.ts`, same discipline as the shape lists themselves — an
id with no sampled entry falls back to `#4a2e1a`, which parity rules out ever being reached.

**Reset lives inside the swatch, not as a separate sibling control.** A small `×` badge renders
absolutely positioned in the swatch's own corner, shown only once `color !== null`, so the layout
doesn't shift as a color is set/cleared the way a conditionally-rendered sibling button did before.
"Select color" is an always-visible text button beside the swatch that opens the native picker via a
`useRef` + `.click()` on the hidden input, rather than the swatch itself being the click target
(a `<label>` wrapping the hidden input can't stay the trigger once a nested Reset button needs to
intercept its own clicks without also re-opening the picker underneath it).

## Why not `avatar-picker.tsx`

This **supersedes `avatar-picker.tsx`'s swatch-rows layout on this page only** — that component is
still what `/create-subagent` renders, so it was not deleted. The two were prototyped side by side:
swatch rows grow with the number of options and made the card 914px tall instead of 637px, tall
enough to push the details below the fold.

`AvatarCanvas` takes a `fill` prop here rather than a pixel `size`, because the frame is a responsive
`aspect-square` box whose width the layout decides (max 232px in view, 168px in edit — the arrows
need the room).

`defaultAvatarLayers()` is what most rows show, since most agents have never been customised. It
returns the first option of every category except `hat` — it previously returned only the required
three, which composites a naked sprite.
