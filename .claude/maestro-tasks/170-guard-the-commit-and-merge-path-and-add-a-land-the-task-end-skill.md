# Guard the commit and merge path and add a land-the-task end skill

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

In the worktree-handoff-fixes epic, most failures were in landing a finished task, not in building it. Five of seven done reports named no commit. The main checkout was left on a task branch twice, so one task merged into another task's branch. No worker reported a full suite on the merged result. One switch back to main failed on sandbox-read-only paths and left another task's files uncommitted on main. Workers had prose instructions for all of this and still skipped steps, so the fix is guards in the scripts first and a skill second.

1. **Guards in the existing scripts.** The epic report command refuses a report that says the task is done unless it names a commit that exists and is on the task's branch. The task-status `merge` command refuses unless the target checkout is on the default branch with a clean tree (ignoring Maestro's own tracker and epic state files). After merging, it runs the project's full verification, prints the result, and says plainly whether it passed. A worker that committed in the main checkout is told to switch back to the default branch, and when the switch fails it prints the exact command for the user to run with `!` rather than leaving a half-done checkout. The verification command must stay project-agnostic: read it from the project's configuration or detect it, never hardcode this repo's `pnpm verify`. Choosing where that command is configured is part of this task's design.
2. **One land-the-task skill**, published in the maestro plugin and run through the existing end skills at the end of a successful run (`end_skills.maestro`, which the orchestrator runs once the success path completes). It walks the landing sequence in one place: commit on a task branch, rebase onto the default branch, take the next plugin version where the project has that rule, rebuild generated files, verify, report with the commit, and merge only after the user's approval. It calls the guarded scripts, so it cannot skip what they enforce. It says what to do when the sandbox blocks a git step (hand the user the `!` command). It is one skill, not separate commit and merge skills. Add it to this repo's `end_skills.maestro`. Whether the plugin's seed should add it for new projects is part of the design; record the choice.

Assumed, unverified: that `end_skills.maestro` runs in a worker session the same way whether it works in the main checkout or a worktree. Confirm this before designing around it.

This needs code in the plugin-entry TypeScript sources and the hand-written plugin scripts, tests, a new skill under the plugin, rebuilt generated libs and their `.claude/scripts` mirrors, the plugin version bump (minor: the published surface gains a skill), and updates to the concept notes describing the merge and report flow.

## Acceptance criteria

- [ ] The epic report command rejects a done report without an existing commit on the task's branch, with a message naming what is missing; a test covers it
- [ ] The task-status merge command refuses when the target checkout is not on the default branch or has a dirty tree (Maestro tracker and epic state files excepted); tests cover both
- [ ] After a merge, the merge command runs the project's configured or detected full verification and reports pass or fail; nothing hardcodes this repo's commands
- [ ] When switching a checkout back to the default branch fails, the output gives the exact command for the user to run with `!`
- [ ] A land-the-task skill ships in the maestro plugin, calls the guarded scripts, and covers commit, rebase, version, regenerate, verify, report and approval-gated merge, including what to do on a sandbox-blocked git step
- [ ] This repo's `.claude/maestro.json` lists the skill in `end_skills.maestro`; the seed decision is recorded in the task's report
- [ ] Whether end skills run identically in a worktree is confirmed and stated in the report
- [ ] plugin.json gets a minor bump; `pnpm refresh:runtime` and the parity test pass; `pnpm verify` is green on the reported commit
- [ ] The concept notes for the merge and report flow (maestro-architecture, task-queue) reflect the guards and the skill

## Touched surfaces

- plugins/maestro/scripts/maestro-epic.cjs and its plugin-entry source (report command)
- maestro-task-status.cjs merge (plugin-entry source, generated lib, .claude/scripts mirror)
- new skill under plugins/maestro/skills/
- plugins/maestro/.claude-plugin/plugin.json (minor bump)
- .claude/maestro.json end_skills.maestro; possibly the seed (apps/maestro/src/core/seed.ts)
- generated plugins/maestro/scripts/lib/*.cjs and .claude/scripts mirrors
- .claude/skills/maestro-architecture and the task-queue concept notes
- parallel OK with the report-id/refresh-leak task: merge order this task first, the other rebases and takes the next patch

## Blocked by

None — can start immediately

## Decisions (during the run)

- Report guard with no task-NNN branch: accept a default-branch commit only if it is the `Merge task-NNN` merge commit or its message names task-NNN or the task file (covers a hand-merged squash or fast-forward); refuse anything else, naming what is missing. (User decision, round 1 fix.)

## Post-Mortem

- **Problem:** @backend's first round left three report-guard defects it had itself listed as known gaps (empty task branch accepted the base commit, uppercase SHAs refused, no-branch case checked ancestry only); @test's probes caught them and forced a loop-back, one of which needed a user design decision mid-run.
  **Fix:** none
- **Problem:** @test twice ended its run without writing the channel payload its route expects (FAIL payload for @backend, success payload for @reviewer) and had to be resumed to write it.
  **Fix:** none
