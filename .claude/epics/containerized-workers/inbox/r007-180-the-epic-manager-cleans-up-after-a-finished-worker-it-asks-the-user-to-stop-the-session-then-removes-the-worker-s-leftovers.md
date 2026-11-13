# Report r007: 180-the-epic-manager-cleans-up-after-a-finished-worker-it-asks-the-user-to-stop-the-session-then-removes-the-worker-s-leftovers.md

- Task: 180-the-epic-manager-cleans-up-after-a-finished-worker-it-asks-the-user-to-stop-the-session-then-removes-the-worker-s-leftovers.md
- Written: 2026-11-13T20:09:56.226Z
- From session: containerized-workers-180

## Outcome

Task 180 is done on branch `task-180`, commit f677e03 (on top of 7ba38a4). Nothing is merged or pushed.

## Verified

`pnpm verify` is green on f677e03: lint, check, typecheck, and the full suite of 3468 tests in 178 files.

## What changed

- Worker launcher: `prune [--dry-run]` removes this project's superseded worker images and stopped worker containers.
  - It removes only images the build label proves are this project's.
  - It never removes an image a running container uses, another project's image or a non-worker image.
  - An unlabelled older image is listed as `skipped` with its exact `docker rmi` and never removed (m005 direction).
  - A refused removal or a failed docker query (`image ls`, `ps`, `inspect`) is named and exits 1. No Docker, or an unreachable daemon, exits 0 with a reason.
- Every worker the launcher starts runs with `--init`. The image layout is now 7, so existing images rebuild, and the baked marketplace copy leaves out `.claude/epics`.
- Epic CLI: `finish-worker <slug> <name>` records a worker as finished and drops its pane. `show` lists active workers only, with a separate `finished:` line, and `readyTasks` ignores a finished worker's task.
- maestro-manager skill: ask the user once to stop the session (naming its herdr tab, never closing or typing into it), then `finish-worker`, then `prune`, and prune again at the epic's end. It says what to do on exit 1.
- Plugin 0.15.13, libs rebuilt, mirrors refreshed. Dev skills task-queue and maestro-architecture updated.

## Findings and post-mortem

- @test needed four loop-backs, all about prune reporting misleadingly or silently: dropped failed removals, "nothing needed removing" beside failures, skipped images or an unreachable daemon, and a failed `ps`/`inspect` read as an empty list. Each round needed the user to run `pnpm refresh:runtime`.
- The root `check` found a Prettier problem in a hand-written plugin script that package-level checks do not cover. It was fixed in f677e03.
- Known limitation: a stopped worker container on an untagged `<none>` image is never listed. It fails safe and workers run with `--rm`.
- Tests assert prune's exit codes only against a docker stub. Real daemon behaviour, such as docker refusing to remove an in-use image, was not run live.

## Suggested ticket changes

- Tickets that make a command delete things should state the rule "a failed query or unprovable ownership means remove nothing and say so", up front.
- Run the root `pnpm check` before the test step in plugin-script tickets, or have the builder run it.
