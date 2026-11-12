## Goal
Containerized worker runtime: per-project Docker image, a launcher, and a `worker_runtime` switch so `maestro-epic.cjs ready` prints the docker launch command.

## Deviations
- Plugin version 0.15.6 -> 0.16.0 (minor), as the ticket asks, although no skill, agent, command or hook event was added.
- The code-graph name is not hardcoded: hook packages are found by scanning enabled plugins' and the project's hook scripts for a quoted `"ts-morph"` (pinned 28.0.0); anything else via `--with-package name@ver`.
- Image sets `sandbox.enabled=false` in `/etc/claude-code/managed-settings.json` to avoid sandbox prompts (a guess, unverified in a real container).
- Two existing interim-stop-160 tests changed: their old-tree install now borrows assets missing from the old tree.

## Decisions
- Planning logic is pure (`fs`/`path`/`crypto`), in one core module; the wrapper script does the docker spawning.
- Token only passed as bare `-e CLAUDE_CODE_OAUTH_TOKEN`; a missing or blank token file stops before docker is touched.
- Image tag = hash of pinned plugin versions, hook packages, Claude Code version, uid/gid and project path.
- The task's `<repo>-task-N` worktree directory is created on the host and mounted at the same path. No herdr socket is mounted.

## Touches
- `apps/maestro/src/core/worker-runtime.ts` (new), its plugin-entry, `epics.ts`, `types.ts`, `install.ts`, `build-plugin-libs.mjs`
- `plugins/maestro/scripts/maestro-worker-runtime.cjs` (new), `maestro-install.js`, generated libs, `plugin.json`
- maestro-manager SKILL.md, maestro-install `references/herdr.md`

## Sibling impact
- Task 176 (messaging) depends on the unverified inbox-write result from a real container.
- `plugin-libs-parity` and `updating-maestro` skills say "seventeen" entries; now eighteen (scribe).

## Questions
- Plugin loading in the container is unverified: `known_marketplaces.json` is not baked, so the project's `extraKnownMarketplaces` may trigger a fetch.
- Trust for the `<repo>-task-N` worktree path is not pre-filled and may prompt.
