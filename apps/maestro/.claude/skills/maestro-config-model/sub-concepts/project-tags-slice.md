# Project tags slice

`MaestroProjectTagsSlice` is `project_tags: string[]` — which Project Tags catalog entries this
project belongs to. Selected once at install from repo-detection evidence (backend / frontend /
mobile only) and editable afterward from `/maestro`.

Absent means none recorded yet, which is what a project predating the field looks like — not the
same as "belongs to no tags".

**Two writers now share `applyProjectTagsSet`** (`main/ipc.ts`): the plain `project:tags:set`
handler behind the `/maestro` checkbox editor, and `install:accept-uncataloged-project-tag`, the
consent step for a category `installRuntime` detected but found absent from the catalog (see the
`installing-maestro` skill's manifest sub-concept). Both calls do the same two writes — add the tag
to the global catalog, union it into this project's `project_tags` — which is why the write moved
into a shared helper instead of staying inlined in the checkbox handler.

Files: `src/core/types.ts`, `src/core/project-tags.ts`, `src/core/detect.ts`, `src/core/repo.ts`,
`src/main/ipc.ts`.
