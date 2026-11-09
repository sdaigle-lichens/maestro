# Task 157 — direction review (manager review run as a human review: task is in no epic)

## Goal

Large to-maestro-tasks plans get an independent cold-read review by a read-only Opus plan-reviewer, with the user as third reviewer, plus an on-demand self-contained HTML plan view for a plan or a single task.

## Changed

- `plugins/maestro/agents/plan-reviewer.md` (new): tools `Read, Grep, Glob` only, `model: opus`, plan critic; numbered findings `F<n>` tagged assumption / coverage / dependency / boundary / parallel-safety, ends `Findings: N`; told it is not a workflow step (no `HANDOFF:`, no channel file).
- `plugins/maestro/skills/to-maestro-tasks/references/plan-review.md` (new): triggers, Gate 1 / Gate 2, equal footing, blind sketch, findings + planner answers, verbatim relay, questions only on disputes, reopen by ID, one automatic response, user-controlled rounds, Continue / Fresh; fallback when follow-up messages are unavailable (fresh reviewer per follow-up given the record verbatim; sketch still from a draft-less message).
- `plugins/maestro/skills/to-maestro-tasks/references/plan-view.md` (new): inline-CSS HTML skeleton, no script, no external assets, no renderer; review mode and single-task mode fill-in rules.
- `plugins/maestro/skills/to-maestro-tasks/SKILL.md`: description triggers on review / explain / show / visualize a plan, epic list or task; new Plan review and Plan view paragraphs; Step 4 waits for the last review when several epics are planned.
- `plugins/maestro/skills/to-maestro-tasks/references/epics.md`: Gate 1 before epic-list approval, epic creation still right after it; held writes (draft all `now` epics → Gate 2 → write in dependency order); title references swapped for real filenames before each write; `maestro-write-tasks.cjs` unchanged; Gate 2 opt-in for deferred epics and single epics with more than 3 tasks.
- `plugins/maestro/.claude-plugin/plugin.json`: 0.13.36 → 0.14.0 (minor: new agent).
- `apps/maestro/test/core/agent-fork.test.ts`: model-frontmatter check accepts `model: opus` for plan-reviewer.
- `.claude/maestro.json`: `runtimeVersion` 0.14.0 (written by the partial refresh).

## Did

- @backend: implemented all of the above, ran the two checks below, and ran `pnpm verify`.

## Deviations

- None from the ticket. "Large single epic" is defined as more than 3 tasks (the ticket gave no threshold).

## Decisions

- Hook check: no hook change needed. SubagentStart injects nothing for an agent on no workflow (no skills, routing, payload or report format); SubagentStop logs it but never judges it; the PreToolUse review gate only applies to SendMessage to an epic manager; fork sync ignores never-forked plugin agents.
- Session cleanup: a final SessionEnd deletes `.claude/maestro_sessions/<session>/`, so plan views go to `.claude/maestro-tasks/views/`. No hook removes it, the tracker reads only top-level `*.md`, and the user deletes it when done.

## Touches

to-maestro-tasks skill + references, plugin agents dir, plugin.json, agent-fork test. No hook sources, no generated libs.

## Sibling impact

- Existing (not new): the post-mortem digest lists helper agents outside a workflow (Explore, now plan-reviewer) under Problems as "missing HANDOFF". Left as is.

## Questions

- Not verified live: whether Claude Code applies `tools`/`model` frontmatter to a plugin agent.
- `pnpm refresh:runtime` stopped at its last step (sandbox can't write `.claude/skills/maestro/SKILL.md`); nothing that step renders changed, and parity passes. Run `! pnpm refresh:runtime` to be sure.

## Verified

Uncommitted working tree on HEAD 387b1f7. @backend reports `pnpm verify` green (lint, check, typecheck, 3116 tests) and the parity test passing. @test re-verifies next.
