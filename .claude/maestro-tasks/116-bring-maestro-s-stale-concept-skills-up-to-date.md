# Bring maestro's stale concept skills up to date

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

A merge review (report: .claude/epics/code-graph-cutover/merge-review.md, R9) found that maestro's concept skills have fallen behind the code. `code-graph skills status` shows the repo-level list at v1.29 @4d162ea, 37 commits behind. Every concept except agents-view has commits since its stamp, for example:
- claude-session-bridge: 12 commits;
- electron-shell-invariants: 13;
- plugin-libs-parity: 13;
- workflow-view: 9.
maestro-architecture, log-view and maestro-config-model also have stale enriched vertices (3, 4 and 1).

Run the code-graph scribe flow (`code-graph:update-concept-skills`) over this repo, through the Documentation workflow, so each stale concept's SKILL.md matches the code and gets re-stamped. Then run `extract` and `apply` per concept so the graph matches. Enrichment stays lazy: only re-enrich vertices that are stale or that the flow targets, not whole concepts.

A concept whose commits since its stamp don't change what the SKILL.md says only gets a re-stamp, not an edit. Say which concepts were edited and which were only stamped. Docs-only: no application-code change. Never touch files under plugins/ unless a plugin skill is itself a concept, and if so, follow the publishing rules and bump the plugin version.

Run `extract` and `apply` on every concept, including ones that were only stamped (installing-maestro among them). On 0.3.17, a concept's first extract adds file hashes (`meta.files`) to its `.ast.json`; until then, drift can't see code edited since its last extract (e.g. 204f013's `installRuntime` change). So every committed `.ast.json` with code vertices is expected to change once. A marked skill with no `scribe.config.json` `concepts` entry has no `.ast.json`: extract doesn't apply, and only its git window (the re-stamp) is checked.

This needs code-graph 0.3.18 or later, and the sandbox must be able to read ~/.cache/code-graph. If a graph command still fails, report it rather than skipping silently. The first `search` after the upgrade rebuilds the index by itself. Run `code-graph reindex` only if it prints a lock/busy hint.

One search gap to close while editing: `code-graph search "design check"` doesn't reach `seedSkillsFor`, because no name, doc or SKILL.md text links the two (the eval's `ma-design-check` query). Say in the maestro-architecture SKILL.md (or whichever concept owns the seed) that the Step 1 design check is chosen by `seedSkillsFor` from `DESIGN_CHECK_CANDIDATES`, so search can find it.

## Acceptance criteria

- [ ] `code-graph skills status` shows 0 commits since the stamp for every concept, and for the repo-level list, at the time the task finishes.
- [ ] `graph: 0 changed, 0 stale` for every concept after extract and apply. `unextracted` is 0, or absent for a docs-only concept. Every `.ast.json` with at least one vertex has `meta.files`. A docs-only concept has none, by design.
- [ ] The report lists each concept as edited or stamped only, with a one-line reason for each edit.
- [ ] `code-graph search "design check"` has `seedSkillsFor` in the top 5 results. Exit 0 or 7 both pass: an un-enriched concept exits 7 by design, and enrichment stays lazy.
- [ ] No application code changed.

## Blocked by

None — can start immediately
