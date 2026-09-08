# Task-routing slice

`MaestroTaskRoutingSlice` is `{ use_maestro_tasks: boolean }` — one field, `use_maestro_tasks?:
boolean`, added top-level to `MaestroConfigV3` (`046`). It is a SIBLING of `gates`, never nested in
it: `gates` is documented specifically as the orchestrator's Step 1 checks, and this is a Step 4
concern with its own write story. Absent means **off**.

## `resolveUseMaestroTasks` mirrors `resolveGates`, with one deliberate difference

```ts
export function resolveUseMaestroTasks(cfg: MaestroConfigV3 | null): boolean {
  if (!cfg || cfg.version !== 3) return false;
  return cfg.use_maestro_tasks === true;
}
```

Same strict `=== true` discipline as `resolveGates`: absent, corrupt config, a non-boolean value —
all resolve to **off**. The difference is the explicit `cfg.version !== 3` check. `resolveGates`
skips that check because `readConfig` already normalizes a non-v3 config to a blank one before
`resolveGates` ever sees it; `resolveUseMaestroTasks`'s acceptance criteria specifically required a
**raw, unnormalized** `cfg` with `version !== 3` to resolve to `false` on its own, so the check is
inline rather than assumed from the caller.

The runtime has its own reader, `plugins/maestro/scripts/maestro-step4-gate.cjs`, which cannot
import from `src/core` (it is a project-only script, like `maestro-step1-gates.cjs` and
`maestro-task-status.cjs`) and re-implements the same rule reading `.claude/maestro.json` directly
with `fs`, with a comment cross-referencing this function. A change to the resolution rule has to be
made in both. It prints exactly one line — naming `/to-maestro-tasks` when the setting resolves
true, a neutral line when false/absent/corrupt — never silence, matching Step 1's "an explicit line
says the script ran and the answer is deliberate" reasoning. See `maestro-architecture` (root
`.claude/skills`) for what the line does and why a missing script kills `/maestro` outright rather
than degrading.

## Two writers

`plugins/maestro/scripts/maestro-enable-task-routing.js` (`047`) is the standalone-hook writer — a
hook, dual-registered exactly like `maestro-step0.js` (`UserPromptExpansion` matcher
`to-maestro-tasks`, `PreToolUse` matcher `Skill`), that flips the field to `true` the first time
`/to-maestro-tasks` is invoked in a session, by either entrance. It does not build on
`resolveUseMaestroTasks` or the `mergeSlice` arm — those are app-side reads, and this is a
project-only script (like `maestro-step4-gate.cjs`) that reads `.claude/maestro.json` with `fs`
directly, re-implementing the same `=== true` no-op check inline rather than importing it. Any read
failure (missing file, corrupt JSON, non-object/array shape) or an already-`true` value is a silent
no-op; otherwise it mutates only that one key and writes back with `JSON.stringify(cfg, null, 2)`,
matching `writeConfig`'s serialization byte for byte.

`TaskRoutingCard` (`048`), on the app's `/maestro` page, is the other — same
write-on-every-click-no-Save-button pattern as `GatesCard`, same
`status?.installed && viewedRoot` visibility guard, rendered directly below `GatesCard`. It DOES
build on `resolveUseMaestroTasks` and the `mergeSlice("task-routing", …)` arm, since it runs inside
the app: `window.maestro.data.taskRouting()` reads `TaskRoutingData` (`{ useMaestroTasks: boolean
}`, mirrors `GatesData`) on mount, and the checkbox's click handler calls
`window.maestro.project.taskRouting.set(!data.useMaestroTasks)`. The main-process handlers are
`IPC.taskRoutingData` (`resolveUseMaestroTasks(readConfig(projectRoot))`, falling back to `{
useMaestroTasks: false }` with no project open — never rejects, same discipline as
`IPC.gatesData`/`DEFAULT_GATES`) and `IPC.taskRoutingSet` (throws `"No project is open."` with no
project, otherwise re-resolves the renderer's boolean through `resolveUseMaestroTasks` before
writing — same "don't trust the renderer's shape" discipline `IPC.gatesSet` uses for `MaestroGates`
— then `saveConfig(root, { sliceType: "task-routing", slice: { use_maestro_tasks: resolved } })`).

**The two writers never race.** The hook only ever sets the field `true`; the card can set it either
way. Both go through the same `mergeSlice("task-routing", …)` arm on the write side, so neither can
clobber another slice — the same read-before-write discipline the config model's own header
describes for any slice with more than one writer, satisfied trivially here because the slice is one
boolean and every write replaces the whole thing.

## Trap: a resolver can exist and still be unreachable

`resolveUseMaestroTasks` and `MaestroTaskRoutingSlice` were both written in `046`, entirely inside
`src/core/config.ts` / `src/core/types.ts` — but neither was re-exported from the barrels
`main/ipc.ts` and `shared/ipc.ts` actually import (`core/index.ts` for the value, `core/contracts.ts`
for the type), so `048` could not build the IPC handlers on them until it added both re-exports.
Nothing enforced this at the time — `046`'s own unit tests (`mergeSlice`/`resolveUseMaestroTasks` in
`test/core/config.test.ts`) pass whether or not the barrel exports the function, because they import
`config.ts` directly. If a future concept skill or task page describes `046` as having wired
`resolveUseMaestroTasks`/`MaestroTaskRoutingSlice` end-to-end, that is stale — it defined them but
left them unreachable from `main/ipc.ts` and `shared/ipc.ts` until `048`.

## Files

`src/core/types.ts` (`use_maestro_tasks?`, `MaestroTaskRoutingSlice`), `src/core/contracts.ts`
(re-exports `MaestroTaskRoutingSlice`, `048`), `src/core/config.ts` (`resolveUseMaestroTasks`, the
`task-routing` arm of `mergeSlice`), `src/core/index.ts` (re-exports `resolveUseMaestroTasks`,
`048`), `src/shared/ipc.ts` (`TaskRoutingData`, `IPC.taskRoutingData` / `IPC.taskRoutingSet`,
`MaestroApi.data.taskRouting` / `.project.taskRouting.set`, `048`), `src/main/ipc.ts` (the two
handlers, `048`), `src/preload/index.ts` (bridge wiring, `048`), `src/renderer/src/routes/maestro.tsx`
(`TaskRoutingCard`, `048`), `plugins/maestro/scripts/maestro-step4-gate.cjs` (the Step 4 reader),
`plugins/maestro/scripts/maestro-enable-task-routing.js` (`047`, the hook writer).
