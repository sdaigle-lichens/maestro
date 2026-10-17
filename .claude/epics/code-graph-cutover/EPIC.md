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
- The incremental-enrichment request became code-graph tasks 013 and 014.
  - 013 (CLI, 0.3.6): `enrich targets <concept> --json` picks new, changed, stale or named
    vertices, and `enrich merge <concept> <partial>` merges into `.enriched.json`, keeping edge
    reasons. Stale is now based on content (hash_seen); old entries keep the signature rule.
    Stale descriptions stop counting as enriched in gaps.ts.
  - 014 (skills, 0.3.7): retrieval writes gaps to the scribe channel, and the update flows enrich
    only the targets, via Haiku agents launched by the caller, with a spot-check.
  - Told code-graph-d1 to keep one json block per gap file and to leave the run_id stamp to
    maestro's SubagentStop. The file must be named after the writing agent's bare name.
  - After 0.3.7 ships: queue the maestro end-to-end check.
- code-graph 0.3.5 (8113777, local, unpushed) ships 012: the extractor version is recorded only in
  meta. The one-time rewrite is committed, and two re-extracts in a row are byte-identical.
- code-graph 0.3.6 (013, 892b871) and 0.3.7 (014, f9b7b6d) are pushed on feat/integrate-concept-skills.
  The user's plugin cache is still 0.3.4; only the PATH CLI is 0.3.7. Updating the plugin is the
  end-to-end check's precondition.
  - Gap: 0.3.7 runs the Haiku fan-out from the main session, but maestro runs the flows inside the
    scribe subagent, which can't spawn agents.
  - The user chose option A: in a subagent, the scribe enriches up to ~20 targets itself and
    reports any larger list as left to enrich. Maestro doesn't change.
  - Also sent: core-first enrichment. On first touch, `enrich targets --core` takes the vertices
    named in the SKILL.md, plus hubs (median ~13 per concept, against 274 for
    claude-session-bridge), and gaps.ts measures the ratio over core vertices only. Also reported
    the `search --json` max-tokens bug.
  - code-graph-d1 queued four tasks, to run in order:
    - 015 (0.3.8): the deps cache is keyed by ts-morph, so it survives plugin updates. Everyone
      reinstalls once.
    - 016 (0.3.9): `--core`, plus gaps measured over the core. A thin core (50+ vertices, fewer
      than 5 core) is reported.
    - 017 (0.3.10): the subagent path. Up to 20 targets are enriched inline, and first touch uses
      --core.
    - 018 (0.3.11): `search --json` honours --max-tokens.
  - The end-to-end check waits for d1's one-line notice that 0.3.11 is pushed. Then the user
    updates the plugin and runs `deps install`.
- code-graph 0.3.11 is pushed on feat/integrate-concept-skills (not on main):
  - 015 1e0c9a6, 016 fe54a57, 017 4c818ec, 018 4cbc905.
  - The deps cache is now deps/ts-morph@28.0.0.
  - The user's cache showed 0.3.9.
  - Queued 111, the end-to-end check, gated on 0.3.11 installed plus one `deps install`.
  - code-graph-d1 deferred two JSON-output tickets: --max-tokens for the other query commands, and
    search JSON keeping edges within the budget. 111 reports any case of (a) query output read as
    --json, or (b) plain-text search dropping needed edges.
- The user installed plugin 0.3.11, and I ran `deps install` from it.
  - Core sizes run larger than my estimate, because hubs are added: median about 20, and 9 of 16
    concepts are above 20 (claude-session-bridge 50, log-view 44). None is thin; maestro-architecture
    has 21.
  - 111 now covers both paths: agents-view (18, inline) and task-queue (27, left to enrich, then a
    main-session fan-out).
- 111 done (r006, maestro-94). Both paths work through maestro:
  - agents-view: the scribe enriched all 18 core vertices itself.
  - task-queue: the core of 28 was reported as left to enrich, then 3 Haiku batches ran from the
    main session; 6 descriptions spot-checked correct.
  - Gap file: stamped and inlined. Edge reasons survive a re-extract.
  - `search blockedBy`: parseBlockedBy 13th -> 4th, ~3004 -> ~1821 tokens.
  - Manager check: the ast.json diffs are only the per-vertex `ast.extractor_version`. 0.3.5 still
    wrote it and 0.3.11 writes `{}`; vertex and edge counts are equal, and the skill section changed
    because the skill was edited. The next extract churns all 16 files once.
  - Findings:
    - The core grows when the scribe names more code in the SKILL.md (18 -> 22), and can cross 20.
    - `gaps` is not a CLI command; that criterion was my error.
    - The scribe reads `enrich targets --json` (29 KB, too big to inline). That is not query output.
    - A natural-language search ("how an agent's description or avatar is edited") missed
      agents-view entirely.
    - The gap file was retired at the next scribe start without being acted on, so the gap is lost.
    - The scribe ended `HANDOFF: done`, which has no route; the orchestrator stopped and asked.
  - The diffs in maestro.json and plugin.json (0.11.27) come from another session, not 111.
  - With the user's approval:
    - Sent the search miss, the 29 KB `enrich targets` output and the core growing with the skill
      edit to code-graph-82.
    - Queued 112: keep a scribe gap until a scribe handles it.
    - The one-time ast.json churn becomes its own commit.
- `merge-proposal.md` and `plan.md` at the repo root stay untracked and uncommitted until 107 is done;
  workers must not commit or delete them.
