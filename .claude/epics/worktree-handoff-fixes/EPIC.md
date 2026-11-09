# Epic: worktree-handoff-fixes

## Goal

Fix the Maestro plugin gaps found by the acces-portail-email walking-skeleton post-mortems: worktree channel paths, clean-tree check before merge, git-excluded dirs in worktrees (163); testing-step re-verify (164); data source of displayed numbers and a complete post-mortem digest (165). Plus the seed's manager-review label aligned with the app (166), and no false hand-off issues on an agent's interim stops (160).

## Scope

In: items 1, 2, 3, 6, 7 and 8 of the forwarded fixes (epic-01-manager, from the walking-skeleton
003/004 post-mortems, Maestro 0.13.27), 166 (from the workflow drift report on this repo), and 160
(from the code-graph task 075 post-mortem; it also owns item 4).

Out:
- Item 5 (ask for dependency installs at claim time): user decision, it is a sandbox matter.
- 164's background-work stop half: item 4 (a stop with live background work taken as the final
  report) belongs to task 160, now in this epic. 164 was narrowed and retitled to the re-verify fix only.
- The missing payload on a resumed run (task 156 already covers it).
- Installed dependencies in worktrees (task 135); 163 covers only git-excluded directories.
- Migrating existing projects' manager-review labels (166 changes the seed only; the drift report
  tells projects).

## Merge plan

| Order | Task | Base | Version bump | Shared surfaces with siblings |
| ----- | ---- | ---- | ------------ | ----------------------------- |
| 1 | 163 worktree channels, clean-tree check, excluded dirs | `main` (at or after `41b8ce5`, plugin 0.13.32) | Worker bumps patch on its branch | `plugin.json`; `scripts/lib/*.cjs` (generated) and `.claude/scripts` mirrors; the orchestrator template (rendered STEPS/HANDOFFS); `maestro-inject-agent-context.js` (also changed by task 159, already on `main`) |
| 2 | 164 testing re-verify | same | Worker bumps patch; on rebase, the next patch above the last merge | `plugin.json`; generated libs and mirrors (handoff defaults) |
| 3 | 160 interim-stop hand-off flags | same | same | `plugin.json`; generated `maestro-session.cjs` and its mirror; `maestro-subagent-log.js`; the hand-off concept notes |
| 4 | 165 to-maestro-tasks data source, full post-mortem digest | same | same | `plugin.json`; post-mortem script mirrors; must merge after 160, whose interim-stop signal its digest respects |
| 5 | 166 seed manager-review label | same | same | `plugin.json`; generated `maestro-seed.cjs` and its mirror |
| 5b | 168 maestro-architecture re-review and stamp | `main` | No bump (docs only) | `.claude/skills/maestro-architecture/` (also 167's and standalone 169's concept notes); before 167 |
| 6 | 167 Backend workflow: defect class, grammar, test→refactor edge | `main` after 165 and 166 merge (`blockedBy`) | No bump (no `plugins/` change) | this repo's `.claude/maestro.json`, `.claude/handoffs/{backend/test,test/backend}.md`, `.claude/agents/test.md`, rendered orchestrator; changes the shared setup, so other epics' managers get a note before merge |

All five run in parallel (no `blockedBy`). A later one rebases onto `main` after the earlier one
merges, takes the next patch version, and rebuilds generated files (`pnpm refresh:runtime`, parity
test) instead of hand-merging bundle text, then re-runs the full suite on the rebased commit. The
only hard order is 160 before 165.

After the epic: task 157 (no epic, blocked by all five) runs standalone once they are merged.

## Decisions

- Ready to start: PR #25 (161+162) and PR #24 (158–160) are on `main` at `41b8ce5`.
  No worker was spawned on the queueing machine (user); the epic was handed over and
  `maestro-mgr-82f98516` took it as manager on 2026-11-07.
- Three tickets, not one (user, at queueing): the urgent 163 shouldn't wait on the rest.
- 164's re-verify requirement stays project-agnostic (user): "the project's own format, lint and
  type checks", no tool or command names.
- 164 narrowed (manager, after PR #24 landed task 160): its background-work stop half duplicated 160.
- 163's clean-tree check: clean-checkout verification vs a narrower ignored-file check is left to
  that task's design step; a manager review only checks it stays project-agnostic.
- 160 joined the epic (user, 2026-11-07); 157 runs standalone after it, and task 149 with its
  freebuff-reviewer epic was cancelled.
- 160's interim signal (user, 2026-11-08, after manager escalation m004): first accepted as is in
  160's human review, then changed by the user to option 2: a final stop with no HANDOFF line
  (plain-text end, or never resumed) must still be flagged; only true interim stops go unflagged.
  The log marks an interim stop `interim: true`, documented in handoff-contract.md,
  session-state.md and the log-view hook-writers.md; 165's digest reads that field.
- 163 + 164 land together (user, 2026-11-09): 163 was merged into the checked-out
  `task-164-testing-step-reverify` branch instead of `main` (merge commit faf8bb6), because the main
  checkout was left on 164's branch. The user kept it: rebuild the generated files, parity and full
  suite on that branch, then bring `main` up to it as one step under 0.13.33. 160, 165 and 166 rebase
  onto that `main` and take the next patch.
- 167 joined the epic (user, 2026-11-09), from the team meeting on 160, after a manager review:
  kept defectClass, the written grammar and a mechanical test→refactor edge; dropped the narrower
  FAIL rule with documentedLimits and the one-probe-file rule; this repo's setup only, plugin seeds a
  separate follow-up.
- Epic complete (2026-11-09): all seven tasks merged; final `main` at db2ee3c (167), `pnpm verify`
  green on it (3111 passed, 5 skipped). 167's defect-class comparison uses an append-only ledger
  (`.claude/channels/<scope>/defect-classes.md`), because retired payloads are overwritten each round;
  it is enforced by @test's prose only. Left for later: standalone 169 and 157; reports from
  different tasks can share an id (166 and 167 both got r009), a candidate ticket.
- 166 (user): the seed adopts the app's "manager requested direction change" label, not the other
  way round. This repo's `maestro.json` already uses it.
