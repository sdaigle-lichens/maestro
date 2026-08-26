# Agent avatar picker — implementation plan

This is a handoff doc for a fresh session. It replaces `pixel_character_creator_blueprint.md`
(a Gemini-drafted plan with real problems — see "What was wrong with the original plan" below;
delete that file once this one is reviewed) and captures a prototyping session's worth of research
so the next session doesn't have to redo it. Read `apps/maestro/CLAUDE.md` and the
`maestro-architecture` skill first if you haven't worked in this app before — this doc assumes that
context.

## The feature

On the "New subagent" page (`apps/maestro/src/renderer/src/routes/create-subagent.tsx`), let the
user give their agent a small 2D pixel-art character — purely cosmetic, has no effect on the
agent's behavior, skills, or the codebase. The chosen appearance is saved in the app's own SQLite
store (not `.claude/`, not `maestro.json`), keyed by **agent name, globally** (same agent name =
same look in every project — confirmed with the user, mirrors how `skill-tags.ts` already treats
skill tags as global-by-id rather than per-project). Also viewable/re-editable later from the
`/agents` page's detail pane.

## What was wrong with the original plan

`pixel_character_creator_blueprint.md` (Gemini-drafted) had four real problems, in order of
severity:

1. It scraped a specific external GitHub repo live, in a build script, via the unauthenticated
   GitHub API. The repo it named (`9236312/Spritesheet`) turned out to be real but was the wrong
   shape to crawl generically (see below). Two other repos suggested during discussion were
   rejected outright: `DaddyRaegen/ffbe_asset_dump` is an unlicensed dump of ripped assets from a
   commercial game (Final Fantasy Brave Exvius / Square Enix) — do not use it, it's a real
   copyright liability. The user's follow-up suggestion,
   `liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator`, is the correct, legitimate
   source (GPL-3.0, with per-asset CC-BY-SA-3.0/OGA-BY-3.0 also documented in its own
   `CREDITS.csv`) — see "Asset sourcing" below for what was actually verified about it.
2. It never persisted the user's selections anywhere — only an asset *manifest*, not the chosen
   layers. The actual ask (save to SQLite) was unaddressed.
3. It was a standalone React component with no relationship to this app's `src/core` /
   `src/main` / `src/preload` / `src/renderer` split, no IPC, nothing wired into
   `create-subagent.tsx`.
4. It served images from `public/` via absolute paths (`/static_layers/...`). Per
   `apps/maestro/CLAUDE.md`'s "things that bite" section, the packaged build loads over `file://`
   with `base: "./"` — an absolute path like that breaks in the packaged app even though it works
   fine under `pnpm dev`. Vite asset imports (§3 below) are the safe pattern already implicitly
   used elsewhere in this codebase's build.

## Asset sourcing — already done, verified, and sitting in the working tree

**Do not re-scrape or re-derive this. It's finished.** 30 tiny (400–700 byte) cropped PNGs plus a
credits manifest are already untracked in the working tree at
`apps/maestro/src/renderer/src/assets/avatar/` (confirmed via `git status`: only this directory and
this plan file are untracked). The next session's job is to build the app code around them, not to
regenerate them.

What's there:

```
apps/maestro/src/renderer/src/assets/avatar/
  CREDITS.json                  # machine-readable: source repo, license note, one entry per PNG
                                 # with its authors/licenses/urls pulled from the real CREDITS.csv
  body/{male,female,child}.png
  head/{male,female,child}.png
  eyes/{human,cyclops,cyclops2}.png
  hair/{plain,bangslong,bob,buzzcut,dreadlocks_short}.png
  torso/{tshirt,tshirt_buttoned,leather_armour,plate_armour}.png
  legs/{pants,shorts,skirt_plain,skirt_legion}.png
  feet/{shoes_basic,boots_basic,sandals,shoes_ghillies}.png
  hat/{bandana,bowler,crown,barbarian_helmet}.png
```

8 categories, 3–5 options each, 30 files total. Every filename's basename (minus `.png`) is the
canonical **id** for that option within its category — these ids are what `AVATAR_PARTS` in step 1
must match exactly, and what gets stored in the SQLite `layers` JSON.

**Provenance, verified in this session (don't re-verify unless something looks wrong):**

- Source: `github.com/liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator`
  (`git clone --filter=blob:none --depth 1`, ~88k files under `spritesheets/`, GPL-3.0 repo license,
  `CREDITS.csv` gives per-file authors/licenses — every one of the 30 files here resolved to a real
  credits row; one substitution was needed (`eyes/human/adult/default/idle.png` had **no** CREDITS
  entry at all, so it was swapped for `eyes/eyebrows/thick/adult/idle.png`, which does).
- Frame layout: each source file is a 128×256 "idle" animation strip — 4 rows (`DIRECTIONS =
  [up, left, down, right]`, from `sources/state/constants.ts`) × 2 frames, 64px each. The crop
  used for every layer is `{ left: 0, top: 128, width: 64, height: 64 }` — row index 2 (down/south),
  frame 0 — i.e. the character standing still, facing the viewer. (Gemini's original script cropped
  `{0,0,64,64}` — the top-left frame of whatever animation it was pointed at, not necessarily this
  pose. That's part of why "just run the scraper" wasn't safe to do unattended.)
- Layering was verified by actually compositing body+legs+feet+torso+head+eyes+hair at (0,0) on a
  64×64 canvas with `sharp` — it produces a correctly-aligned character (a small orange-haired
  sprite in a t-shirt was rendered and visually confirmed). **Z-order bottom→top that was verified
  to work:** `body → legs → feet → torso → head → eyes → hair → hat` (hat wasn't in the composite
  test but obviously goes last, on top of hair).
- `body` and `head` are separate layers in this asset set (unlike some LPC forks) — the `body`
  layer is headless (neck down), and `head` is a separate layer that sits in the empty upper portion
  of the same 64×64 frame. Both must always be rendered (never "none").

**License obligation:** GPL-3.0 (repo-level) plus per-file CC-BY-SA-3.0/OGA-BY-3.0 (see
`CREDITS.json`). The app must surface attribution somewhere reachable — see step 7.

**If the curated selection ever needs to change** (add/remove an option, swap a bad pick), the
reproduction script is documented but was **not** yet written to disk — the last thing this session
did before being asked to write this plan instead. The working version lived at
`/tmp/.../scratchpad/vendor-tool/run.mjs` in the prototyping session and is not guaranteed to still
exist. Regenerating it is straightforward, not a blocker: `sharp` (installed ad hoc, `npm install
--no-save sharp` — **not** a project dependency, this codebase deliberately avoids native modules,
see `skill-tags.ts`'s header comment on why `node:sqlite` was chosen over `better-sqlite3`) plus a
partial clone of the LPC repo (`git clone --filter=blob:none --depth 1 --no-checkout
https://github.com/liberatedpixelcup/Universal-LPC-Spritesheet-Character-Generator.git`, then
`git sparse-checkout set spritesheets/<only the needed paths> CREDITS.csv`, `git checkout master`),
crop `{left:0, top:128, width:64, height:64}` from each `.../idle.png`, and cross-reference
`CREDITS.csv` (RFC4180, has quoted fields with embedded commas — don't naive-split on `,`) by the
path relative to `spritesheets/`. Consider writing this as `apps/maestro/scripts/
vendor-avatar-parts.mjs` (mirroring `scripts/build-plugin-libs.mjs`'s location) for future
reproducibility, documented as a one-time/occasional tool, not a build step.

## Implementation steps

### 1. `src/core/contracts.ts` — canonical part list (pure, renderer-safe)

Add, following the exact pattern `SKILL_TAGS`/`SkillTag` already uses in this file (a `const`
array + derived type, self-contained, no imports — that's what makes it renderer-safe per this
file's own header comment):

```ts
export const AVATAR_CATEGORIES = ["body", "head", "eyes", "hair", "torso", "legs", "feet", "hat"] as const;
export type AvatarCategory = (typeof AVATAR_CATEGORIES)[number];

/** body/head/eyes are always rendered (never "none"); the rest may be null. */
export const AVATAR_REQUIRED_CATEGORIES: readonly AvatarCategory[] = ["body", "head", "eyes"];

export interface AvatarPartOption {
  id: string;
  name: string;
}

/** Must match the filenames under src/renderer/src/assets/avatar/<category>/<id>.png exactly. */
export const AVATAR_PARTS: Record<AvatarCategory, AvatarPartOption[]> = {
  body: [
    { id: "male", name: "Male" },
    { id: "female", name: "Female" },
    { id: "child", name: "Child" },
  ],
  head: [
    { id: "male", name: "Male" },
    { id: "female", name: "Female" },
    { id: "child", name: "Child" },
  ],
  eyes: [
    { id: "human", name: "Human" },
    { id: "cyclops", name: "Cyclops" },
    { id: "cyclops2", name: "Cyclops (alt)" },
  ],
  hair: [
    { id: "plain", name: "Plain" },
    { id: "bangslong", name: "Long Bangs" },
    { id: "bob", name: "Bob" },
    { id: "buzzcut", name: "Buzzcut" },
    { id: "dreadlocks_short", name: "Short Dreadlocks" },
  ],
  torso: [
    { id: "tshirt", name: "T-Shirt" },
    { id: "tshirt_buttoned", name: "Buttoned Shirt" },
    { id: "leather_armour", name: "Leather Armor" },
    { id: "plate_armour", name: "Plate Armor" },
  ],
  legs: [
    { id: "pants", name: "Pants" },
    { id: "shorts", name: "Shorts" },
    { id: "skirt_plain", name: "Plain Skirt" },
    { id: "skirt_legion", name: "Legion Skirt" },
  ],
  feet: [
    { id: "shoes_basic", name: "Shoes" },
    { id: "boots_basic", name: "Boots" },
    { id: "sandals", name: "Sandals" },
    { id: "shoes_ghillies", name: "Ghillie Shoes" },
  ],
  hat: [
    { id: "bandana", name: "Bandana" },
    { id: "bowler", name: "Bowler Hat" },
    { id: "crown", name: "Crown" },
    { id: "barbarian_helmet", name: "Barbarian Helmet" },
  ],
};

/** One id per category, or null for an optional category left empty. */
export type AvatarLayers = Record<AvatarCategory, string | null>;
```

### 2. `src/core/avatar-store.ts` — new module, same shape as `skill-tags.ts`

Read `src/core/skill-tags.ts` first and mirror its structure exactly (header comment explaining
why `node:sqlite` over a native module, `openDb`/`CREATE TABLE IF NOT EXISTS`, try/finally
`db.close()`).

```ts
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AVATAR_CATEGORIES, AVATAR_PARTS, type AvatarCategory, type AvatarLayers } from "./contracts.js";

export const DEFAULT_AVATAR_DB_PATH = path.join(os.homedir(), ".claude", "maestro-avatars.sqlite");

function openDb(dbPath: string) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_avatars (
      agent_name TEXT PRIMARY KEY,
      layers     TEXT NOT NULL
    )
  `);
  return db;
}

function isValidLayers(value: unknown): value is AvatarLayers {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return AVATAR_CATEGORIES.every((cat) => {
    const id = v[cat];
    if (id === null) return true;
    if (typeof id !== "string") return false;
    return AVATAR_PARTS[cat].some((opt) => opt.id === id);
  });
}

export function getAvatar(agentName: string, dbPath: string = DEFAULT_AVATAR_DB_PATH): AvatarLayers | null {
  const db = openDb(dbPath);
  try {
    const row = db.prepare("SELECT layers FROM agent_avatars WHERE agent_name = ?").get(agentName) as
      | { layers: string }
      | undefined;
    if (!row) return null;
    const parsed: unknown = JSON.parse(row.layers);
    return isValidLayers(parsed) ? parsed : null;
  } finally {
    db.close();
  }
}

/** Rejects (throws) on an invalid category id — same discipline as setSkillTags, checked before write. */
export function setAvatar(
  agentName: string,
  layers: AvatarLayers,
  dbPath: string = DEFAULT_AVATAR_DB_PATH
): AvatarLayers {
  if (!isValidLayers(layers)) throw new Error("Invalid avatar layers.");
  const db = openDb(dbPath);
  try {
    db.prepare(
      "INSERT INTO agent_avatars (agent_name, layers) VALUES (?, ?) " +
        "ON CONFLICT(agent_name) DO UPDATE SET layers = excluded.layers"
    ).run(agentName, JSON.stringify(layers));
    return layers;
  } finally {
    db.close();
  }
}
```

(A `deleteAvatar` is optional — only add it if step 6/7's UI ends up wanting a "reset" action.)

### 3. IPC wiring — three files, mirroring `reports.get`/`reports.save` exactly

Read the `reports` entries in `src/shared/ipc.ts` (search `reportGet`/`reportSave` and the
`reports:` block in `MaestroApi`), `src/main/ipc.ts` (search `"── reports"`), and
`src/preload/index.ts` (search `reports:`) — the avatar channels are structurally identical, just
swapping the resolution logic (`reports` resolves project-override-else-global; avatar is a flat
global get/set, closer to `skillTags.set`'s shape but needs a matching `get`).

- `src/shared/ipc.ts`:
  - `IPC.avatarGet = "avatar:get"`, `IPC.avatarSet = "avatar:set"` (add near `skillTagsSet`, with a
    comment explaining global-by-agent-name storage, same as the existing comment on `skillTagsSet`
    explains global-by-skill-id).
  - Import `AvatarLayers` from `../core/contracts.js` at the top (this file already imports other
    contract types the same way — check the existing import block).
  - Add to `MaestroApi`:
    ```ts
    avatar: {
      get(agentName: string): Promise<AvatarLayers | null>;
      set(agentName: string, layers: AvatarLayers): Promise<AvatarLayers>;
    };
    ```
- `src/main/ipc.ts`: import `getAvatar`, `setAvatar` from `../core/avatar-store.js`, add handlers
  right after the `skillTagsSet` block:
  ```ts
  ipcMain.handle(IPC.avatarGet, (_e, agentName: string) => getAvatar(agentName));
  ipcMain.handle(IPC.avatarSet, (_e, agentName: string, layers: AvatarLayers) => setAvatar(agentName, layers));
  ```
  Note these do **not** call `currentRoot()` — avatar storage isn't project-scoped.
- `src/preload/index.ts`: add
  ```ts
  avatar: {
    get: (agentName) => ipcRenderer.invoke(IPC.avatarGet, agentName),
    set: (agentName, layers) => ipcRenderer.invoke(IPC.avatarSet, agentName, layers),
  },
  ```

### 4. `src/renderer/src/assets/avatar/manifest.ts` — asset URL map

Import every PNG individually (there are only 30; don't reach for `import.meta.glob` for this few)
so Vite fingerprints them and resolves correctly under the packaged `file://` build's `base: "./"`
— **do not** put these in `public/` and reference by absolute path (see "What was wrong" §4 above).

```ts
import bodyMale from "./body/male.png";
import bodyFemale from "./body/female.png";
// ...all 30, following the same pattern...

import { AVATAR_CATEGORIES, type AvatarCategory } from "../../../../core/contracts.js"; // adjust relative path

export const AVATAR_LAYER_URLS: Record<AvatarCategory, Record<string, string>> = {
  body: { male: bodyMale, female: bodyFemale, child: bodyChild },
  head: { male: headMale, female: headFemale, child: headChild },
  eyes: { human: eyesHuman, cyclops: eyesCyclops, cyclops2: eyesCyclops2 },
  hair: { plain: hairPlain, bangslong: hairBangslong, bob: hairBob, buzzcut: hairBuzzcut, dreadlocks_short: hairDreadlocksShort },
  torso: { tshirt: torsoTshirt, tshirt_buttoned: torsoTshirtButtoned, leather_armour: torsoLeatherArmour, plate_armour: torsoPlateArmour },
  legs: { pants: legsPants, shorts: legsShorts, skirt_plain: legsSkirtPlain, skirt_legion: legsSkirtLegion },
  feet: { shoes_basic: feetShoesBasic, boots_basic: feetBootsBasic, sandals: feetSandals, shoes_ghillies: feetShoesGhillies },
  hat: { bandana: hatBandana, bowler: hatBowler, crown: hatCrown, barbarian_helmet: hatBarbarianHelmet },
};

/** Bottom to top — verified by compositing in the prototyping session. */
export const AVATAR_RENDER_ORDER: AvatarCategory[] = ["body", "legs", "feet", "torso", "head", "eyes", "hair", "hat"];
```

Cross-check every id here against `AVATAR_PARTS` in `contracts.ts` (step 1) — they must match
exactly, ideally asserted by a small test (`test/core/` has the pattern for this kind of parity
check — see `parity.test.ts` for the general idea, though that one's about something else).

### 5. `src/renderer/src/utils/avatar.ts` — pure renderer-side helpers

```ts
import { AVATAR_CATEGORIES, AVATAR_PARTS, AVATAR_REQUIRED_CATEGORIES, type AvatarLayers } from "../../../core/contracts.js";

export function randomAvatarLayers(): AvatarLayers {
  const layers = {} as AvatarLayers;
  for (const cat of AVATAR_CATEGORIES) {
    const options = AVATAR_PARTS[cat];
    const required = AVATAR_REQUIRED_CATEGORIES.includes(cat);
    // required categories always pick one; optional categories get a chance at "none"
    if (!required && Math.random() < 0.4) {
      layers[cat] = null;
    } else {
      layers[cat] = options[Math.floor(Math.random() * options.length)].id;
    }
  }
  return layers;
}
```

No IPC needed for randomization — it's pure client-side data already available via `contracts.ts`.

### 6. `src/renderer/src/components/avatar/`

- `avatar-canvas.tsx` — `<canvas>`, draws `AVATAR_RENDER_ORDER` in order via `AVATAR_LAYER_URLS`,
  `ctx.imageSmoothingEnabled = false`, canvas `width={64} height={64}` with CSS upscale
  (`imageRendering: "pixelated"`) — same pattern the original blueprint had right, just fed from
  the real manifest instead of a scraped JSON. Load images with `Promise.all`, skip `null` layers.
- `avatar-picker.tsx` — one row per `AVATAR_CATEGORIES` entry, a swatch button per
  `AVATAR_PARTS[category]` option (plus a "None" swatch for categories not in
  `AVATAR_REQUIRED_CATEGORIES`), a Randomize button calling `randomAvatarLayers()`, and the
  `<AvatarCanvas>` preview. Controlled component: `{ value: AvatarLayers; onChange:
  (layers: AvatarLayers) => void }`.

### 7. Wire into `create-subagent.tsx`

- `useState<AvatarLayers>(randomAvatarLayers())` initial state (or lazy initializer).
- Render `<AvatarPicker>` as a new field — either a 7th `Field`/row (extend `FIELD_IDS`/`ROW_IDS`
  for the ⌘-jump shortcuts) or inside the preview pane next to `SubagentTemplatePreview`; either is
  fine, it's a layout call for whoever implements this.
- `useCreateFlow`'s `create(request, onWritten?)` in `src/renderer/src/utils/create-flow.tsx`
  currently calls `onWritten?.()` with no arguments (line ~88: `onWritten?.();`). Widen the type to
  `onWritten?: (result: ScaffoldResult) => void` and change the call to `onWritten?.(res.value)`.
  This is backward-compatible — the other three create routes (`create-skill.tsx`,
  `create-plugin.tsx`, `create-marketplace.tsx`) pass zero-arg callbacks today, and a function
  expecting fewer parameters than the type declares is still assignable in TypeScript, so they
  don't need to change.
- In `create-subagent.tsx`'s `submit()`, change the `onWritten` callback to also save the avatar:
  ```ts
  flow.create({ kind: "create-subagent", ...values }, (result) => {
    reset({ ...values, name: "", idea: "", description: "", triggers: [], tools: [] });
    void window.maestro.avatar.set(result.name, avatarLayers);
    setAvatarLayers(randomAvatarLayers()); // fresh default for the next agent
  });
  ```
  Note `result.name` is the **resolved** kebab-case name (may differ from the form's `name` field
  in auto mode, where a blank name is derived from the idea) — this is exactly why `ScaffoldResult`
  carries `name` and why `agents.tsx`'s `DiscoveredDefinition.id` is documented as `= a.name` in
  `discovery.ts`'s `discoverAgents()`. The avatar must be keyed by `result.name`, not the form
  value, or it silently won't match what `/agents` looks up later.

### 8. Wire into `agents.tsx` detail pane

- On selecting an agent (existing `selected` state), also fetch
  `window.maestro.avatar.get(selected)` alongside the existing `reports.get` call.
- Render `<AvatarCanvas>` with the resolved layers (or a default/placeholder if `null` — no avatar
  saved yet, e.g. an agent that existed before this feature shipped).
- A "Customize" affordance (button opening the same `<AvatarPicker>` inline or in a small dialog)
  that calls `window.maestro.avatar.set(selected, layers)` on change/save.
- **Do not** modify `DiscoveredDefinitionsList` (`components/tabs/discovered-definitions.tsx`) to
  show avatar thumbnails in the left-hand list — it's shared with `/skills`, which has no avatars,
  and threading avatar data through it means either a shared component special-casing agents or a
  batch-fetch of every agent's avatar just to render a list. Keep avatar display to the detail pane
  only; this was a deliberate scope cut, not an oversight, if a future session wants to revisit it.

### 9. License attribution surface (GPL-3.0/CC-BY-SA-3.0 obligation)

`CREDITS.json` already has everything needed. Minimum bar: a short credit line near the picker
("Character art: Universal LPC Spritesheet — GPL-3.0 / CC-BY-SA 3.0") linking to a fuller page.
Nice-to-have: render `CREDITS.json` as a project doc at `apps/maestro/docs/app/avatar-art-
credits.md` (or a generated `CREDITS.md` sitting next to `CREDITS.json`, same directory) so it's
reachable from the global `/docs` reader (`group: "app"`) without hand-authoring the whole table —
the JSON already has `category`/`id`/`name`/`sourcePath`/`authors`/`licenses`/`urls` per entry,
ready to template into a markdown table.

## Validation checklist for whoever implements this

- [ ] `pnpm --filter maestro typecheck` — both tsconfig projects.
- [ ] `pnpm --filter maestro test` — add a parity-style test asserting every id in
      `AVATAR_LAYER_URLS` (manifest.ts) has a matching entry in `AVATAR_PARTS` (contracts.ts) and
      vice versa, so the two can't silently drift (same spirit as `test/core/parity.test.ts`).
- [ ] Build + launch the **packaged** app (`pnpm --filter maestro build` then `electron .`, never
      `pnpm dev` — see `apps/maestro/CLAUDE.md`'s repeated warning about `file://` vs
      `localhost:5173`) and actually create an agent with a customized avatar, confirm the canvas
      renders correctly (not broken image icons — the tell for the `public/`-absolute-path mistake
      this plan avoided), and confirm `~/.claude/maestro-avatars.sqlite` has the row after save.
  Use the `test-maestro-desktop` skill's CDP harness for this rather than eyeballing it, and use a
  throwaway fixture project under `~/gits/` per that skill's fixture rules — never point it at this
  repo itself.
- [ ] Confirm re-opening `/agents`, selecting the created agent, shows the same avatar back
      (round-trip through the sqlite store, not just in-memory state from the create form).
