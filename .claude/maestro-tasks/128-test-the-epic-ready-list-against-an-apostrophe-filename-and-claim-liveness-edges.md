# Test the epic ready list against an apostrophe filename and claim liveness edges

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Add tests for the epic `ready` command (maestro-epic.cjs ready, backed by the epic module's readyTasks and launchCommandFor) covering two gaps found in task 125. First, a task filename containing an apostrophe: the printed `claude -n ...` launch command must stay a single valid POSIX-shell argument per part, proven by actually running the command text through `sh -c` with a stub `claude` (or an equivalent argv echo) and checking the received arguments, not just by string comparison. Second, claim liveness at the edges: a claim whose claimed_at is old but whose session log was touched within the idle cap must list the task as running (never ready); a claim whose session log is idle past the cap must not list it as running, and the task must come back as ready, or as pending when a worker is recorded for it. If a test exposes a real bug, fix it in the TypeScript source, rebuild the plugin libs, refresh the tracked .claude/scripts mirrors and run the parity test. A source change under the plugin means a patch bump of the maestro plugin version, at the next free patch at commit time; tests alone need no bump.

## Acceptance criteria

- [ ] A test runs the launch command for a task filename containing an apostrophe through a real shell and asserts the exact arguments received
- [ ] A test shows a claim with an old claimed_at but a recently touched session log lists the task as running, not ready
- [ ] A test shows a claim whose session log is idle past the cap lists the task as ready, or as pending when a worker is recorded for it
- [ ] Any bug these tests expose is fixed in the TypeScript source, the plugin libs are rebuilt, the mirrors refreshed and the parity test passes
- [ ] The maestro plugin version gets a patch bump only if a file under plugins/ changed

## Blocked by

None — can start immediately
