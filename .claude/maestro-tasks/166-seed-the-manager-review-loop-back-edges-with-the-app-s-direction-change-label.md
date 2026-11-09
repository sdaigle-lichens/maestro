# Seed the manager-review loop-back edges with the app's direction-change label

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The built-in seed workflows label the manager-review loop-back edges "manager requested test corrections", "manager requested code corrections" or "manager requested <agent> corrections". The desktop app's workflow canvas labels the same edge "manager requested direction change" when a user adds a manager-review node, which matches what a manager review is: a direction-only check, never a code review. So a fresh install and the app disagree, and the workflow drift report shows this repo's `default` and `tdd` as `differs` from the seed only because of that label.

Make the seed use the single shared direction-change label for every manager-review loop-back edge, taken from one constant that both the app canvas and the seed read, so the two cannot drift again. The constant currently lives in renderer code while the seed is core code that is also bundled into the plugin, so moving it to a place both can import is part of this task. No code matches on the label text (verified by this task). The orchestrator template already tells the orchestrator to follow the "manager requested direction change" edge by name, which the old seed labels never matched, so this also fixes a real mismatch between the seed and the template. Existing projects' configs are not migrated: `maestro.json` is the user's graph, and the drift report already tells them.

This is a code change with tests, plus a rebuild of the generated plugin libs (the bundled seed), a patch plugin version bump and the repo's runtime refresh.

## Acceptance criteria

- [ ] Every manager-review loop-back edge in the seed uses the direction-change label, read from one constant shared with the app canvas
- [ ] Seed tests assert the label; existing seed and canvas tests pass
- [ ] Running the workflow drift report on this repo after the refresh shows `default` and `tdd` differing from the seed only by the deliberate code-graph:scribe load on the scribe node
- [ ] The maestro plugin.json version gets a patch bump, the generated libs are rebuilt, pnpm refresh:runtime and the parity test pass (a sandboxed run hands the user ! pnpm refresh:runtime), and pnpm verify passes

## Touched surfaces

- apps/maestro/src/core/seed.ts
- apps/maestro/src/renderer/src/utils/review-nodes.ts (the constant moves to a module both core and renderer import)
- apps/maestro/src/core/manager-review-label.ts (new shared constant), apps/maestro/tsconfig.web.json and apps/maestro/test/isolation.test.ts (RENDERER_SAFE allowlist)
- plugins/maestro/scripts/lib/maestro-seed.cjs (generated) and its .claude/scripts mirror
- plugins/maestro/.claude-plugin/plugin.json (version, shared)
- parallel OK with 163, 164 and 165; merge order: after 165 (last); rebase, take the next patch version, rebuild generated files instead of hand-merging

## Blocked by

None — can start immediately
