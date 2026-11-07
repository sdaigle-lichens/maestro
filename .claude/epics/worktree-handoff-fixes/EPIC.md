# Epic: worktree-handoff-fixes

## Goal

Fix the Maestro plugin gaps found by the acces-portail-email walking-skeleton post-mortems: worktree channel paths, clean-tree check before merge, git-excluded dirs in worktrees (163); testing-step re-verify (164); data source of displayed numbers and a complete post-mortem digest (165). Plus the seed's manager-review label aligned with the app (166).

## Scope

In: items 1, 2, 3, 6, 7 and 8 of the forwarded fixes (epic-01-manager, from the walking-skeleton
003/004 post-mortems, Maestro 0.13.27), and 166 (from the workflow drift report on this repo).

Out:
- Item 5 (ask for dependency installs at claim time): user decision, it is a sandbox matter.
- Item 4 (a stop with live background work taken as the final report): owned by task 160 (PR #24
  queued it, not in this epic). 164 was narrowed and retitled to the re-verify fix only.
- The missing payload on a resumed run (task 156 already covers it).
- Installed dependencies in worktrees (task 135); 163 covers only git-excluded directories.
- Migrating existing projects' manager-review labels (166 changes the seed only; the drift report
  tells projects).

## Merge plan

| Order | Task | Base | Version bump | Shared surfaces with siblings |
| ----- | ---- | ---- | ------------ | ----------------------------- |
| 1 | 163 worktree channels, clean-tree check, excluded dirs | `main` (at or after `41b8ce5`, plugin 0.13.32) | Worker bumps patch on its branch | `plugin.json`; `scripts/lib/*.cjs` (generated) and `.claude/scripts` mirrors; the orchestrator template (rendered STEPS/HANDOFFS); `maestro-inject-agent-context.js` (also changed by task 159, already on `main`) |
| 2 | 164 testing re-verify | same | Worker bumps patch; on rebase, the next patch above the last merge | `plugin.json`; generated libs and mirrors (handoff defaults) |
| 3 | 165 to-maestro-tasks data source, full post-mortem digest | same | same | `plugin.json`; post-mortem script mirrors |
| 4 | 166 seed manager-review label | same | same | `plugin.json`; generated `maestro-seed.cjs` and its mirror |

All four run in parallel (no `blockedBy`). A later one rebases onto `main` after the earlier one
merges, takes the next patch version, and rebuilds generated files (`pnpm refresh:runtime`, parity
test) instead of hand-merging bundle text, then re-runs the full suite on the rebased commit.

Outside the epic: task 160 (ready, no epic) touches the SubagentStop hook and `plugin.json`. Not
ordered against this epic; whichever merges later rebases and takes the next patch.

## Decisions

- Ready to start: PR #25 (161+162) and PR #24 (158–160) are on `main` at `41b8ce5`.
  No worker was spawned here (user): the epic is handed over to a manager on another machine, which
  runs `maestro-epic.cjs set-manager worktree-handoff-fixes` first (this file still records
  `maestro-mgr-505f2630`), then `ready` and Spawning workers as usual.
- Three tickets, not one (user, at queueing): the urgent 163 shouldn't wait on the rest.
- 164's re-verify requirement stays project-agnostic (user): "the project's own format, lint and
  type checks", no tool or command names.
- 164 narrowed (manager, after PR #24 landed task 160): its background-work stop half duplicated 160.
- 163's clean-tree check: clean-checkout verification vs a narrower ignored-file check is left to
  that task's design step; a manager review only checks it stays project-agnostic.
- 166 (user): the seed adopts the app's "manager requested direction change" label, not the other
  way round. This repo's `maestro.json` already uses it.
