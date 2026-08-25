# Fold maestro-core into the Maestro app

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Carry out the move described in `docs/plans/core-absorption.md`: the node-side Maestro logic stops
being a workspace package and lives inside the desktop app instead.

`maestro-core` was extracted for "the same code serving two consumers that cannot share a runtime",
and that reason has expired. The plugin's hook scripts are not a runtime consumer — they get
**generated CJS bundles**, not imports — so the coupling is at build time, and `esbuild` does not
care which directory its entry point sits in. What is left is one importing workspace plus the
ceremony of a package: its own `package.json`, `tsconfig.json`, `vitest.config.ts`, a workspace
dependency edge, an export surface, and a `pnpm install` on every change.

**Sequencing.** The plan places this *after* M5, which deletes `apps/ai-tools-manager` — the only
other plausible consumer of the package — and *before* M6, so help-server's node logic lands in the
final structure rather than being written into `packages/` and moved a week later. Both edges are
recorded as task dependencies below and in the M6 slices.

Two parts of this carry real risk and deserve the bulk of the attention:

**The generated plugin libs.** `build:plugin-libs` is the one thing this refactor can genuinely
break, and it breaks *quietly*: the committed `.cjs` files keep working, so nothing fails until
someone edits a source module and the plugin silently keeps the old behaviour. Treat the build
script as load-bearing, not an afterthought.

**The contracts boundary.** Today the renderer-safe surface is enforced by a package export — the
renderer imports `@repo/maestro-core/contracts`, and reaching for the barrel instead (which
re-exports `fs`, `child_process`, and `import.meta.dirname`) would be an obvious, reviewable
mistake. After the move both are relative paths and the difference is one word in an import line.
That is a real regression in safety and must be replaced by an explicit check that fails loudly.

Also fold in the package README's "generated plugin libs — do not hand-edit" warning, and fix
`discovery.ts`'s bundled-agents directory resolution rather than just adjusting its `../`s — the
depth changes with the move *and* the existing `import.meta.dirname` approach is already suspect
once electron-vite bundles main.

## Acceptance criteria

- [ ] The file move lands as a pure rename commit — `git show --stat` reports renames only, with
      zero content changes, so the diff stays reviewable
- [ ] `packages/maestro-core/` is gone, along with the workspace dependency edge, and a root
      install leaves a clean lockfile with no dangling reference to it
- [ ] `pnpm --filter maestro test` runs the core and app suites as one suite, with no test lost
      in the merge
- [ ] `pnpm --filter maestro typecheck` is clean on both tsconfig projects
- [ ] Regenerating the plugin libs from the new location produces byte-identical bundles — the
      only diff in `plugins/ai-tools-manager/scripts/lib/` is the provenance banner's path
- [ ] The provenance banner in the generated `.cjs` files points at the script's new location; a
      banner pointing at a directory that no longer exists is worse than none
- [ ] The Maestro hooks still run end to end: injecting agent context against a scratch project
      still resolves a success route through a human-review node and injects the handoff protocol
- [ ] A check fails loudly when renderer, preload, or shared code imports the core barrel instead
      of the contracts module — demonstrated by deliberately adding such an import and watching it
      fail, since a guard never seen to fail is not a guard
- [ ] The bundled-agents directory still resolves in a packaged build, from the app's own path
      rather than a relative walk out of the bundle output
- [ ] Documentation that pointed at the old package location is updated, including the
      "do not hand-edit the generated libs" warning

## Blocked by

- `009-retire-the-docker-path.md`
