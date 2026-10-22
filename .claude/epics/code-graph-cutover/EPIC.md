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
  - Committed 95bd33c (111's results, 112) and 7c5c9d5 (0.3.11 snapshot rewrite).
    agents-view and task-queue were byte-stable on re-extract. maestro-architecture and
    maestro-config-model also caught up with 5647010's code.
- code-graph-82 queued two releases:
  - 019 (0.3.12): plain `enrich targets` stays lazy after the first touch. Today it lists every
    never-enriched vertex. Adds `--summary` and `--json --vertex`.
  - 020 (0.3.13): a subagent enriches the top 20 targets and lists the rest, instead of none.
  - Until 0.3.12, don't run update-concept-skills on an enriched concept such as task-queue: it
    would fan out the whole concept.
  - Search re-run after enrichment: agents-view is now 1st, but only its avatar code shows, not
    agent-descriptions.ts. Reported to code-graph-82.
  - code-graph-82: a query with two intents ranks one of them, so no ticket. The single-intent
    query "how an agent's description is edited" does find agent-descriptions.ts (checked). The
    "← triggered by" label on every inbound edge is a bug, and its fix rides along in 019.
- code-graph 0.3.12 (019, 79a11a1) is committed, sent by manager-concept-skills-merge (code-graph's
  epic manager).
  - Plain `enrich targets` is now lazy: it lists the core, changed and stale vertices, and those
    touched since the last apply. The old full listing is `--all`, and `--core` does nothing now.
  - `--vertex` now narrows the list instead of adding to it.
  - Manager check with the PATH CLI 0.3.12: task-queue lists 0 targets (core 28 enriched, 75 left
    out); agents-view lists 0 (core 18, 48 left out).
  - The plugin cache is still 0.3.11, so the scribe-lazy caution stands until the user updates.
  - Next from code-graph: 020 (0.3.13, the subagent enriches the top 20) and 021 (0.3.14, un-enriched
    search hits are reported as "enrich only" gaps). Their manager sends the versions after 021.
- code-graph 020 (0.3.13) is accepted by its manager and awaits the user's commit. Its report,
  r018, came here by mistake; I forwarded it.
- Queued 114: the scribe ends with `HANDOFF: success` when its docs are done.
  - Why: 111's `HANDOFF: done` stopped the Documentation run with NO ROUTE.
  - Owner: maestro, not code-graph. The code-graph scribe skill stays maestro-neutral, and
    maestro's own scribe.md (the plugin copy and its mirror) has no HANDOFF rule (checked).
  - `checkRoute` already accepts `success` with no edge, and stays strict on synonyms.
- code-graph 0.3.14 (021) is done but not committed.
  - Search marks un-enriched hits "_not enriched_".
  - Retrieval agents write `skill_gaps` entries whose `missing` reads "enrich only: …". The shape is
    unchanged.
  - The scribe enriches only those vertices, with no SKILL.md edit and no stamp.
  - Checked: no maestro code reads the `missing` text; it appears only in prompt seeds.
  - 112 was amended: a gap handled by enrichment counts as handled, so it can't be detected through
    a re-stamp.
  - Plugin update pending: 0.3.12–0.3.14 aren't installed. Install once all three are committed.
- 112 done (r007, acked). A scribe-lane file with a non-empty `skill_gaps` array survives delivery
  until a scribe ends with `SKILL_GAPS_HANDLED: <file>, …`, or ages out at 14 days. Plugin 0.11.28.
  - Manager check: the gap-retention, channel, parity and session-log tests pass (131).
  - The acknowledgement instruction lives only in the SubagentStart block, so a resumed scribe
    misses it. Folded into 114, which already edits scribe.md.
  - `pnpm verify` fails in the sandbox only (turbo drops TMPDIR); every step passes on its own.
  - Not re-stamped (ts-morph missing): maestro-architecture, log-view, plugin-libs-parity.
- The user re-stamped maestro-architecture, log-view and plugin-libs-parity from their shell; no
  snapshot changed. The sandbox can't read ~/.cache/code-graph/deps, so graph commands fail inside
  a session. Asked code-graph's manager to offer a sandbox read path at install, and to make the
  error say "installed but unreadable".
  - Ticketed as code-graph 022, for 0.3.15. Settings key: `sandbox.filesystem.allowRead`, added
    to user settings only on the user's yes. The worker may move the install into
    `$CLAUDE_PLUGIN_DATA` instead, which the sandbox can already read.
  - 0.3.15 (022) is done but not committed. The install stays in ~/.cache. The error and
    `deps status` now name `sandbox.filesystem.allowRead`, and code-graph-install offers the edit.
    This project's sandbox setting is the user's decision.
- Correction: the user's re-stamp did change snapshots. The three `scribe-output/*.ast.json` files
  caught up with 112's code; I had only checked `.claude/` and `apps/`.
- 114 done (r008, acked). The scribe now ends with `SKILL_GAPS_HANDLED:` (when it acted on gaps)
  and then `HANDOFF: success`, or `partial` when it couldn't finish. The rule is in scribe.md, its
  mirror and the report default. Plugin 0.12.1.
  - Root cause of r006: the project's `.claude/reports/scribe.md` said `HANDOFF: <next agent or
    done>`. Fixed.
  - Only the scribe lacked the rule; the other agents get it from `VERDICT_HANDOFF_NOTE` or state it
    inline.
  - Manager check: report-defaults, orchestrator-robustness and parity tests pass (113).
  - Follow-ups: the injected SubagentStart gap block now says `SKILL_GAPS_HANDLED:` goes just
    before `HANDOFF:` (plugin 0.12.2, fixed directly). The scribe and test forks in
    agent-forks.json still record template 0.11.23; the user re-baselines them with /maestro-update.
- All 8 tasks are done.
- Merge review (`merge-review.md` in this folder). Search on un-enriched concepts got worse (R1:
  2/8 on a maestro eval); the rest is minor or better.
  - User decisions: the committed 491 KB bundle stays (R2), and lazy enrichment is the intended
    steady state, so R1 is structural.
  - Sent R1 and R3–R9's code-graph halves to code-graph's manager.
  - R9 was partly wrong: what the user ran was a graph refresh, not a skill re-stamp.
  - Queued 115 (an install hint with exact commands) and 116 (bring the stale concept skills up
    to date). Maestro's half of R7 waits for code-graph's gap fixture.
  - code-graph ticketed them as 023–027 (planned 0.3.16–0.3.20):
    - 023: R1 ranking + `low_confidence`, and R9's wording.
    - 024: R3 drift by content hash.
    - 025: R4 scribe size and `--max-tokens`.
    - 026: R5 and R6's code-graph half.
    - 027: R7 fixture at `plugin/contracts/skill-gaps.example.json`, plus R8.
  - Two corrections from code-graph:
    - R1: SKILL.md bodies are indexed, so the cause is ranking, not missing docs.
    - R5: a sandbox hides denied paths as ENOENT, so deps status becomes three-way.
  - Maestro's half: the R6 install command (115), retiring the old `concept-skills@maestro` install
    (the user's own `claude plugin uninstall`), and the R9 re-stamp of log-view and
    plugin-libs-parity (inside 116).
- code-graph 0.3.16 (023) done, not yet committed. The cause of R1: FTS didn't split camelCase.
  The eval went from 2/8 to 7/8. A low-confidence `search` now exits 7, which means "results printed,
  low confidence", not failure. No maestro hook or script maps search exit codes, so nothing to change.
  - The remaining miss, `ma-design-check`, is folded into 116: name `seedSkillsFor` and the design
    check in the concept's SKILL.md. 116 now also needs 0.3.16 and a `code-graph reindex` first.
  - 116's "design check" criterion relaxed to "`seedSkillsFor` in the top 5, exit 0 or 7": exit 7
    is by design for an un-enriched concept, and we don't enrich just to clear the threshold.
- code-graph 0.3.17 (024, R3) done, not yet committed. `extract` stores file hashes in `.ast.json`
  `meta.files`, and status/drift report `unextracted` file counts. A concept gets this only after
  its first extract on 0.3.17, so 116 now needs 0.3.17 and extracts every concept, stamped-only
  ones included. Known limit: concepts that glob `dist`/`build` aren't scanned.
  - 116's `meta.files` check applies only to `.ast.json` files with vertices; docs-only concepts
    have none, by design.
- code-graph 0.3.18 (025, R4) committed on feat/integrate-concept-skills (90f7b24), not pushed.
  0.3.17 is b12e082.
  - Scribe SKILL.md went from 16.7 KB to 9.0 KB; enrichment moved to `enrichment.md`, read on demand.
  - search JSON gaps are compact and trimmed; `skills status --summary` is new.
  - The FTS index rebuilds itself once after an upgrade, so 116 no longer asks for `reindex`.
  - No maestro code depends on the scribe skill's text; nothing to change.
- code-graph 0.3.19 (026, R5 and R6's code-graph half) committed (e876d55), not pushed.
  - Store commands exit 8 with a one-line fix when node:sqlite is missing; layer 1 is unaffected.
  - `deps status` gains `not-visible` for a hidden sandbox path.
  - code-graph-uninstall lists each leftover and asks per item, default no.
  - Maestro never runs `deps status` and never reads code-graph's exit codes; nothing to change.
- code-graph 0.3.20 (027, R7 and R8) committed (82a46ab), not pushed. code-graph's side is closed:
  tickets 003–027 are all done.
  - The gap contract is at `plugin/contracts/skill-gaps.example.json` (+ `.schema.json`), and
    code-graph's tests pin its skill examples to it.
  - Without maestro, the scribe reads `.claude/channels/scribe/*.md` itself at the start of a run.
  - Queued 117 (maestro's half of R7): vendor both files into maestro's test fixtures and test the
    full gap-report lifecycle against them. Nothing reads across repos.
- The user uninstalled concept-skills@maestro (both scopes), updated code-graph to 0.3.20, and
  updated the guardrails. The hook now allows reads in the sandbox's allowRead.
- 115 done (r009, acked). Both missing-code-graph hints now give
  `claude plugin marketplace add sdaigle-lichens/code-graph`, then
  `claude plugin install code-graph@code-graph`. Pinned by a test; plugin 0.12.3.
  - Manager check: code-graph's remote is sdaigle-lichens/code-graph, and the installed key is
    code-graph@code-graph. skill-availability, parity and code-graph-plugin tests pass (100).
  - code-graph's own README shows only the `/plugin install … --marketplace` form. Code-graph
    could add the CLI form there; not a maestro task.
- code-graph README now has the two-step install, both in-session and shell forms (code-graph
  05cf5b7, on the user's request).
- 116 done (r010, acked). Two concepts edited: maestro-architecture now names `seedSkillsFor` /
  `DESIGN_CHECK_CANDIDATES`, and claude-session-bridge's module list and line counts were fixed.
  13 were stamped only and agents-view was extract/apply only. List v1.30.
  - Manager check: `skills status --summary` shows 0 commits, 0 changed/stale and 0 unextracted
    everywhere. `search "design check"` ranks `seedSkillsFor` #1 (exit 7, as accepted).
  - Enrichment stayed small: 8 new `.enriched.json` files, about one vertex each.
  - `skills stamp` can't write `.claude/skills/**` from Bash (the sandbox's denyWithinAllow), so
    the scribe set four stamps by hand to the tool's values. Status confirms them. The sandbox
    rule is the user's call. A code-graph option: on EROFS, print the exact frontmatter to set.
  - The worker flagged that "stamped only" was decided from commit lists and diffs, not a full
    re-read of each SKILL.md.
  - `worktree-write-guard.ts` vertices appear in both log-view and plugin-libs-parity (overlapping
    globs). Harmless, noted.
- The user committed 116. Asked code-graph for a `skills stamp` fallback: on a read-only SKILL.md
  it prints the exact frontmatter lines and exits with a documented code, so the scribe applies them
  with Edit instead of hand-computing them. The `.claude/skills` write block is Claude Code's own
  protection and stays.
  - Ticketed as code-graph 028 (planned 0.3.21). Stamp is one skill per call: on a write error it
    exits 9 and prints the lines to apply (`--json`: written:false, blocked.lines). `--print`
    computes without writing. Four code-graph skills will say "on exit 9, apply verbatim with Edit".
    Maestro never runs `skills stamp` itself; nothing to change.
- 116's worker follow-up: a stamp proves nothing about review. `status` counts commits but doesn't
  say which mapped files changed, and SKILL.md prose has no drift check. The riskiest stamped-only
  concepts are plugin-libs-parity (14 commits), electron-shell-invariants (13), workflow-view (9),
  log-view (7) and rule-view (7).
  - User approved. Asked code-graph for: `status` lists the mapped files changed since the stamp,
    and `stamp` warns (doesn't refuse) on a stamp-only over changed files, with a `--reviewed`
    override.
  - Queued 118: a full read of those five concepts against today's code.
  - Ticketed as code-graph 029 (planned 0.3.22), blocked by 028. Per-file counts in `status`; the
    stamp warns on stderr, still exits 0, and takes `--reviewed`. The flows require a reason for each
    stamp-only. Maestro: no change.
- 117 done (r011, acked). code-graph 0.3.20's gap example and schema are vendored under
  `apps/maestro/test/fixtures/` with a README (source, version, re-copy rule).
  - The fixture runs through the real hooks: classify, rename, inline to the scribe, survive
    delivery, retire by SKILL_GAPS_HANDLED. There is a negative control.
  - A hand-written validator checks every agent's emitted gap example against the schema.
    No plugins/ change.
  - Manager check: both vendored files are byte-identical to code-graph's, and the two test files
    pass (24).
  - Limits: drift is caught only after a re-copy, the validator checks only required keys and
    types, and the example regex is tied to the report-default wording.
  - User decision: only the drift limit gets action. Asked code-graph for a `.claude/rules/` entry:
    a change under `plugin/contracts/` must be called out to maestro in the release note.
    - Mostly exists already: code-graph's `.claude/rules/plugin-skills.md` (e9d01f4) says a contract
      change goes to maestro's manager. The extension (old and new shape in the note, one version
      of the old shape kept on a breaking change) is committed in code-graph (628e56a). The
      contract is unchanged since 0.3.20.
- 118 done (r012, acked). All five concepts were read in full and every one had real
  inaccuracies: wrong file locations, renamed functions, removed UI, and one false claim about this
  repo's maestro.json. 16 files were edited and the five are stamped at v2.0 (log-view v3.0). The
  stamps were written by the tool, and no vertices were enriched.
  - Manager check: `skills status --summary` shows 0 commits, 0 changed/stale and 0 unextracted
    for all five.
  - Lesson: 116's "stamped only" was wrong 5 out of 5 times, so the other 8 stamped-only concepts
    are suspect too. That backs code-graph 029.
  - The user committed 118. Queued 119: the same full review for the other eight (task-queue,
    installing-maestro, updating-maestro, agent-fork-sync, create-skills-architecture, docs-view,
    global-stores, maestro-config-model).
- 119 done (r013, acked). All eight concepts had real inaccuracies, so 116's stamp-only calls were
  wrong 13 times out of 13. 31 files were corrected; all eight are stamped v2.0 @5dd6034, and no
  vertices changed.
  - The stamps for task-queue, installing-maestro and updating-maestro hit EROFS (exit 9, so 028's
    fallback is live). The worker applied the printed lines verbatim with Edit.
  - Manager check: `skills status --summary` shows all 16 concepts at 0 commits, 0 changed/stale and
    0 unextracted. The repo-level list (v1.30 @eb19235) is 3 commits behind, which wasn't in
    scope.
  - On the user's request, the manager re-stamped the repo-level list: v1.31 @5dd6034, and all 16
    concepts plus the list are now at 0 commits. A plain `skills stamp` (no `--bump`) wrote "1.0"
    over "1.30". I reverted it, re-ran it with `--bump minor`, and reported the bug to code-graph.
    It's ticketed as code-graph 030 (0.3.22). A repo-level stamp with no `--bump` over an existing
    version will refuse with exit 1. The per-skill stamp already refuses. 029 moves to the next
    patch, and 028 is done but not yet committed. Maestro: always pass `--bump`.
  - `.claude/maestro.json` `runtimeVersion` 0.12.2 → 0.12.3 is the runtime picking up plugin
    0.12.3 (from 115), not the worker's edit.
- The user asked for 119 to be committed (74a1e0b).
- code-graph 0.3.21 (028) committed (55a23a7), not pushed. A blocked stamp exits 9 with the lines
  to apply; `--print` computes without writing. The gap contract is unchanged. Next: 030, then 029.
- Queued 120: a full review of maestro-architecture, claude-session-bridge and agents-view, the
  three never fully read. It carries a manual precondition (code-graph with 029 installed), and the
  user will start it once that ships. It uses 029's changed-files list, `--reviewed`, and an
  explicit `--bump` throughout.
- code-graph 0.3.22 (030) committed (7011b96), not pushed. A repo-level stamp with no `--bump`
  refuses over an existing version.
- code-graph 0.3.23 (029) committed (bc86d8c), not pushed. Per-file changed counts in
  `skills status <skill>`; the stamp-only warning has a `--reviewed` override. Known limit: the
  first re-stamp after a skill is created gives no warning. All code-graph tickets 003–030 are done,
  and the contract is unchanged. Task 120's precondition now names 0.3.23.
- 120 done (r014, acked) on code-graph 0.3.23.
  - agents-view 1.15: several fixes.
  - claude-session-bridge 2.5: one fix; everything else verified.
  - maestro-architecture 1.25: stale lifecycle steps, the hook count, renamed functions.
  - Repo list at v1.32. No stamp warnings, and exit 9 was applied verbatim.
  - Manager check: all 16 concepts and the list are at 0 commits, 0 changed/stale and
    0 unextracted.
  - Worker finding: install.ts:319-326 says HOOK_REGISTRATIONS mirrors hooks.json one-for-one, but
    `maestro-channel-write-guard.js` is plugin-only. Per hooks.md, that guard is the only thing
    stopping reviewer/refactor from editing code. So a project-local install without the plugin
    may leave them unconfined. Possibly more than a stale comment.
  - The user committed 120. Queued 121. It first proves whether reviewer/refactor can run
    unconfined without the plugin. If they can, it registers the guard in the project install
    (with tests, arbitration, a lib rebuild and a patch bump). If they can't, it fixes the comment
    and adds a divergence test.
- 121 done (r015, acked). The gap was real (branch 2a): a forked or user-tier reviewer runs
  unconfined in a project-local install with the plugin disabled.
  - The guard is now in HOOK_SCRIPTS/HOOK_REGISTRATIONS and `maestro-install.js`; the plugin copy
    stands down via `projectOwnsHook`; mirror added; plugin 0.12.4; 13 new tests.
  - Manager check: 206/206 in the guard, install, team-meeting and parity suites. Ran the missing
    extract/apply for installing-maestro and updating-maestro (hand-stamped by the worker); all
    16 concepts now show 0 unextracted.
  - Caveats: the runtime identity hash changes, so every project is told to re-install once. This
    repo's `.claude/settings.json` is write-protected from the sandbox, so the user runs
    `/maestro-update` here. `pnpm verify` fails in the sandbox only at the turbo test step (tmp
    dir); the same steps pass with `--env-mode=loose`. There's no negative control against
    pre-fix code.
- Every concept skill has now had a full review (118–120).
- `merge-proposal.md` and `plan.md` were deleted on the user's approval.
