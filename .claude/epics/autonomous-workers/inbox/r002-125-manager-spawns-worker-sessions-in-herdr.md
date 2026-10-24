# Report r002: 125-manager-spawns-worker-sessions-in-herdr.md

- Task: 125-manager-spawns-worker-sessions-in-herdr.md
- Written: 2026-10-24T15:00:15.296Z
- From session: maestro-fa8c8c5e

# Task 125 report: manager spawns worker sessions in herdr

## Outcome
Done, all 8 acceptance criteria met. Uncommitted in the main checkout (the user decides when to commit). Gates: full maestro suite 2175/2175, parity, `pnpm check`, `pnpm lint`, typecheck.

- `maestro-epic.cjs ready <slug> [--cap <n>] [--json]` lists the epic's ready, unclaimed tasks with worker names (`<slug>-<NNN>`) and exact `claude -n` launch commands (run from the main checkout). It also lists running workers (live claim), pending ones (recorded with add-worker, not yet claimed) and free slots under the cap (default 5). 11 tests.
- maestro-manager spawn step: `command -v herdr`, then `HERDR_ENV=1`, then `status: running` in `herdr status server` (never its exit code). Then `herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd … --label <worker> --no-focus`, `herdr pane run`, and add-worker. On a worker report it offers only `[spawn]` tasks. Any failed check falls back to printing the commands and linking the guide.
- Guide: `plugins/maestro/skills/maestro-install/references/herdr.md`. maestro-install asks once; maestro-update prints one line.
- Plugin version 0.12.6 -> 0.12.7 (patch).

## Findings / decisions from the human review
- Verified against a live herdr 0.9.5 (read-only; no tab was created).
- Following herdr's own agent guidance, the manager drives herdr only when it runs inside herdr. The `workspace create` fallback was removed. A manager session outside herdr prints the commands even with the server up.
- Workers get tabs, not herdr's preferred sibling panes. The user chose this because 5 split panes would be too small for prompts and reviews.
- Linux sandbox needs `allowRead: ["~/.local/bin/herdr"]` (the binary only) and `allowWrite` for the socket. `allowUnixSockets` isn't needed when `allowAllUnixSockets` is true.

## Post-mortem notes
- herdr commands were first written from the docs. `herdr status server` exits 0 when down, so the exit-code check was wrong; the live install caught it.
- The guide missed the sandbox hiding the herdr binary.
- The first version ignored herdr's `HERDR_ENV` / `--workspace` guidance, which took a second review round.
- @reviewer failed the run once on Prettier formatting in a new test.
- Task 127's uncommitted edits appeared in the same main checkout mid-run, although the start-of-run worktree check found no other live session.

## Suggested ticket changes
- Version conflict with task 126 (both bump to 0.12.7): whichever lands second must re-bump to 0.12.8.
- Task 127 should run in its own worktree, or its files must be kept out of task 125's commit.
- Possible follow-up: test `launchCommandFor` with an apostrophe in a filename, and a stale-but-live claim against `ready`.
- For spawning to work, the manager session itself must be started inside a herdr pane.
