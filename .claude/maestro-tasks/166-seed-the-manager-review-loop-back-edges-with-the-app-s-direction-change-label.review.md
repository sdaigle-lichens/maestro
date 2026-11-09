## Goal
Seed uses the app's single "manager requested direction change" label on every manager-review loop-back edge, read from one shared constant.

## Deviations
- The constant moved to a new import-free core module (`manager-review-label.ts`); the renderer re-exports it from `review-nodes.ts`, so canvas code and its test are untouched.
- The renderer may only import allowlisted core files, so the new module was added to `tsconfig.web.json` and to `RENDERER_SAFE` in the isolation test.

## Decisions
- Kept the re-export in the renderer rather than rewriting its imports.
- No config migration: existing `maestro.json` files keep their old labels; the drift report covers them.
- Verified that no runtime code matches on the old label text.

## Touches
- `apps/maestro/src/core/manager-review-label.ts` (new), `core/seed.ts`
- `renderer/src/utils/review-nodes.ts`, `tsconfig.web.json`, `test/isolation.test.ts`, `test/core/seed.test.ts`
- Generated `plugins/maestro/scripts/lib/maestro-seed.cjs`; plugin version 0.13.32 to 0.13.33

## Sibling impact
Tasks 163-165 also bump the plugin version and rebuild generated libs; the merge order in the task file covers it (rebase, take the next patch, rebuild).

## Questions
None.
