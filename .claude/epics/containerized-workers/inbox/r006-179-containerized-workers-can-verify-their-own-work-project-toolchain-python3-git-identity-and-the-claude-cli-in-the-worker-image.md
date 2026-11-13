# Report r006: 179-containerized-workers-can-verify-their-own-work-project-toolchain-python3-git-identity-and-the-claude-cli-in-the-worker-image.md

- Task: 179-containerized-workers-can-verify-their-own-work-project-toolchain-python3-git-identity-and-the-claude-cli-in-the-worker-image.md
- Written: 2026-11-13T16:33:23.828Z
- From session: containerized-workers-179

# Report: task 179 (containerized workers verify their own work)

## Outcome
Done and committed on branch `task-179`: commits 3f975b3 and 1fa9609 (HEAD 1fa9609). Not merged, not pushed.

## Verification
- Commit verified: 1fa9609. `pnpm verify` (the project's verify_command) green on it: lint, check, typecheck, 176 test files, 3431 tests passed. Parity test green (44).
- Real-Docker run, by the user on the host: `bash apps/maestro/scripts/check-worker-verify.sh` passed after the fixes below. Inside a freshly built image `pnpm verify` exited 0, python3 is present, a commit made in the container carried the host's name and email (passed as `GIT_AUTHOR_*` / `GIT_COMMITTER_*` at launch), and the docker-history and whole-filesystem scans found no token or identity. The image tag of the final run (layout marker 6) was not captured in the output the user pasted; the earlier first build was `maestro-worker-maestro:bf3bc6f5215e` (layout 5).
- The in-container run is what settled the claude CLI question: claude.test and create-preview.test now pass inside the container. The CLI is installed in the image (it is the worker's entry command, `claude -n <name>`), and the four "no CLI" tests failed only because they found it.

## What changed
- `worker-runtime.ts`: `detectToolchain` reads the project (package.json `packageManager` with the sha dropped, the browser a vitest config names plus the playwright version, `make` if `verify_command` names it). Dockerfile installs python3, the pinned manager (corepack for pnpm/yarn, `npm install -g` for npm/bun), runs the manager once at build time so pnpm 12's native binary is fetched, and installs the Playwright browser. Toolchain is part of the tag inputs; layout marker 4 -> 6.
- `refreshRuntimeWords()`: a containerized worker is told to run `pnpm refresh:runtime` on the host; host wording unchanged. Wired into the merge hint in `maestro-task-status.cjs`; template SKILL.md and land-the-task carry the rule.
- `maestro-session-cleanup.sh` prints a clear message on stderr when python3 is missing (still exit 0). New hermetic test.
- `claude-cli.ts`: optional `systemDirs`; production resolution unchanged.
- Tests pin `MAESTRO_WORKER_RUNTIME` (manager-review-protocol sets host; epics-cli deletes the variable, which means host); scaffold.test no longer depends on the ambient git identity.
- plugin.json 0.15.10 -> 0.15.11, libs rebuilt, mirrors refreshed by the user (`pnpm refresh:runtime`).

## Findings and suggested ticket changes
- The real worker launch (`workerRunArgs`) has no `--init`. Only the check script uses it. Without an init as PID 1, orphaned grandchildren stay zombies in a worker session. Suggest a small ticket; it shifts argument positions an existing test asserts.
- `refreshRuntimeWords` is wired only into the merge hint; other places that mention `pnpm refresh:runtime` still use fixed text. Container wording in the template and land-the-task is untested prose.
- The image's marketplace copy of this repo includes `.claude/epics/*/inbox` files. Pre-existing from 175/176, not needed in a worker image.
- epics-cli.test deletes `MAESTRO_WORKER_RUNTIME` instead of setting it to host (your direction said pin).
- Plugin version: task 178 also bumps plugin.json; whichever lands second rebases.

## Post-mortem notes
- The first image could not run verify: corepack's pnpm 12 fetches its native binary lazily and the corepack home was read-only for the non-root worker. Unit tests were green; only the real Docker run showed it.
- Six tests failed only in the container (four found the now-installed claude, two waited on zombie grandchildren).
- The check script's first token scan was too loose and flagged a fixture, an epic report and yarn's source.
- A Prettier failure on a hand-written plugin script and on the new test file, found only at verify time.
- The sandbox can't run Docker or write the mirrors, so each fix cost a user-run round trip.
