# Report r010: 116-bring-maestro-s-stale-concept-skills-up-to-date.md

- Task: 116-bring-maestro-s-stale-concept-skills-up-to-date.md
- Written: 2026-10-21T16:29:20.765Z
- From session: maestro-54a42673

Task 116: done. Docs-only; no application code or plugins/ changed. Nothing committed.

Outcome
- `code-graph skills status`: 0 commits since stamp for all 16 concepts; repo list v1.30 @eb192356, 0 commits.
- Every concept extracted and applied: `graph: 0 changed, 0 stale`; every `.ast.json` with vertices has `meta.files`.
- `code-graph search "design check"`: `seedSkillsFor` is result #1 (exit 7, allowed: un-enriched concepts).

Edited
- maestro-architecture: added the Step 1 design check is chosen by `seedSkillsFor` from `DESIGN_CHECK_CANDIDATES` (replaces the old "seeded design-check skill" line).
- claude-session-bridge: "not this concept" bullet now lists all Log-side `session-*` modules; file-map line counts corrected (claude-preview 545, session-handoff 120).

Stamped only (13)
task-queue, installing-maestro, updating-maestro, agent-fork-sync, create-skills-architecture, docs-view, electron-shell-invariants, global-stores, log-view, maestro-config-model, plugin-libs-parity, rule-view, workflow-view. agents-view had 0 commits, so extract/apply only.

Findings
- `skills stamp` hit EROFS (sandbox) on `.claude/skills/**`: maestro-architecture, task-queue, installing-maestro, updating-maestro. The scribe set their `metadata.version`/`last-update` by hand to match the stamp's values; status confirms they are clean. The sandbox needs write access to `.claude/skills` for the stamp tool.
- "Stamped only" was decided from commit lists, diffs and keyword coverage, not a full read of each SKILL.md against its changed code. Some of the 19 enrichment descriptions (log-view components) rest on a skim.

Suggested ticket changes: none.
