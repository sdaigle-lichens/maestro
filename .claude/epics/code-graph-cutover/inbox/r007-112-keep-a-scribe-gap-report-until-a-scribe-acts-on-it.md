# Report r007: 112-keep-a-scribe-gap-report-until-a-scribe-acts-on-it.md

- Task: 112-keep-a-scribe-gap-report-until-a-scribe-acts-on-it.md
- Written: 2026-10-19T22:35:28.652Z

## Outcome

Task 112 is done. A scribe-lane skill-gap report now survives until a scribe acts on it. All acceptance criteria are met; `pnpm verify` was run as separate steps (see the caveat below).

How it works:
- **Gap report.** A scribe-lane file whose fenced json block has a non-empty `skill_gaps` or `concept_skill_gaps` array. An empty array is not a gap report, so seeded reviewer→scribe and refactor→scribe payloads keep deliver-once.
- **At stamp.** The sender's SubagentStop renames the file to `<sender>.<n>.md`, so a later gap from the same sender can't overwrite it.
- **At SubagentStart.** A cold scribe start inlines every stamped gap report, whatever run or session stamped it, and never retires it. Resume delivery doesn't retire it either.
- **Retirement.** Only the scribe's final line `SKILL_GAPS_HANDLED: <file>, …` retires a gap report. SubagentStop calls `acknowledgeGaps` and logs `channel_delivery` with `via:"ack"`. Otherwise `sweep` ages the file out at `CHANNEL_AGE_CAP_MS`.
- **What counts as handled.** Enrich-only handling, a "left to enrich" remainder and a concept with no graph all count. Maestro never parses `missing` and has no dependency on code-graph.
- **`payloadWrittenSince`** also accepts a sender's renamed gap reports.
- **Renderer.** /session-log labels acks "Acknowledged gap report" and leaves them out of the delivery counts.
- **Publishing.** Libs rebuilt, mirrors copied, parity test green, plugin 0.11.27 → 0.11.28.
- **Tests.** 2032 maestro tests pass. Lint and typecheck are clean.
- **Docs.** Updated in maestro-architecture (channels, agent-resume, hooks, team-meeting, SKILL.md), log-view and plugin-libs-parity.

## Findings

- The 111 sequence is reproduced in `test/core/scribe-gap-retention.test.ts`, which runs the real installed hooks across two sessions.
- **`pnpm verify` caveat:** turbo's strict env mode drops TMPDIR, so the `turbo test` step fails inside the sandbox. Every step passes when run separately, and with `--env-mode=loose`.

## Post-mortem notes

- The first pass counted empty `skill_gaps` arrays as gap reports. That broke deliver-once for the seeded reviewer and refactor payloads. The reviewer caught it, and it took an @test → @backend loop-back.
- The rename at stamp broke `payloadWrittenSince`, which only checked `<sender>.1.md`. Fixed in the same loop-back.
- @scribe ended with `HANDOFF: done`, which has no route in tdd. The user treated it as success. This is the same issue as task 114.
- `extract` couldn't run because ts-morph is missing, so maestro-architecture, log-view and plugin-libs-parity are not re-stamped in the graph.

## Suggested ticket changes

- **New task:** add the `SKILL_GAPS_HANDLED: <file>, …` instruction to `plugins/maestro/agents/scribe.md` and the scribe report default in `report-defaults.ts`, with a plugin patch bump. Today it lives only in the injected delivery block, so a resumed scribe, which gets no `additionalContext`, is never told how to acknowledge.
- **Environment:** run `code-graph deps install`, then `extract` + `apply` for maestro-architecture, log-view and plugin-libs-parity.
- **Task 114** should also cover `HANDOFF: done` from the scribe.
