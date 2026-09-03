# Avatars

A purely cosmetic pixel-art appearance for an agent, composited from category layers, stored in
`~/.claude/maestro-avatars.sqlite` — global by default, the same discipline as `skill-tags.ts`
applied to a different key.

Global for the "same thing everywhere" reason: a `user`/`maestro`/plugin-tier agent named the same
thing is the same agent wherever it is used, so its look should follow the name rather than being
re-picked per project. A `project`-tier agent is the exception (`030`): the table's primary key is
`(project_root, agent_name)`, `project_root = ''` meaning global, so two projects' same-named
project agents no longer share one avatar row — see the parent `SKILL.md`'s "Keyed by project, not
just agent name" section for the read/write discipline.

Nothing here affects routing or behaviour; it is appearance only.

`readAllAvatars(dbPath?, projectRoot?)` returns every stored avatar keyed by agent name in **one**
db open — the batch read behind `avatar:list`, added so `/agents` can show a composited thumb per
list row without one sqlite open per agent. Passing `projectRoot` merges that project's own rows
over the global ones in the same query. A row whose JSON no longer validates is skipped, not fatal,
so one bad row can't blank the list. `defaultAvatarLayers()` (`src/renderer/src/utils/avatar.ts`)
fills a missing agent: it returns the first option of **every** category except `hat` — it
previously returned only the required ones, which composited a naked sprite onto every
uncustomised row.

All three of `avatar:get`/`set`/`list` take the `projectScoped` flag. `030` originally gave it to
`set` and `list` only, leaving `get` reading the global row for an agent whose avatar `set` had just
written to the project row — a store you can write to one tier and read back from the other. Nothing
in the renderer calls `avatars.get` today (the list is the read path), so it was latent rather than
visible; it is the shape of bug worth fixing at the point the inconsistency appears, not once
something depends on it.

Files: `src/core/avatar-store.ts`, `src/renderer/src/components/avatar/`.
Tested for core↔plugin agreement by `test/core/avatar-parity.test.ts`.
