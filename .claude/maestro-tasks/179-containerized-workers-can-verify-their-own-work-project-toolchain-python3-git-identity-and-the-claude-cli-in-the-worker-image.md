# Containerized workers can verify their own work: project toolchain, python3, git identity and the claude CLI in the worker image

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Task 177's worker ran in the per-project Docker container and could not run the project's verify command: the image has no pnpm, so it handed `pnpm verify` to the user. The image also lacked python3 (36 SessionEnd hook failures), the claude CLI, and a git identity matching the host. With manager approval on, that still leaves the user running verify for every containerized task, which defeats the goal of epics running without them.

Make the worker image carry what the project's own verify command and hooks need, with no secrets baked in:

- The project's package manager and runtime as the project pins them (here pnpm through the version in package.json's packageManager field, via corepack or an equivalent pinned install), so the worker can run `verify_command` from maestro.json inside the container against the bind-mounted repo and its node_modules.
- python3, because hook scripts call it.
- The claude CLI, if the worker's own flow calls it (check where it was needed and say so).
- A git identity matching the host's user.name and user.email, passed at launch (environment or a generated read-only config), never written into an image layer.
- Whatever else the image needs to be decided per project, read from the project (for example maestro.json's verify_command and package.json), not hard-coded to this repo.

Keep the rebuild rule: a change in these inputs changes the image tag so the image rebuilds. Keep the no-secret checks green.

Also fix the handoff for `pnpm refresh:runtime` in a container: `.claude/scripts` and `.claude/settings.json` are read-only there by design, so a containerized worker's request must say to run it on the host (the repo is the same folder), not suggest it can be run in the session. This needs code in the worker-runtime TypeScript source and its plugin script, the worker side of the orchestrator template (and the land-the-task skill if it is where verify is handed off), tests, a real-Docker shell-only check that `verify_command` runs green inside the container, and a plugin version bump.

## Acceptance criteria

- [ ] Inside a freshly built worker container, the project's verify_command (here `pnpm verify`) runs against the bind-mounted repo and exits 0 on a green tree, proven by a real-Docker shell-only run
- [ ] python3 is present in the image and the project's SessionEnd hooks run without missing-interpreter failures
- [ ] Commits made inside the container carry the host's git user.name and user.email, and no identity or secret is written into any image layer (docker history and a whole-filesystem scan stay clean)
- [ ] The claude CLI need is resolved: either present in the image, or the report names where it was called and why it is not needed
- [ ] Changing the toolchain inputs (for example the pinned package manager version) changes the image tag, so the image rebuilds
- [ ] A containerized worker that needs `pnpm refresh:runtime` tells the user to run it on the host; host workers' wording is unchanged
- [ ] Tests cover the image inputs and tag change, the git identity passed at launch, and the container versus host refresh wording; the full suite is green
- [ ] plugins/maestro/.claude-plugin/plugin.json gets a patch bump, the generated libs are rebuilt and the .claude/scripts mirrors refreshed

## Manager direction

- (from r005, 177's error list) "verify green in the container" also needs: the Playwright browser the vitest `browser` project uses (chromium, or the project's equivalent read from its config), and the tests that assert host wording (epics-cli.test, manager-review-protocol.test) pinning `MAESTRO_WORKER_RUNTIME` themselves instead of inheriting the container's `docker` value. The git-identity test (scaffold.test) must pass with the host identity passed at launch, or stop depending on the ambient identity.
- `maestro-session-cleanup.sh` exits 0 having removed nothing when python3 is missing. Make a missing interpreter visible (a clear message), not silent.
- Out of scope here (manager keeps them as a backlog): run id for channel payload stamps, the `done` / `plan-step` ordering in the template, `land-the-task` with pre-existing unrelated edits.

## Touched surfaces

- apps/maestro/src/core/worker-runtime.ts and plugin-entries/maestro-worker-runtime.ts, plus plugins/maestro/scripts/maestro-worker-runtime.cjs and its .claude/scripts mirror
- plugins/maestro/templates/maestro/SKILL.md (worker side) and the rendered .claude/skills/maestro/SKILL.md
- plugins/maestro/skills/land-the-task/SKILL.md (if verify or refresh is handed off there)
- plugins/maestro/.claude-plugin/plugin.json (version, patch; also bumped by standalone task 178, so merge order: whichever lands second rebases)
- generated libs and .claude/scripts mirrors (user runs `pnpm refresh:runtime`)

## Blocked by

None — can start immediately

## Post-Mortem

- **Problem:** The first image could not run `verify_command`: corepack's pnpm 12 downloads its native binary lazily and the corepack home was read-only for the non-root worker (EACCES). Only the real-Docker run could show it; unit tests were green.
  **Fix:** none
- **Problem:** Six tests failed only inside the container: four "no CLI" tests found the `claude` the image now installs (system fallback dirs in `claudeSearchDirs`), two kill tests waited on zombie grandchildren (no init as PID 1). Fixed with a `systemDirs` option, a zombie-aware `alive()` and `--init` in the check script; the real worker launch still has no `--init`.
  **Fix:** none
- **Problem:** The check script's token scan was too loose (`sk-ant-`, `oauth_token`) and flagged a test fixture, an epic report and yarn's source. Tightened to real token shapes.
  **Fix:** none
- **Problem:** A hand-written plugin script failed the Prettier check during `refresh:runtime`, and the sandbox cannot run Docker or write the mirrors, so each fix needed a user-run round trip.
  **Fix:** none
