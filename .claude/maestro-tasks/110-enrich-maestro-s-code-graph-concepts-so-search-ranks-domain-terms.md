# Enrich maestro's code-graph concepts so search ranks domain terms

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Task 109 gave this repo a code-graph graph (16 concepts in scribe.config.json, about 1480 vertices), but the graph is not enriched: every search score and bm25 is 0. An identifier query (`code-graph search MaestroTasksPage`) works, but a domain term like `blockedBy` matches task-queue only through its SKILL.md and then lists all 103 of that concept's vertices unranked, burying `parseBlockedBy`. Subagents can't use the graph for domain questions until it is enriched.

- Enrich every configured concept using code-graph's own enrichment flow (its `scribe` skill: write each concept's `.enriched.json`, then `code-graph apply`). Read the installed plugin's skill for the current steps; don't use the `/scribe-enrich` command, which 0.3.1 removed.
- Describe vertices in this repo's own domain terms (task queue, blockedBy cascade, claims, epics, handoffs, design check, plugin libs parity, etc.), drawn from each concept's SKILL.md and code.
- Keep it project configuration only: no maestro source, app or plugin file gains a dependency on code-graph.
- Leave `scribe-output/*.ast.json` uncommitted. The user decided to hold them back until code-graph makes extract output stable. Report the total size of the `.enriched.json` files and whether re-running enrichment on an unchanged concept rewrites them, so the user can decide whether to commit those too.

## Acceptance criteria

- [ ] Every configured concept has an `.enriched.json` file, and `code-graph apply` succeeds for each one
- [ ] `code-graph search blockedBy --json` returns nonzero scores, and `parseBlockedBy` (or another blockedBy-handling function in apps/maestro/src/core/tasks.ts) is among the top 5 hits
- [ ] Two other domain queries, chosen by the worker and listed in the report, each rank a relevant vertex from the expected concept in their top 5
- [ ] `code-graph skills check` still reports ok
- [ ] No maestro source or plugin file gains a dependency on code-graph; `pnpm lint` passes

## Blocked by

- `109-configure-maestro-s-code-graph-concepts-so-subagents-can-explore-it-through-the-graph.md`
