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
- 2026-10-15: code-graph 0.3.2 (ae504c7, via code-graph-6f) meets 109's precondition locally. Caveat:
  ae504c7 is on code-graph's feat/integrate-concept-skills branch, 3 commits ahead of origin and not
  on its default branch. This repo's settings.json and README point at the GitHub marketplace
  (sdaigle-lichens/code-graph), so a fresh clone gets an older code-graph until that branch is pushed and merged.
- 109 done (r004, maestro-a4): 16 concepts in scribe.config.json plus tsconfig.code-graph.json;
  1480 vertices, 3510 edges. Manager check: `skills check` ok, no maestro code depends on code-graph.
  Search works for identifiers (`MaestroTasksPage` returns its call edges) but is weak for domain
  terms while un-enriched: `blockedBy` matches task-queue through its skill doc, then lists all 103
  of its vertices with no ranking, and `parseBlockedBy` is buried. `--json` hits carry no edges
  and bm25 is 0. Enrichment is the follow-up. The text-mode "0 concepts matched" for a multi-word
  query, and `--version` printing 0.1.0, are code-graph bugs.
  The 16 `.ast.json` files total 2.2 MB, and every extract restamps them. Whether to commit them
  is the user's call.
- Sent to code-graph-6f: the three search/version bugs above, plus a request for stable `.ast.json`
  output (no per-run timestamp) so it can be committed without churn. Queued 110 (enrich the
  concepts); its acceptance needs `blockedBy` to rank a tasks.ts function in the top 5.
- code-graph-6f ticketed all of it. Task 009 covers search bugs 1 and 2 plus the enrichment hint;
  the likely root cause is that doc-seeded vertices are never expanded. Task 010 covers the version
  string (package.json is still 0.1.0) and byte-stable `.ast.json` (it drops the per-vertex
  `extracted_at`). code-graph-6f will send one line when either ships. `.ast.json` stays
  uncommitted until 010 is published. If 110 runs before 009 ships, its ranking criteria test
  enrichment alone.
- 2026-10-16: code-graph 0.3.3 (ffc15aa and 9f166c0 via code-graph-72, local and unpushed) fixes all
  of the above. Manager check: `--version` reports 0.3.3. A second extract of all 16 concepts left
  every `.ast.json` byte-identical (hashes matched). Plain-text "blockedBy cascade" now lists
  results and the enrichment hint. Still weak until 110: it ranks claude-session-bridge above
  task-queue, prints about 14.7k tokens, and repeats the same caller at the same line several
  times in its edge lists.
- The repeated edges became code-graph task 011 (code-graph-d1, formerly code-graph-72): there is
  one edge per call site; plain text will group them into one line with the call-site line numbers
  (--json unchanged). 011 also checks why the output ran to ~14.7k tokens against a default
  --max-tokens of 3000. It doesn't block 110.
- code-graph 0.3.4 (3f56918, local and unpushed) ships 011. Manager check: edges are grouped with
  their call lines, and the totals line reads ~3004 tokens. New churn: extractor_version is stamped
  on every vertex and edge, so the plugin upgrade alone rewrote all 16 committed `.ast.json` files.
  Asked code-graph-d1 to keep the version only in meta. It became code-graph task 012, which records
  the version once in meta and moves extracted_at only when content changes. I discarded the 0.3.4
  re-extract. When 012 ships, commit its one-time rewrite as the only churn commit.
- 110 done (r005, maestro-d4), with a deviation: the enrichment came from a deterministic script
  kept outside the repo, not code-graph's scribe skill. Its purposes paraphrase names and comments,
  its tags are domain keywords, its edge reasons follow a template, and cross_concept_refs is empty.
  Its criteria pass (blockedBy ranks parseBlockedBy 2nd, and 4 other queries rank well), but
  "design check" and "plugin libs parity" rank noise. The `.enriched.json` files total 1.1 MB and
  are stable across re-extract. Committing them is the user's call. Also noticed: `--json` search
  ignores `--max-tokens` (a "design check" query returned 459 KB).
- Superseded (see below). User chose option B, done cheaply: queued 111 to re-enrich every concept with code-graph's
  enrichment procedure. The main session fans out Haiku agents, one per concept (subagents can't
  spawn subagents), and chunks the big concepts. The orchestrator validates keys and spot-checks
  purposes. "design check" and "plugin libs parity" must each rank the right code in the top 3. The
  script-generated `.enriched.json` files stay uncommitted until 111 replaces them.
- User redirected: concept skills lay out the map, and the graph is enriched a little at a time as
  tasks use it. 111 was cancelled (file deleted, never committed), and 110's script-generated
  `.enriched.json` files were discarded: filler descriptions would count as "enriched" under
  gaps.ts's 90% rule and hide each concept's gap. The local graph.db still holds them, because
  deleting the store was blocked, so the user must clear it. Sent code-graph-d1 four requests:
  partial enrichment that merges into the existing file (apply wipes edge reasons missing from it),
  stale on a body change (today a body-only edit is never stale), poor searches written to the
  scribe gap channel, and incremental Haiku enrichment in the update flows. Maestro needs no change;
  after it ships, one small end-to-end check task.
- code-graph 0.3.5 (8113777, local, unpushed) ships 012: the extractor version is recorded only in
  meta. The one-time rewrite is committed, and two re-extracts in a row are byte-identical.
- `merge-proposal.md` and `plan.md` at the repo root stay untracked and uncommitted until 107 is done;
  workers must not commit or delete them.
