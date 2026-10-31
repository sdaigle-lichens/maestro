# End-to-end check of code-graph 0.3.11's incremental enrichment through maestro's scribe

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Check, with one real maestro run, that code-graph 0.3.11's incremental enrichment and subagent gap reporting work through maestro's scribe. This is their first live run. Change no code under apps/ or plugins/; a failure is reported to the manager and filed against code-graph, not patched here.

Precondition (met 2026-10-16, manager-checked): the code-graph plugin cache at ~/.claude/plugins/cache/code-graph/code-graph/ holds 0.3.11, and `deps install` ran from it (deps/ts-morph@28.0.0). Re-check that the cache still lists 0.3.11; if not, stop and report it.

Background: the 16 concepts are in scribe.config.json, and scribe-output/*.ast.json are committed. No concept is enriched yet; the .enriched.json files from task 110 were discarded. In a subagent, the scribe enriches up to 20 targets itself and reports a bigger list as "left to enrich". The first touch of a concept uses `enrich targets --core`: the vertices its SKILL.md names, plus in-concept hubs. Measured core sizes: agents-view 18 (fits inline), task-queue 27 (goes over the limit). 9 of 16 concepts have a core above 20, and no concept is thin. This run exercises both paths.

Steps:
1. Note `enrich targets <concept> --core --json` for agents-view and task-queue, and run `skills check`. Use the plugin's own `node ~/.claude/plugins/cache/code-graph/code-graph/0.3.11/scripts/code-graph.cjs`.
2. Inline path: drive a scribe-only Documentation run through /maestro that revises the agents-view concept skill (a small, true improvement such as a missing file-map entry). The update flow then runs extract, apply and enrichment inside the scribe subagent, and the scribe should enrich the 18 core vertices itself.
3. Left-to-enrich path: drive a second scribe-only run that revises the task-queue skill the same way. The scribe should enrich nothing for task-queue and report the 27 targets as left to enrich. Then, from this worker's main session, follow the scribe skill's main-session fan-out:
   - Haiku agents, about 10 targets per batch;
   - `enrich merge` for each partial;
   - spot-check the descriptions;
   - `apply`.
4. In one of those runs, have a working agent run a `code-graph search` that comes back poor and write the gap to `.claude/channels/scribe/<its bare name>.1.md`. Confirm SubagentStop stamps it with a run_id, and that the next scribe SubagentStart inlines it rather than only mentioning it.
5. Check the results:
   - Both .enriched.json files exist and cover their cores.
   - Edge reasons survive a second extract and apply.
   - No .ast.json changed apart from real code changes (compare `git diff --stat scribe-output`).
   - `gaps` counts both concepts as enriched over their cores.
   - Compare the `code-graph search blockedBy` ranking with before.
6. Watch for, and report, either of these, quoting the output: (a) an agent, the scribe or maestro code reading code-graph query output as --json; (b) plain-text search dropping edges an answer needed. code-graph-d1 turns either into tickets.

Do not commit the .enriched.json files or the stamped SKILL.md; report their sizes and diffs, and the manager asks the user. Never touch plan.md, merge-proposal.md or the 108 task file at the repo root.

## Acceptance criteria

- [ ] The plugin cache version and the deps install were confirmed before the run (or the task stopped and reported a missing precondition).
- [ ] Inline path: the scribe subagent enriched agents-view's core itself, with no fan-out. The report lists the targets and the count.
- [ ] Left-to-enrich path: the scribe reported task-queue's targets as left to enrich without enriching them. The main-session Haiku fan-out then enriched them through merge and apply. The report gives the batch count and any descriptions it re-asked for or dropped.
- [ ] Both .enriched.json files hold descriptions that match the code (spot-check at least 5 per concept), and a re-extract and apply keeps their edge reasons.
- [ ] No .ast.json changed beyond real code changes.
- [ ] A gap file written by a working agent was stamped at its SubagentStop and inlined at the next scribe SubagentStart (quote the inlined block).
- [ ] The report states the blockedBy search ranking before and after, any thin-core or left-to-enrich output, and any observation for code-graph-d1's (a)/(b), or says none was seen.
- [ ] Nothing is committed; the report lists every changed file with its size or diff stat.

## Blocked by

None — can start immediately

## Post-Mortem

- **Problem:** The first agents-view scribe run named avatar.ts exports in its file-map row, which grew the core from 18 to 22 (over the 20 limit), so the inline path was not exercised and the run had to be reverted and redone.
  **Fix:** none
- **Problem:** The scribe ended with `HANDOFF: done`, which the Documentation workflow has no route for; the run stopped for the user's choice.
  **Fix:** none
