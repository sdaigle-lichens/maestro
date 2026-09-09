# Avatar art credits

The pixel-art character pieces in the agent avatar picker are cropped from the
[Universal LPC Spritesheet Character Generator](https://github.com/liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator)
(Liberated Pixel Cup), licensed **GPL-3.0** at the repository level, with individual assets also
available under **CC-BY-SA 3.0** or **OGA-BY 3.0** as documented in the project's own `CREDITS.csv`.
Each option below is a single 64×64 south-facing idle frame cropped from the named spritesheet,
unless noted as a local recolor of one.

This page is generated from `apps/maestro/src/renderer/src/assets/avatar/CREDITS.json`, which
carries the same data in machine-readable form.

## Sex

The picker's "Sex" category drives two drawn layers at once — a body silhouette and a matching
head silhouette — since the upstream pack ships them as separate crops that must always be drawn
together. Picking "Male" or "Female" here selects both.

### Body

| Option | Source | Authors | Licenses |
| --- | --- | --- | --- |
| Male | `body/bodies/male/idle.png` | bluecarrot16, JaidynReiman, Benjamin K. Smith (BenCreating), Evert, Eliza Wyatt (ElizaWy), TheraHedwig, MuffinElZangano, Durrani, Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Female | `body/bodies/female/idle.png` | Benjamin K. Smith (BenCreating), bluecarrot16, TheraHedwig, Evert, MuffinElZangano, Durrani, Pierre Vigier (pvigier), ElizaWy, Matthew Krohn (makrohn), Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |

There is deliberately no Child option: every worn layer below (torso, legs, feet, hat) and the eye
layer are cropped for an adult frame, and the upstream pack has no child-sized cut for any of them
— pairing them with a child body/head produced severe misalignment (verified by compositing), not
a cosmetic one.

### Head

| Option | Source | Authors | Licenses |
| --- | --- | --- | --- |
| Male | `head/heads/human/male/idle.png` | bluecarrot16, Benjamin K. Smith (BenCreating), Stephen Challener (Redshrike) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Female | `head/heads/human/female/idle.png` | bluecarrot16, Benjamin K. Smith (BenCreating), Stephen Challener (Redshrike) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |

## Eyes

| Option | Source | Authors | Licenses |
| --- | --- | --- | --- |
| Brows | `eyes/eyebrows/thick/adult/idle.png` | ElizaWy | OGA-BY 3.0 |
| Cyclops | `eyes/cyclops/adult/idle.png` | kirts, JaidynReiman | CC0 |
| Cyclops (alt) | `eyes/cyclops2/adult/idle.png` | kirts, JaidynReiman | CC0 |
| Thin Brows | `eyes/eyebrows/thin/adult/idle.png` | ElizaWy | OGA-BY 3.0 |

These four are the only entries cropped directly from an upstream sheet — the pack's `eyes/human/*`
files (any mood, adult or child) carry no entry in its own `CREDITS.csv`, so they cannot be
attributed and are not used here.

"Brows" and "Thin Brows" also take a freeform color: the picker offers a color input that recolors
the shape live (canvas `getImageData`/`putImageData`, hue+saturation replaced, lightness left alone
so the shading survives — see `recolorImage` in `utils/recolor.ts`), rather than the fixed list of
20 pre-baked palette-swapped PNGs this page used to document. "Cyclops"/"Cyclops (alt)" don't take a
color — they're a single eye shape rather than an eyebrow, so the same swap would recolor the iris
along with everything else.

## Hair

| Option | Source | Authors | Licenses |
| --- | --- | --- | --- |
| Plain | `hair/plain/adult/idle.png` | JaidynReiman, Manuel Riecke (MrBeast), Joe White | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Long Bangs | `hair/bangslong/adult/idle.png` | JaidynReiman, Manuel Riecke (MrBeast) | CC-BY-SA 3.0, GPL 3.0 |
| Bob | `hair/bob/adult/idle.png` | ElizaWy, bluecarrot16 | CC0 |
| Buzzcut | `hair/buzzcut/adult/idle.png` | ElizaWy | OGA-BY 3.0 |
| Short Dreadlocks | `hair/dreadlocks_short/adult/idle.png` | ElizaWy, bluecarrot16 | CC0 |
| Pixie Cut | `hair/pixie/adult/idle.png` | JaidynReiman, Manuel Riecke (MrBeast) | CC-BY-SA 3.0, GPL 3.0 |
| Afro | `hair/afro/adult/idle.png` | bluecarrot16 | CC0 |
| Curly Short | `hair/curly_short/adult/idle.png` | ElizaWy | OGA-BY 3.0 |
| Mop | `hair/mop/adult/idle.png` | Radomir Dopieralski, bluecarrot16 | CC-BY-SA 3.0, GPL 3.0 |
| Cornrows | `hair/cornrows/adult/idle.png` | ElizaWy, bluecarrot16 | CC0 |
| Unkempt | `hair/unkempt/adult/idle.png` | JaidynReiman, Manuel Riecke (MrBeast) | CC-BY-SA 3.0, GPL 3.0 |
| High & Tight | `hair/high_and_tight/adult/idle.png` | Skorpio, bluecarrot16 | CC-BY-SA 3.0, GPL 3.0 |
| Flat Top Fade | `hair/flat_top_fade/adult/idle.png` | ElizaWy, bluecarrot16 | CC0 |
| Curly Short (Alt) | `hair/curly_short2/adult/idle.png` | ElizaWy | OGA-BY 3.0 |
| Spiked | `hair/spiked/adult/idle.png` | kcilds/Rocetti/Eredah | CC-BY 4.0 |
| Cowlick | `hair/cowlick/adult/idle.png` | ElizaWy, bluecarrot16 | CC0 |
| Jewfro | `hair/jewfro/adult/idle.png` | JaidynReiman | OGA-BY 3.0+, CC-BY 3.0+, CC-BY-SA 3.0, GPL 3.0 |
| Natural | `hair/natural/adult/idle.png` | ElizaWy, bluecarrot16 | CC0 |
| Long Hawk | `hair/longhawk/adult/idle.png` | JaidynReiman, Manuel Riecke (MrBeast) | CC-BY-SA 3.0, GPL 3.0 |
| Swoop | `hair/swoop/adult/idle.png` | JaidynReiman, Manuel Riecke (MrBeast) | CC-BY-SA 3.0, GPL 3.0 |

Every hairstyle above also takes a freeform color, the same live recolor used for Eyes — every one
of these sprites turned out to already be drawn with the same flat-ink-over-shading pattern the
eyebrows are, so `recolorImage` covers hair with no per-shape changes.

## Torso

Torso is a body-variant-aware category: each garment is cropped separately for the male and
female body silhouette, and the picker renders whichever one matches the currently selected sex
(see `resolveAvatarUrl` in `manifest.ts`) — drawing the male cut over a female body left the
sleeves and collar visibly offset from the body underneath it. There is no unclothed ("none")
option: torso is a required category.

| Option | Body | Source | Authors | Licenses |
| --- | --- | --- | --- | --- |
| T-Shirt | Male | `torso/clothes/shortsleeve/tshirt/male/idle.png` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| T-Shirt | Female | `torso/clothes/shortsleeve/tshirt/female/idle.png` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| Buttoned Shirt | Male | `torso/clothes/shortsleeve/tshirt_buttoned/male/idle.png` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| Buttoned Shirt | Female | `torso/clothes/shortsleeve/tshirt_buttoned/female/idle.png` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| Leather Armor | Male | `torso/armour/leather/male/idle.png` | Johannes Sjölund (wulax), bluecarrot16, JaidynReiman | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Leather Armor | Female | `torso/armour/leather/female/idle.png` | Michael Whitlock (bigbeargames), Matthew Krohn (makrohn), Johannes Sjölund (wulax), bluecarrot16, JaidynReiman | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Plate Armor | Male | `torso/armour/plate/male/idle.png` | Napsio (Vitruvian Studio), JaidynReiman, bluecarrot16, Michael Whitlock (bigbeargames), Johannes Sjölund (wulax) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Plate Armor | Female | `torso/armour/plate/female/idle.png` | JaidynReiman, bluecarrot16, Michael Whitlock (bigbeargames), Matthew Krohn (makrohn), Johannes Sjölund (wulax) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Chainmail | Male | `torso/chainmail/male/idle.png` | Johannes Sjölund (wulax), Napsio (Vitruvian Studio), JaidynReiman | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Chainmail | Female | `torso/chainmail/female/idle.png` | Johannes Sjölund (wulax), Napsio (Vitruvian Studio), JaidynReiman | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Legion Armor | Male | `torso/armour/legion/male/idle.png` | Napsio (Vitruvian Studio), JaidynReiman, bluecarrot16, Nila122 | OGA-BY 3.0, CC-BY-SA 3.0, GPL 2.0, GPL 3.0 |
| Legion Armor | Female | `torso/armour/legion/female/idle.png` | Napsio (Vitruvian Studio), JaidynReiman, bluecarrot16, Nila122 | OGA-BY 3.0, CC-BY-SA 3.0, GPL 2.0, GPL 3.0 |
| Long-Sleeve Shirt | Male | `torso/clothes/longsleeve/longsleeve/male/idle.png` | JaidynReiman, Johannes Sjölund (wulax) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Long-Sleeve Shirt | Female | `torso/clothes/longsleeve/longsleeve/female/idle.png` | bluecarrot16, ElizaWy, JaidynReiman, Stephen Challener (Redshrike) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Polo Shirt | Male | `torso/clothes/shortsleeve/shortsleeve_polo/male/idle.png` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| Polo Shirt | Female | `torso/clothes/shortsleeve/shortsleeve_polo/female/idle.png` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| V-Neck Shirt | Male | `torso/clothes/shortsleeve/tshirt_vneck/male/idle.png` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| V-Neck Shirt | Female | `torso/clothes/shortsleeve/tshirt_vneck/female/idle.png` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| Overalls | Male | `torso/aprons/overalls/male/idle.png` | ElizaWy, bluecarrot16, JaidynReiman | OGA-BY 3.0, GPL 3.0 |
| Overalls | Female | `torso/aprons/overalls/female/idle.png` | ElizaWy, bluecarrot16, JaidynReiman | OGA-BY 3.0, GPL 3.0 |
| Suspenders | Male | `torso/aprons/suspenders/male/idle.png` | ElizaWy, JaidynReiman | OGA-BY 3.0 |
| Suspenders | Female | `torso/aprons/suspenders/female/idle.png` | ElizaWy, JaidynReiman | OGA-BY 3.0 |
| Short-Sleeve Shirt | Male | `torso/clothes/shortsleeve/shortsleeve/male/idle.png` | bluecarrot16, ElizaWy, JaidynReiman, Stephen Challener (Redshrike) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Short-Sleeve Shirt | Female | `torso/clothes/shortsleeve/shortsleeve/female/idle.png` | bluecarrot16, ElizaWy, JaidynReiman, Stephen Challener (Redshrike) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Henley Shirt | Male | `torso/clothes/longsleeve/longsleeve2/male/idle.png` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| Henley Shirt | Female | `torso/clothes/longsleeve/longsleeve2/female/idle.png` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| Scoop Neck Sweater | Male | `torso/clothes/longsleeve/scoop/male/idle.png` | bluecarrot16, ElizaWy, JaidynReiman, Stephen Challener (Redshrike) | OGA-BY 3.0, GPL 3.0 |
| Scoop Neck Sweater | Female | `torso/clothes/longsleeve/scoop/female/idle.png` | bluecarrot16, ElizaWy, JaidynReiman, Stephen Challener (Redshrike) | OGA-BY 3.0, GPL 3.0 |
| Scoop Neck Tee | Male | `torso/clothes/shortsleeve/tshirt_scoop/male/idle.png` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| Scoop Neck Tee | Female | `torso/clothes/shortsleeve/tshirt_scoop/female/idle.png` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| Sleeveless Shirt | Male | `torso/clothes/sleeveless/sleeveless2/male/idle.png` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| Sleeveless Shirt | Female | `torso/clothes/sleeveless/sleeveless2/female/idle.png` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| Buttoned Overshirt | Male | `torso/clothes/longsleeve/longsleeve2_buttoned/male/idle.png` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| Buttoned Overshirt | Female | `torso/clothes/longsleeve/longsleeve2_buttoned/female/idle.png` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| Long V-Neck Shirt | Male | `torso/clothes/longsleeve/longsleeve2_vneck/male/idle.png` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| Long V-Neck Shirt | Female | `torso/clothes/longsleeve/longsleeve2_vneck/female/idle.png` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |

## Legs

Legs (like torso above) are body-variant-aware, and also required — there is no unclothed option.
The upstream pack does not name its second cut "female" — the folder is called `thin` — but its
own `CREDITS.csv` note settles what it actually is: *"original male pants by wulax, edited for
**female** by Joe White."* Composited side by side, a female body wearing the `male` cut shows a
visible gap at the waistline; the `thin` cut aligns cleanly, so that is what the picker uses for a
female body.

| Option | Body | Source | Authors | Licenses |
| --- | --- | --- | --- | --- |
| Pants | Male | `legs/pants/male/idle.png` | bluecarrot16, JaidynReiman, ElizaWy, Matthew Krohn (makrohn), Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0, GPL 3.0, CC-BY-SA 3.0 |
| Pants | Female (`thin`) | `legs/pants/thin/idle.png` | bluecarrot16, JaidynReiman, ElizaWy, Joe White, Matthew Krohn (makrohn), Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0, GPL 3.0, CC-BY-SA 3.0 |
| Shorts | Male | `legs/shorts/shorts/male/idle.png` | JaidynReiman, ElizaWy, Bluecarrot16, Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0, GPL 3.0 |
| Shorts | Female (`thin`) | `legs/shorts/shorts/thin/idle.png` | ElizaWy, JaidynReiman, Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0 |
| Plain Skirt | Male | `legs/skirts/plain/male/idle.png` | bluecarrot16, Pierre Vigier (pvigier), Johannes Sjölund (wulax), Ahmad3366, JaidynReiman | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Plain Skirt | Female (`thin`) | `legs/skirts/plain/thin/idle.png` | bluecarrot16, Pierre Vigier (pvigier), Johannes Sjölund (wulax), Ahmad3366, JaidynReiman | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Legion Skirt | Male | `legs/skirts/legion/male/idle.png` | bluecarrot16, Nila122, JaidynReiman | OGA-BY 3.0, CC-BY-SA 3.0, GPL 2.0, GPL 3.0 |
| Legion Skirt | Female (`thin`) | `legs/skirts/legion/thin/idle.png` | bluecarrot16, Nila122, JaidynReiman | OGA-BY 3.0, CC-BY-SA 3.0, GPL 2.0, GPL 3.0 |
| Formal Trousers | Male | `legs/formal/male/idle.png` | bluecarrot16, JaidynReiman, ElizaWy, Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Formal Trousers | Female (`thin`) | `legs/formal/thin/idle.png` | bluecarrot16, JaidynReiman, ElizaWy, Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Cuffed Trousers | Male | `legs/cuffed/male/idle.png` | JaidynReiman, ElizaWy, Bluecarrot16, Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0, GPL 3.0 |
| Cuffed Trousers | Female (`thin`) | `legs/cuffed/thin/idle.png` | ElizaWy, JaidynReiman, Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0 |
| Leggings | Male | `legs/leggings/male/idle.png` | bluecarrot16, ElizaWy, JaidynReiman, Mandi Paugh, William.Thompsonj, Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0, GPL 3.0 |
| Leggings | Female (`thin`) | `legs/leggings/thin/idle.png` | bluecarrot16, ElizaWy, JaidynReiman, Mandi Paugh, William.Thompsonj, Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0 |
| Hose | Male | `legs/hose/male/idle.png` | JaidynReiman, ElizaWy, bluecarrot16, JaidynReiman, ElizaWy, Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0, GPL 3.0 |
| Hose | Female (`thin`) | `legs/hose/thin/idle.png` | ElizaWy, JaidynReiman, Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0 |
| Pantaloons | Male | `legs/pantaloons/male/idle.png` | Nila122, JaidynReiman, Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0, GPL 2.0, GPL 3.0, CC-BY-SA 3.0 |
| Pantaloons | Female (`thin`) | `legs/pantaloons/thin/idle.png` | Nila122, JaidynReiman, Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 2.0, GPL 3.0 |
| Pinstripe Trousers | Male | `legs/formal_striped/male/idle.png` | bluecarrot16, JaidynReiman, ElizaWy, Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Pinstripe Trousers | Female (`thin`) | `legs/formal_striped/thin/idle.png` | bluecarrot16, JaidynReiman, ElizaWy, Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Tight Leggings | Male | `legs/leggings2/male/idle.png` | bluecarrot16, ElizaWy, JaidynReiman, Mandi Paugh, William.Thompsonj, Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0, GPL 3.0 |
| Tight Leggings | Female (`thin`) | `legs/leggings2/thin/idle.png` | ElizaWy, JaidynReiman, Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0 |
| Plate Greaves | Male | `legs/armour/plate/male/idle.png` | bluecarrot16, JaidynReiman, Michael Whitlock (bigbeargames), Matthew Krohn (makrohn), Johannes Sjölund (wulax) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Plate Greaves | Female (`thin`) | `legs/armour/plate/thin/idle.png` | bluecarrot16, JaidynReiman, Michael Whitlock (bigbeargames), Matthew Krohn (makrohn), Johannes Sjölund (wulax) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Cargo Pants | Male | `legs/pants2/male/idle.png` | JaidynReiman, ElizaWy, Bluecarrot16, Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0, GPL 3.0 |
| Cargo Pants | Female (`thin`) | `legs/pants2/thin/idle.png` | ElizaWy, JaidynReiman, Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0 |

## Feet

Also body-variant-aware, for the same reason as Legs above — `feet/shoes/basic`'s `CREDITS.csv`
note reads *"edited for **female** base by Joe White"* for its `thin` cut. Feet stays optional
(a bare-foot look remains available by leaving this category unset).

| Option | Body | Source | Authors | Licenses |
| --- | --- | --- | --- | --- |
| Shoes | Male | `feet/shoes/basic/male/idle.png` | JaidynReiman, bluecarrot16, Johannes Sjölund (wulax) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Shoes | Female (`thin`) | `feet/shoes/basic/thin/idle.png` | JaidynReiman, Joe White, Johannes Sjölund (wulax) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Boots | Male | `feet/boots/basic/male/idle.png` | JaidynReiman, bluecarrot16, Nila122 | OGA-BY 3.0, CC-BY-SA 3.0, GPL 2.0, GPL 3.0 |
| Boots | Female (`thin`) | `feet/boots/basic/thin/idle.png` | JaidynReiman, bluecarrot16, Nila122 | OGA-BY 3.0, CC-BY-SA 3.0, GPL 2.0, GPL 3.0 |
| Sandals | Male | `feet/sandals/male/idle.png` | Nila122, JaidynReiman, Matthew Krohn (makrohn), Johannes Sjölund (wulax) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 2.0, GPL 3.0 |
| Sandals | Female (`thin`) | `feet/sandals/thin/idle.png` | Nila122, JaidynReiman, Matthew Krohn (makrohn), Johannes Sjölund (wulax) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 2.0, GPL 3.0 |
| Ghillie Shoes | Male | `feet/shoes/ghillies/male/idle.png` | bluecarrot16, JaidynReiman, Thane Brimhall (pennomi), laetissima, Matthew Krohn (makrohn) | CC-BY-SA 3.0, GPL 3.0 |
| Ghillie Shoes | Female (`thin`) | `feet/shoes/ghillies/thin/idle.png` | bluecarrot16, JaidynReiman, Thane Brimhall (pennomi), laetissima, Matthew Krohn (makrohn) | CC-BY-SA 3.0, GPL 3.0 |
| Cuffed Boots | Male | `feet/boots/fold/male/idle.png` | JaidynReiman | OGA-BY 3.0+, CC-BY 3.0+, GPL 3.0 |
| Cuffed Boots | Female (`thin`) | `feet/boots/fold/thin/idle.png` | JaidynReiman | OGA-BY 3.0+, CC-BY 3.0+, GPL 3.0 |
| Rimmed Boots | Male | `feet/boots/rimmed/male/idle.png` | JaidynReiman | OGA-BY 3.0+, CC-BY 3.0+, GPL 3.0 |
| Rimmed Boots | Female (`thin`) | `feet/boots/rimmed/thin/idle.png` | JaidynReiman | OGA-BY 3.0+, CC-BY 3.0+, GPL 3.0 |
| Slippers | Male | `feet/slippers/male/idle.png` | bluecarrot16, JaidynReiman, Joe White, Luke Mehl | CC-BY-SA 3.0, GPL 3.0 |
| Slippers | Female (`thin`) | `feet/slippers/thin/idle.png` | bluecarrot16, JaidynReiman, Joe White, Luke Mehl | CC-BY-SA 3.0, GPL 3.0 |
| High Socks | Male | `feet/socks/high/male/idle.png` | JaidynReiman, ElizaWy, Bluecarrot16, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0, GPL 3.0 |
| High Socks | Female (`thin`) | `feet/socks/high/thin/idle.png` | ElizaWy, JaidynReiman | OGA-BY 3.0 |
| Plate Boots | Male | `feet/armour/plate/male/idle.png` | Matthew Krohn (makrohn), Johannes Sjölund (wulax) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Plate Boots | Female (`thin`) | `feet/armour/plate/thin/idle.png` | Matthew Krohn (makrohn), Johannes Sjölund (wulax) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Ankle Socks | Male | `feet/socks/ankle/male/idle.png` | JaidynReiman, ElizaWy, Bluecarrot16, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0, GPL 3.0 |
| Ankle Socks | Female (`thin`) | `feet/socks/ankle/thin/idle.png` | ElizaWy, JaidynReiman | OGA-BY 3.0 |
| Tabi Socks | Male | `feet/socks/tabi/male/idle.png` | JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0+, CC-BY 3.0+, GPL 3.0 |
| Tabi Socks | Female (`thin`) | `feet/socks/tabi/thin/idle.png` | JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0+, CC-BY 3.0+, GPL 3.0 |
| Pointed Shoes | Male | `feet/shoes/revised/male/idle.png` | JaidynReiman, ElizaWy, Bluecarrot16, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0, GPL 3.0 |
| Pointed Shoes | Female (`thin`) | `feet/shoes/revised/thin/idle.png` | ElizaWy, JaidynReiman | OGA-BY 3.0 |
| Strappy Shoes | Male | `feet/shoes/sara/male/idle.png` | JaidynReiman, Bluecarrot16, Mandi Paugh, Stephen Challener (Redshrike), William.Thompsonj | OGA-BY 3.0, CC-BY 3.0+, GPL 2.0, GPL 3.0 |
| Strappy Shoes | Female (`thin`) | `feet/shoes/sara/thin/idle.png` | JaidynReiman, Bluecarrot16, Mandi Paugh, Stephen Challener (Redshrike), William.Thompsonj | OGA-BY 3.0, CC-BY 3.0+, GPL 2.0, GPL 3.0 |
| Riding Boots | Male | `feet/boots/revised/male/idle.png` | JaidynReiman, ElizaWy, Bluecarrot16, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0, GPL 3.0 |
| Riding Boots | Female (`thin`) | `feet/boots/revised/thin/idle.png` | ElizaWy, JaidynReiman, Stephen Challener (Redshrike), Johannes Sjölund (wulax) | OGA-BY 3.0 |
| Sabatons | Male | `feet/accessory/plate_toe/male/idle.png` | JaidynReiman | OGA-BY 3.0+, CC-BY 3.0+, GPL 3.0 |
| Sabatons | Female (`thin`) | `feet/accessory/plate_toe/thin/idle.png` | JaidynReiman | OGA-BY 3.0+, CC-BY 3.0+, GPL 3.0 |

## Hat

Hats are the one worn category that stays a single cut for every body — the upstream pack only
ever cut one `adult` size for each of them, so there is nothing to select between. Hat stays
optional.

| Option | Source | Authors | Licenses |
| --- | --- | --- | --- |
| Bandana | `hat/cloth/bandana/adult/idle.png` | Matthew Krohn (makrohn), JaidynReiman, Marcel van de Steeg (MadMarcel), JaidynReiman | OGA-BY 3.0, CC-BY-SA 3.0 |
| Bowler Hat | `hat/formal/bowler/adult/idle.png` | bluecarrot16 | CC-BY-SA 3.0, GPL 3.0 |
| Crown | `hat/formal/crown/adult/idle.png` | DarkwallLKE, Charles Sanchez (CharlesGabriel) | CC-BY-SA 3.0, GPL 3.0 |
| Barbarian Helmet | `hat/helmet/barbarian/adult/idle.png` | bluecarrot16, JaidynReiman, Napsio (Vitruvian Studio) | CC-BY 3.0, CC-BY 4.0, OGA-BY 3.0, GPL 2.0, GPL 3.0 |
| Top Hat | `hat/formal/tophat/adult/idle.png` | bluecarrot16 | CC-BY-SA 3.0, GPL 3.0 |
| Legion Helmet | `hat/helmet/legion/adult/idle.png` | bluecarrot16, Nila122, JaidynReiman, Matthew Krohn (makrohn), Johannes Sjölund (wulax) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 2.0, GPL 3.0 |
| Hood | `hat/cloth/hood/adult/idle.png` | Johannes Sjölund (wulax), JaidynReiman | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Wizard Hat | `hat/magic/celestial/adult/idle.png` | Napsio (Vitruvian Studio), Michael Whitlock (bigbeargames), Tracy | CC-BY 3.0 |
| Cavalier Hat | `hat/pirate/cavalier/adult/idle.png` | bluecarrot16, JaidynReiman | OGA-BY 3.0 |
| Mail Coif | `hat/helmet/mail/adult/idle.png` | Napsio (Vitruvian Studio), Johannes Sjölund (wulax), JaidynReiman | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Norman Helmet | `hat/helmet/norman/adult/idle.png` | ElizaWy, Sander Frenken (castelonia) | OGA-BY 3.0, CC-BY-SA 4.0, CC-BY-SA 3.0, GPL 3.0 |
| Tiara | `hat/formal/tiara/adult/idle.png` | Luke Mehl | CC-BY-SA 3.0, GPL 3.0 |
| Sack Hood | `hat/cloth/hood_sack/adult/idle.png` | Nila122, JaidynReiman | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Leather Cap | `hat/cloth/leather_cap/adult/idle.png` | Johannes Sjölund (wulax), Matthew Krohn (Makrohn), JaidynReiman | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Kerchief | `hat/pirate/kerchief/adult/idle.png` | bluecarrot16, JaidynReiman, Nila122 | OGA-BY 3.0, CC-BY-SA 3.0, GPL 2.0, GPL 3.0 |
| Bonnet | `hat/pirate/bonnie/adult/idle.png` | bluecarrot16, JaidynReiman | OGA-BY 3.0 |
| Crescent Moon Hat | `hat/magic/celestial_moon/adult/idle.png` | Napsio (Vitruvian Studio), Michael Whitlock (bigbeargames), Tracy | CC-BY 3.0 |
| Headband | `hat/headband/thick/adult/idle.png` | JaidynReiman | OGA-BY 3.0+, CC-BY 3.0+, GPL 3.0 |
| Round Visor | `hat/visor/round/adult/idle.png` | bluecarrot16, ElizaWy, Sander Frenken (castelonia) | OGA-BY 3.0, CC-BY-SA 4.0, CC-BY-SA 3.0, GPL 3.0 |

Source paths above are relative to `spritesheets/` in the upstream repository. See
`CREDITS.json` for the full URL list backing each license claim.
