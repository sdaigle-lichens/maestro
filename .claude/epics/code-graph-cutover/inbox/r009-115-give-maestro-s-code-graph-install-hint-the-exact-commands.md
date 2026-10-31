# Report r009: 115-give-maestro-s-code-graph-install-hint-the-exact-commands.md

- Task: 115-give-maestro-s-code-graph-install-hint-the-exact-commands.md
- Written: 2026-10-21T16:08:06.906Z
- From session: maestro-a92095d5

Outcome: done. Clean session, no post-mortem.

Both missing-code-graph hints in apps/maestro/src/core/skill-availability.ts now give the exact commands: `claude plugin marketplace add sdaigle-lichens/code-graph`, then `claude plugin install code-graph@code-graph`. One shared string feeds both the scribe.config.json and the legacy concept-skills.json variants. Text only, no code dependency on code-graph; code-graph-plugin.test.ts needed no change.

Changes: new test in test/core/skill-availability.test.ts pins both commands, their order, and the full scribe.config.json hint. Plugin lib rebuilt and mirrored to .claude/scripts/lib/, parity test green, maestro plugin 0.12.2 -> 0.12.3. pnpm verify passed (2115 tests) with TURBO_ENV_MODE=loose.

Findings:
- No other surface needed a change: the renderer notice (skill-ref-mark.tsx) shows report.suggestions verbatim, the dev stub has no hint text, and the root README already had both commands.
- code-graph's own README documents only `/plugin install code-graph --marketplace sdaigle-lichens/code-graph`. The two-step CLI form comes from maestro's README and is consistent with code-graph's marketplace.json (marketplace and plugin both named code-graph). Neither doc spells out the CLI form itself.
- The legacy hint's trailing sentence ("Then migrate via /code-graph-install.") is not pinned by the test; judged immaterial.

Suggested ticket changes: none. Changes are uncommitted in the main checkout.
