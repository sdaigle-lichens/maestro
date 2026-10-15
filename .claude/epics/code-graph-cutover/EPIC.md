# Epic: code-graph-cutover

## Goal

Replace the opt-in concept-skills plugin with the code-graph plugin for maestro's scribe and subagents, then remove concept-skills

## Scope

In: phase 17, the maestro side only — tasks 105 (accept both design checks, additive), 106 (switch
this repo + dogfood the scribe), 107 (remove concept-skills).

Out: phases 12–16, the code-graph side. They live in `~/gits/code-graph/plan.md` and that repo's
own task queue as epic `absorb-concept-skills` (tasks 003–006, managed by session `code-graph-44`;
006 is the publish, and that manager will send the published version here). This epic does not edit or track
them; it only waits on their result.

External gate: 105 must not start until the code-graph plugin is published in its own marketplace
and installable with `use-code-architecture-design-check`, `scribe`, the concept-skill flows and
`code-graph-install`. The tracker can't express a cross-repo blockedBy, so 105 shows `ready`; the
gate is in its prompt.

## Decisions

- Repos stay autonomous: maestro names code-graph only as a soft skill id in the design-check
  candidates; code-graph stays in its own marketplace (not listed in maestro's).
- Opt-in/out like any plugin: with code-graph disabled, maestro seeds no design check and errors on nothing.
- Cutover is additive first (both candidates), removal last (107), after 106's dogfood proves parity.
- A parity gap found in 106 is filed against code-graph, not patched around in maestro.
- concept-skills' `stampConceptSkill` mishandles CRLF SKILL.md files (found by code-graph task 003,
  fixed in its port). Not upstreamed: 107 deletes the package, and no SKILL.md in this repo is CRLF.
  106's parity check should include a CRLF fixture if one is added before then.
- 2026-10-15: external gate met. code-graph 0.3.0 published (plugin.json and marketplace agree)
  with the design check, scribe, concept flows and install/update/uninstall; bundled CLI is 471 KB.
  The user installed it at user scope via `/plugin install code-graph@code-graph`; the project-level
  `enabledPlugins` switch is still 106's job. 105 may start.
- 105 done (r001). Accepted deviation: the generated availability lib also names code-graph in
  suggestion prose and its enabledPlugins check, not only the candidate id; the no-plugin-names test
  confines that to that one lib. Still opt-in, so kept. 107 must reduce it to code-graph only, not remove it.
- 106 clarifications (sent to maestro-76): `/code-graph-install` is user-invoked only
  (disable-model-invocation), so the user types it; README install is
  `claude plugin marketplace add sdaigle-lichens/code-graph` + `claude plugin install code-graph@code-graph`;
  the dogfood change is 105's own edit to skill-availability.ts, picked up by a scribe-only
  Documentation run. Nothing flagged = parity finding, reported not forced.
- code-graph task 007 (0.3.1, code-graph-3d) drops the `/scribe-enrich`, `/code-graph-init` and
  `/add-concept` commands (the add-concept skill stays), keeps `/graph`. Doesn't block 106.
  107's docs must not point users at the dropped commands.
- 106 dogfood (maestro-76): cutover landed and the scribe stamped concept-skills-system 1.4 -> 1.5, but
  extract + apply failed. Criteria amended with the user: extract + apply are expected to be skipped
  (no `concepts` yet); the gap channel is proven with a synthetic gap file. maestro-architecture
  re-stamp moved to 107.
- Design flaw (mine): "resolve typescript/ts-morph from the project" fails in a pnpm monorepo
  (typescript not at the root, ts-morph in no project). Sent to code-graph-3d with the extract
  no-op bug; awaiting its task number and fixing version.
- 109 added: configure maestro's graph concepts, blocked by 106 plus a manual precondition on that
  code-graph fix. Without it maestro gets concept skills from code-graph but no graph exploration.
- 106 done (r002). Gap check: the hand-written synthetic file had no run_id stamp, so SubagentStart
  only mentioned it rather than inlining it; the scribe read it and acted on it. Same-run inlining is
  maestro's own hook, unchanged by this epic and plugin-independent, so no follow-up task.
- code-graph task 008 fixes both 106 findings in 0.3.2 (plugin-owned deps via `code-graph deps install`,
  project install as fallback); 0.3.1 (007) is committed. 109's precondition now names 0.3.2.
- 107 done (r003, maestro-50). Manager check: a fresh, uncached `pnpm --filter maestro test` passed
  (1979/1979); the remaining `concept-skills` mentions are all legitimate: the legacy-state migrate
  hint and its tests, code-graph's own skill names in the README, a historical design doc, and
  dev-skill notes on the legacy file. Phase 17's removal is complete; only 109 remains (waits on code-graph 0.3.2).
- `merge-proposal.md` and `plan.md` at the repo root stay untracked and uncommitted until 107 is done;
  workers must not commit or delete them.
