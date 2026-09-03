# Avatars

A purely cosmetic pixel-art appearance for an agent, composited from category layers, stored once
per agent **name** in `~/.claude/maestro-avatars.sqlite` and shared across every project — the same
discipline as `skill-tags.ts` applied to a different key.

Global for the "same thing everywhere" reason: an agent named the same thing is the same agent
wherever it is used, so its look should follow the name rather than being re-picked per project.

Nothing here affects routing or behaviour; it is appearance only.

`readAllAvatars(dbPath?)` returns every stored avatar keyed by agent name in **one** db open — the
batch read behind `avatar:list`, added so `/agents` can show a composited thumb per list row without
one sqlite open per agent. A row whose JSON no longer validates is skipped, not fatal, so one bad
row can't blank the list. `defaultAvatarLayers()` (`src/renderer/src/utils/avatar.ts`) fills a
missing agent: it returns the first option of **every** category except `hat` — it previously
returned only the required ones, which composited a naked sprite onto every uncustomised row.

Files: `src/core/avatar-store.ts`, `src/renderer/src/components/avatar/`.
Tested for core↔plugin agreement by `test/core/avatar-parity.test.ts`.
