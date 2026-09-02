# Avatars

A purely cosmetic pixel-art appearance for an agent, composited from category layers, stored once
per agent **name** in `~/.claude/maestro-avatars.sqlite` and shared across every project — the same
discipline as `skill-tags.ts` applied to a different key.

Global for the "same thing everywhere" reason: an agent named the same thing is the same agent
wherever it is used, so its look should follow the name rather than being re-picked per project.

Nothing here affects routing or behaviour; it is appearance only.

Files: `src/core/avatar-store.ts`, `src/renderer/src/components/avatar/`.
Tested for core↔plugin agreement by `test/core/avatar-parity.test.ts`.
