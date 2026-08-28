# Avatar art credits

The pixel-art character pieces in the agent avatar picker are cropped from the
[Universal LPC Spritesheet Character Generator](https://github.com/liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator)
(Liberated Pixel Cup), licensed **GPL-3.0** at the repository level, with individual assets also
available under **CC-BY-SA 3.0** or **OGA-BY 3.0** as documented in the project's own `CREDITS.csv`.
Each option below is a single 64×64 south-facing idle frame cropped from the named spritesheet.

This page is generated from `apps/maestro/src/renderer/src/assets/avatar/CREDITS.json`, which
carries the same data in machine-readable form.

## Body

| Option | Source | Authors | Licenses |
| --- | --- | --- | --- |
| Male | `body/bodies/male/idle.png` | bluecarrot16, JaidynReiman, Benjamin K. Smith (BenCreating), Evert, Eliza Wyatt (ElizaWy), TheraHedwig, MuffinElZangano, Durrani, Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Female | `body/bodies/female/idle.png` | Benjamin K. Smith (BenCreating), bluecarrot16, TheraHedwig, Evert, MuffinElZangano, Durrani, Pierre Vigier (pvigier), ElizaWy, Matthew Krohn (makrohn), Johannes Sjölund (wulax), Stephen Challener (Redshrike) | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |

There is deliberately no Child option: every worn layer below (torso, legs, feet, hat) and the eye
layer are cropped for an adult frame, and the upstream pack has no child-sized cut for any of them
— pairing them with a child body/head produced severe misalignment (verified by compositing), not
a cosmetic one.

## Head

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

"Brows" is cropped from an eyebrows sheet rather than a dedicated eyes sheet — the upstream pack's
`eyes/human/*` files (any mood, adult or child) carry no entry in its own `CREDITS.csv`, so they
cannot be attributed and are not used here.

## Hair

| Option | Source | Authors | Licenses |
| --- | --- | --- | --- |
| Plain | `hair/plain/adult/idle.png` | JaidynReiman, Manuel Riecke (MrBeast), Joe White | OGA-BY 3.0, CC-BY-SA 3.0, GPL 3.0 |
| Long Bangs | `hair/bangslong/adult/idle.png` | JaidynReiman, Manuel Riecke (MrBeast) | CC-BY-SA 3.0, GPL 3.0 |
| Bob | `hair/bob/adult/idle.png` | ElizaWy, bluecarrot16 | CC0 |
| Buzzcut | `hair/buzzcut/adult/idle.png` | ElizaWy | OGA-BY 3.0 |
| Short Dreadlocks | `hair/dreadlocks_short/adult/idle.png` | ElizaWy, bluecarrot16 | CC0 |

## Torso

Torso is the one body-variant-aware category: each garment is cropped separately for the male and
female body silhouette, and the picker renders whichever one matches the currently selected body
(see `resolveAvatarUrl` in `manifest.ts`) — drawing the male cut over a female body left the
sleeves and collar visibly offset from the body underneath it.

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

## Legs

Legs (like torso above) are body-variant-aware. The upstream pack does not name its second cut
"female" — the folder is called `thin` — but its own `CREDITS.csv` note settles what it actually
is: *"original male pants by wulax, edited for **female** by Joe White."* Composited side by side,
a female body wearing the `male` cut shows a visible gap at the waistline; the `thin` cut aligns
cleanly, so that is what the picker uses for a female body.

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

## Feet

Also body-variant-aware, for the same reason as Legs above — `feet/shoes/basic`'s `CREDITS.csv`
note reads *"edited for **female** base by Joe White"* for its `thin` cut.

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

## Hat

Hats are the one worn category that stays a single cut for every body — the upstream pack only
ever cut one `adult` size for each of them, so there is nothing to select between.

| Option | Source | Authors | Licenses |
| --- | --- | --- | --- |
| Bandana | `hat/cloth/bandana/adult/idle.png` | Matthew Krohn (makrohn), JaidynReiman, Marcel van de Steeg (MadMarcel) | OGA-BY 3.0, CC-BY-SA 3.0 |
| Bowler Hat | `hat/formal/bowler/adult/idle.png` | bluecarrot16 | CC-BY-SA 3.0, GPL 3.0 |
| Crown | `hat/formal/crown/adult/idle.png` | DarkwallLKE, Charles Sanchez (CharlesGabriel) | CC-BY-SA 3.0, GPL 3.0 |
| Barbarian Helmet | `hat/helmet/barbarian/adult/idle.png` | bluecarrot16, JaidynReiman, Napsio (Vitruvian Studio) | CC-BY 3.0, CC-BY 4.0, OGA-BY 3.0, GPL 2.0, GPL 3.0 |

Source paths above are relative to `spritesheets/` in the upstream repository. See
`CREDITS.json` for the full URL list backing each license claim.
