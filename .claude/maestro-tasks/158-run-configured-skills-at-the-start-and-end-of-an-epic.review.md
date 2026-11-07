# Review: 158 run configured skills at the start and end of an epic

Round 1. This task is in no epic, so the `manager review` stop runs as a human review, with this direction brief as its review file.

## Goal

Let a project configure skills that a maestro-manager runs once at the start of an epic and once at the end, driven by one new command, `boundary <slug> start|end [--force]`. Nothing the skills produce becomes a task without the user saying so.

## Deviations

- **Extra `end` calls.** The ticket says the manager calls `boundary end` after each acknowledgement. The manager skill also calls it on opening or resuming an epic and after a merge. The last ack normally comes before the merge, so without these the end boundary would stop at "not merged" and never fire.
- **The `end` call sits at the end of the loop**, after "offer the next task", not right after the ack, because acting on a report can add tickets.
- **Running-window check not done.** See Questions.

## Decisions

Taken as defaults during design; each is yours to overrule.

- **`--force` only re-runs a boundary already claimed.** It can't start one that was never due. A forced start keeps the original base commit, so the end scope can't shrink.
- **An empty start list with a configured end list** still records the base commit and prints nothing to run, so the end scope works.
- **End scope follows the ticket strictly.** It is not filtered, so tracked bookkeeping such as `.claude/maestro-tasks/*` appears in it.
- **Reviews don't block end.** Only unacknowledged reports and notes do, as the ticket says.
- **Each run has its own folder**, `.claude/epics/<slug>/boundary/<phase>-<n>/`, holding `scope.txt` and the saved outputs, so a re-run never overwrites earlier output.
- **A skill is skipped on a 0-path scope**, and the manager says so.
- **An unreachable base or a non-git project** falls back to the Touched surfaces rule.

## Touches

- New: `apps/maestro/src/core/epic-boundary.ts`, `apps/maestro/test/core/epic-boundary-cli.test.ts`.
- Core: `epics.ts` (carries `boundaries`, exports `updateState`), `tasks.ts` (exports `sectionOf`), `skill-lists.ts`, `types.ts`, `seed.ts`, `skill-availability.ts`, `team-meeting.ts`, `plugin-entries/maestro-epic.ts`.
- App: `src/main/ipc.ts`, `src/shared/ipc.ts`, `routes/maestro.tsx` (`SkillListsCard`), `dev-stub/maestro-install.ts`.
- Plugin: `scripts/maestro-epic.cjs`, `skills/maestro-manager/SKILL.md`, `plugin.json` (0.13.25 to 0.13.26), rebuilt `scripts/lib/*.cjs`.
- Mirrors: `.claude/scripts/maestro-epic.cjs`, `.claude/scripts/lib/maestro-epic.cjs`, `.claude/scripts/lib/maestro-skill-lists.cjs`.
- Tests updated: `install-seed-skill-lists.test.ts`, `skill-lists.test.ts`, `isolation.test.ts`.

## Sibling impact

- No other tasks are affected: the task is in no epic.
- With no lists configured, an epic behaves as today and nothing is written.
- The ticket's first intended user, the code-graph scout, ships under its own ticket. Nothing here names it.

## Questions

1. **Running window.** "Verified in a running window" is not met: Electron aborts in the Bash sandbox. A throwaway test ran the route's real list helpers through the real `resolveSkillLists` and `saveConfig` onto a real `maestro.json`, but not through IPC, the render or the click handlers. To close it, in a plain terminal run `pnpm --filter maestro dev`, then add, reorder and remove in both new rows on `/maestro` in a throwaway project, check `.claude/maestro.json`, and reopen the project.
2. **End scope bookkeeping.** Keep tracked queue files in the end scope, as the ticket says, or filter them out?
3. **`maestro-manager` is pickable** in the new lists, like every skill except bare `maestro`. Left as is.

## Verified

- Commit: none. The work is uncommitted on top of `3ee11ce`, so this result is for the working tree.
- `pnpm --filter maestro test`: 141 files, 2752 of 2752 tests passed, including `test/core/parity.test.ts`, after `pnpm refresh:runtime`.
- Not yet run: root `pnpm verify`.
- Unrelated to this task and not to be committed with it without checking: `scribe-output/installing-maestro.ast.json` (modified) and `scribe-output/.refresh-skills.lock` (new).
