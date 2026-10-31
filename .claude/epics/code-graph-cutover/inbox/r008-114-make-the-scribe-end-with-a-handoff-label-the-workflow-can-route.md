# Report r008: 114-make-the-scribe-end-with-a-handoff-label-the-workflow-can-route.md

- Task: 114-make-the-scribe-end-with-a-handoff-label-the-workflow-can-route.md
- Written: 2026-10-20T02:05:18.146Z
- From session: Scribe handoff label workflow routing

## Outcome

Task 114 is done, run under the default workflow: backend → frontend (no-op) → human review (approved) → test → reviewer → scribe. Every acceptance criterion is met. Nothing is committed.

- maestro's scribe agent, both the plugin template and its `.claude/agents` mirror, has a new "Ending your run" section:
  - The final lines are `SKILL_GAPS_HANDLED: <file>, …` (only when gap reports were acted on), then `HANDOFF:` last.
  - Finished docs end with `HANDOFF: success`, and skipped steps go in the report body. `done` and `complete` are named as non-labels.
  - A scribe that could not finish uses a condition label from its injected routes. Otherwise it ends with `HANDOFF: partial`, which the unrouted stop catches on purpose. Task 108's behaviour is kept.
- The scribe report default in `report-defaults.ts` appends `SCRIBE_ENDING_NOTE`, so a resumed scribe gets the rule too. The old body goes back into `PRIOR_SEEDS.scribe`, so stored seeded rows upgrade once.
- `checkRoute` is unchanged.
- The maestro plugin is bumped from 0.12.0 to 0.12.1. The lib is rebuilt and mirrored, and the parity test is green.
- Tests:
  - A finished scribe's message passes `checkHandoff` and `checkRoute` for the Documentation workflow, with `SKILL_GAPS_HANDLED` present.
  - `done` and `complete` are flagged unrouted, and a quoted `success` in the body does not rescue them.
  - The report default upgrades, the committed bundle matches the TS source, and the `scribe.md` mirror section is byte-identical.
- The unit project's 2114 tests, lint and typecheck all pass.

## Findings

- **Root cause of r006:** the project's own `.claude/reports/scribe.md` told the scribe to end with `HANDOFF: <next agent or done>`. That file is fixed.
- **Other templates:** only the scribe lacked the rule.
  - `refactor.md` and `reviewer.md` state it inline.
  - backend, frontend, mobile, infra and test get it through `VERDICT_HANDOFF_NOTE` in their report defaults. The scribe never did, because it has no verdict.
- **Live confirmation:** this run's own @scribe ended with `HANDOFF: success`, and nothing was flagged.
- **`pnpm verify` under the sandbox:** its test stage fails because turbo strips `TMPDIR`. The stages pass when run directly, or through turbo with `--env-mode=loose`. The storybook browser project fails because Playwright's chromium is not installed.

## Post-mortem notes

The run was clean. One small orchestrator slip: I recorded `mark-task-done` as a `plan` step, so `done` refused until I marked that step manually.

## Suggested ticket changes

- **Optional follow-up:** the injected `SubagentStart` gap block in `maestro-inject-agent-context.js` asks for `SKILL_GAPS_HANDLED` without stating its order relative to `HANDOFF:`. This is harmless today but weaker than `scribe.md`.
- **Optional:** `.claude/agent-forks.json` still records the scribe fork at template 0.11.23. It was behind before this change.
- **Optional:** the orchestrator template could say not to put `mark-task-done` in a `plan` list, or `plan` could accept it as a terminal label.
