# Manager spawns worker sessions in herdr

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Let maestro-manager start the epic's worker sessions itself instead of the user opening one Claude session per task. Add a maestro-epic.cjs command that lists an epic's tasks that are ready (no unfinished blocker) and not claimed by any session. Add a spawn step to the maestro-manager skill: at its start it checks whether herdr (a terminal runtime for coding agents that keeps sessions running and shows which ones are blocked or idle) is on PATH with `command -v herdr`; if so, for each ready, unclaimed task up to a concurrency cap (default 5) it opens a herdr tab labelled with the worker's session name, runs `claude -n <name> '/maestro <task.md>'` in it, and records the worker with add-worker. When a worker reports done, the manager offers to spawn the next ready task. Without herdr, or when its socket is unreachable, the manager prints the exact `claude -n ...` commands for the user to run and points to the herdr install guide. Write that guide as one reference file under the maestro-install skill (what herdr is and why Maestro uses it, the install commands, `herdr integration install claude`, and the sandbox entry its socket at ~/.config/herdr/herdr.sock needs), telling the user to run the install and integration commands themselves with `!` since they change things outside the project. maestro-install asks once whether to set up herdr and links the guide; maestro-update prints a single line when herdr is missing (no repeated question). This includes script code with tests for the new command, skill and reference-file changes, and a patch bump of the maestro plugin version. The manager never approves anything on a worker's behalf; each spawned worker's permission prompts and human reviews stay in its own pane.

## Acceptance criteria

- [ ] A maestro-epic.cjs command lists an epic's ready tasks that no session has claimed, and has tests covering ready vs blocked vs claimed tasks
- [ ] maestro-manager's spawn step checks for herdr with `command -v herdr` and, when present, spawns at most 5 workers by default, each in a herdr tab named after the worker running `claude -n <name> '/maestro <task.md>'`, and records each with add-worker
- [ ] When a worker reports done, the manager offers to spawn the next ready, unclaimed task without exceeding the cap
- [ ] Without herdr (or with its socket unreachable) the manager prints the exact launch commands and links the install guide instead of failing
- [ ] One herdr install guide reference file exists under the maestro-install skill and is linked from maestro-install, maestro-update and maestro-manager by relative path
- [ ] maestro-install asks once whether to set up herdr; maestro-update prints one line when herdr is missing and never asks repeatedly
- [ ] The guide and skills tell the user to run the herdr installer and `herdr integration install claude` themselves with `!`
- [ ] The maestro plugin's plugin.json version gets a patch bump

## Blocked by

None — can start immediately

## Post-Mortem

- **Problem:** @backend wrote the herdr commands from herdr.dev's docs without a live herdr, and assumed `herdr status server` exits non-zero when the server is down. It exits 0 (`status: not running`), so the manager would have spawned workers into a server that wasn't running. The live install during human review caught it.
  **Fix:** none
- **Problem:** The herdr guide missed that a Linux sandbox hiding the home directory also hides the herdr binary (`~/.local/bin/herdr`), so `command -v herdr` finds nothing in the sandbox. It also told users to add `allowUnixSockets` even when `allowAllUnixSockets` is already true.
  **Fix:** none
- **Problem:** The first spawn step ignored herdr's own agent guidance (`herdr --skill`: check `HERDR_ENV=1`, pass `--workspace "$HERDR_WORKSPACE_ID"`, don't drive herdr from outside it). That took a second human-review round to adopt.
  **Fix:** none
- **Problem:** @test's new worktree test wasn't Prettier-formatted, so @reviewer failed the run on `pnpm check` and it looped back to @test.
  **Fix:** none
- **Problem:** Another session's task 127 edits landed uncommitted in the same main checkout mid-run, although the worktree check at the start found no other live session. Task 125's commit must stage its files by name.
  **Fix:** none
