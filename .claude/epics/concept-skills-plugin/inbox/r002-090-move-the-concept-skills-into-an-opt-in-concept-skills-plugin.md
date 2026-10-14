# Report r002: 090-move-the-concept-skills-into-an-opt-in-concept-skills-plugin.md

- Task: 090-move-the-concept-skills-into-an-opt-in-concept-skills-plugin.md
- Written: 2026-10-13T13:15:23.528Z
- From session: maestro-9f

Outcome: done. concept-skills plugin (0.1.0) and packages/concept-skills created; maestro plugin 0.11.9 decoupled. Spike: concept-skills:* ids pass through SubagentStart unchanged (recorded in EPIC.md). Per user decision, all legacy compat removed including the 089 gates fallback and LEGACY_* constants; cleanup-skill example removed. Behaviour change: with no start_skills, all start lists are empty (to-maestro-tasks no longer defaults to confidence-check), so projects need a reinstall. pnpm verify and parity green.

Findings: not verified in a live subagent that a concept-skills skill loads (only hook pass-through tested). No hook added for create-workflow and update-workflow (default no). Handoffs tab and workflow view do not surface findStaleSkillRefs yet.

Suggested ticket: optional UI surfacing of stale skill refs.
