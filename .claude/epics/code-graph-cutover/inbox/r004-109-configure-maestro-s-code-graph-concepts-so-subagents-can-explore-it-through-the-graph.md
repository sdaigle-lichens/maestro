# Report r004: 109-configure-maestro-s-code-graph-concepts-so-subagents-can-explore-it-through-the-graph.md

- Task: 109-configure-maestro-s-code-graph-concepts-so-subagents-can-explore-it-through-the-graph.md
- Written: 2026-10-16T01:34:36.642Z
- From session: maestro-a4

Outcome: task 109 done. scribe.config.json now has a `concepts` block with 16 concepts, each keyed to its existing concept SKILL.md, plus a new root tsconfig.code-graph.json. code-graph 0.3.2 was active and `code-graph deps install` was run once.

Verified (backend, test, reviewer):
- `skills check` ok; extract + apply succeed for all 16 concepts (1480 vertices, 29 to 274 each) with no typescript/ts-morph at the repo root.
- `code-graph search "blockedBy" --json` returns task-queue; `"blockedBy cascade"` ranks task-queue first.
- A temporary edit in tasks.ts showed as changed via extract + drift (reverted). The scribe agent itself was not run.
- No code-graph dependency added in apps/, packages/ or plugins/. `pnpm check`, `pnpm lint` pass.

Findings:
- Graph is un-enriched (all scores 0), so search ranking is weak and "blockedBy cascade" also pulls in claude-session-bridge and create-skills-architecture. Plain text `search` prints "0 concepts matched" where `--json` has hits.
- `skills status` counts commits since last-update, so uncommitted edits are only seen via extract then drift.
- `code-graph --version` on PATH prints 0.1.0 (extractor_version code-graph@0.1.0) although the plugin is 0.3.2.
- packages/ui and packages/styles belong to no concept (no skill documents them).
- Wildcard globs (session-*, claude-*, handoff*, report*) could silently capture future files.
- scribe.config.json fails prettier --check; pre-existing at HEAD.
- scribe-output/*.ast.json is meant to be committed (only graph.db* is gitignored); still untracked, as is tsconfig.code-graph.json.

Suggested ticket changes: a follow-up to run enrichment; optionally concept skills for packages/ui and packages/styles; a scribe-agent run to confirm criterion 4 end to end.
