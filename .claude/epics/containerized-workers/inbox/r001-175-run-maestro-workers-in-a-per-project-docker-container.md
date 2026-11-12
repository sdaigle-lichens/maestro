# Report r001: 175-run-maestro-workers-in-a-per-project-docker-container.md

- Task: 175-run-maestro-workers-in-a-per-project-docker-container.md
- Written: 2026-11-12T16:57:33.580Z
- From session: containerized-workers-175

# Report: task 175, containerized worker runtime

Outcome: code, tests, docs and plugin changes are in and committed. The real-Docker criteria are NOT yet verified (see below).

Commit: 85463b7 on branch task-175. Verified: `pnpm verify` (lint, check, typecheck, full test suite) green on that commit, 173 test files, 3328 tests.

## Done
- worker-runtime core module, bundle entry and generated lib, plus `maestro-worker-runtime.cjs` with `image` and `run` commands.
- `worker_runtime` ("host" default, "docker") in maestro.json; `maestro-epic.cjs ready` prints the docker launch command only for "docker". Host output is unchanged (tested byte-identical).
- Read-only mounts: the six paths from the ticket; settings.local.json is replaced by a hooks-free copy; the task worktree dir is created and mounted at its own path; no herdr socket.
- Token read at launch from ~/.config/maestro/worker-token, passed only as a bare env var; a missing file stops the launcher before docker.
- Image trusts the project and its parent dir (covers the sibling `<repo>-task-N`), and bakes known_marketplaces.json for the pinned plugins (credentialed URLs refused).
- Plugin version 0.15.6 -> 0.15.7 (patch, per the manager direction), docs updated, mirrors refreshed.

## Unverified until a real container run (the user runs these via `!`)
1. No token in any image layer (only the build context is checked).
2. Real `docker build`, image reuse, and rebuild on a plugin version change.
3. First human-review stop with no login, onboarding, trust, guardrails or settings prompt.
4. Read-only paths unwritable; guardrails hook off; other hooks (code-graph Stop included) clean.
5. Plugin loading and the disabled Claude Code sandbox (managed-settings sandbox.enabled=false) inside the container.
6. Worktree trust at `<repo>-task-N` (assumes a trusted parent dir is honoured; fallback is adding the exact path at run time); the worktree is reachable on the host; file ownership is the host user.
7. Whether a `maestro-epic.cjs` inbox write (report or review-request) prompts inside the container: NOT YET KNOWN. Task 176 depends on this result.
8. `-it` with a real TTY.

## Findings
- `run` does not build the image: after a plugin bump it fails with a message to run `image` first.
- Hook packages other than ts-morph need `--with-package name@version`.

## Post-mortem notes
- The test agent ended a HANDOFF: success without writing its payload file, and did not write it after three resume requests; the user created it by hand. Worth a look at why the agent's Write to `.claude/channels/` did not happen.
- The backend agent used `cd` + `sed -i` once, against the guardrails.

## Suggested ticket changes
- Task 175's acceptance criteria 1, 2, 4, 5, 6, 8 stay open until the container run is done. Consider a follow-up ticket for it, or record the results here once the user has run them.
