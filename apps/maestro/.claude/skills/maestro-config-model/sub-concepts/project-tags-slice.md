# Project tags slice

`MaestroProjectTagsSlice` is `project_tags: string[]` — which Project Tags catalog entries this
project belongs to. Selected once at install from repo-detection evidence (backend / frontend /
mobile only) and editable afterward from `/maestro`.

Absent means none recorded yet, which is what a project predating the field looks like — not the
same as "belongs to no tags".

Files: `src/core/types.ts`, `src/core/project-tags.ts`, `src/core/detect.ts`, `src/core/repo.ts`.
