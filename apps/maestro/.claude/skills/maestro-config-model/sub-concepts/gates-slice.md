# Gates slice

`MaestroGatesSlice` is `gates: { confidence_check: boolean; use_code_architecture_design_check: boolean }` — the two
optional checks the orchestrator's **Step 1** runs before it classifies a request. Both default to
**off**: `defaultV3Config` seeds them `false`, and there is no migration, so a project installed
before `032` simply has no `gates` field.

All four combinations are valid and none nests inside another — design-only is a real state, not a
degenerate one.

## `resolveGates` is the only reader, and it is deliberately paranoid

```ts
export const DEFAULT_GATES: MaestroGates = { confidence_check: false, use_code_architecture_design_check: false };
```

`resolveGates(cfg)` reads each field with a strict `=== true`, so a missing config, an absent or
non-object `gates`, and a value that is `"true"`, `1` or `null` all resolve to **off**. It returns a
fresh object every call — never a shared reference a caller could mutate into the config.

**The key was renamed once, and the rename was not migrated.** `use_design_check` became
`use_code_architecture_design_check` when the gate skill was renamed. `resolveGates` reads only the
new name with `=== true`, so an existing `maestro.json` carrying the old key resolves to **off** —
a project that had the design gate on loses it silently, and the stale key is left in the file. The
paranoid reader is what makes this quiet rather than an error; re-ticking the box on `/maestro`
writes the new key.

**Off is the answer to every unclear case, on purpose.** The alternative — "preserve the historical
behaviour and run both" — would make a corrupt config quietly cost two skill invocations per
`/maestro` run, which is the overhead this slice exists to remove.

The runtime has its own reader, `plugins/maestro/scripts/maestro-step1-gates.cjs`, which resolves
the same field with the same rule and prints the orchestrator's whole Step 1 as one line — the
instruction, not a flag the skill body branches on. It shares no code with
this one (it is a dependency-free `.cjs` that is not a `plugin-entries` bundle), so a change to the
resolution rule has to be made in both. See `maestro-architecture` for what the line does.

## Where it is written from

`/maestro`'s Step 1 gates card, one `saveConfig(root, { sliceType: "gates", … })` per checkbox
click — no Save button, the same shape as the project-tags card. Unlike `project-tags` there is
**no** second cross-slice write: a gate flag implies nothing about the project's agents or skills.

The main-process read handler falls back to `DEFAULT_GATES` rather than rejecting when no project is
open, because the card's route is reachable in that state.

## The barrel rule bites here

`MaestroGates` / `MaestroGatesSlice` are re-exported from `contracts.ts` and **not** from the
`src/core/index.ts` type barrel — same treatment as `MaestroProjectTagsSlice`, so the renderer's
type graph does not pull `fs` in. The *values* `resolveGates` and `DEFAULT_GATES` **are** on the
barrel, because `src/main/` needs them.

Files: `src/core/types.ts`, `src/core/config.ts` (`resolveGates`, `DEFAULT_GATES`, the `gates` arm
of `mergeSlice`), `src/core/contracts.ts`, `src/core/seed.ts`, `src/shared/ipc.ts`
(`data:gates` / `project:gates:set`), `src/renderer/src/routes/maestro.tsx` (`GatesCard`).
