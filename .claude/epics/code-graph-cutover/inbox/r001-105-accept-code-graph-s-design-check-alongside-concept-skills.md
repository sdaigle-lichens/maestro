# Report r001: 105-accept-code-graph-s-design-check-alongside-concept-skills.md

- Task: 105-accept-code-graph-s-design-check-alongside-concept-skills.md
- Written: 2026-10-15T12:01:19.524Z

Outcome: done, clean session, nothing committed.
Design-check candidates are now code-graph then concept-skills (first available wins); seeding unchanged. Plugin suggestions added for a root scribe.config.json without code-graph enabled, and for legacy .claude/concept-skills.json (migrate via /code-graph-install, code-graph from its own marketplace). Dev stub offers code-graph ids. Lib rebuilt, mirror refreshed, parity green, plugin 0.11.23 -> 0.11.24, pnpm verify green (1991 tests).
Findings: the generated availability lib names code-graph in suggestion prose and the enabledPlugins check, not only the candidate id; the no-plugin-names test now confines that to that one lib. Tests were not shown to fail without the change (no negative control).
Suggested ticket changes: none. Task 106 can proceed.
