# Report r013: 119-fully-review-the-remaining-eight-stamped-only-concept-skills.md

- Task: 119-fully-review-the-remaining-eight-stamped-only-concept-skills.md
- Written: 2026-10-21T19:04:53.368Z
- From session: maestro-f0d5220f

# Report: task 119 — eight stamped-only concept skills fully reviewed

**Outcome:** done. All eight read in full against the current code of every mapped file; all eight corrected, stamped (v2.0 @ 5dd6034), extracted and applied. `skills status` shows 0 commits, 0 files, `graph: 0 changed, 0 stale` for each. Every apply reported 0 changed vertices, so no enrichment was needed. No application code and nothing under plugins/ changed.

## Corrections per concept
- **task-queue:** claims.ts function list completed; UI action row fixed and a row added for renderer/src/utils/maestro-tasks.ts; status.json shape is `{status, blockedBy, epic?}`; a missing blocker file counts as satisfied, writes atomic with sorted keys; merge offer is template Step 8 (worktree only, offered not done); Post Mortem is Step 5; added the `*.log` gitignore trap; warnings/no-op conditions rewritten. epics.md and live-task-updates.md checked, unchanged.
- **installing-maestro:** line counts updated; rows added for maestro-post-mortem-context.js and maestro-session-name.js; maestro-channel-write-guard.js noted as plugin-only; 30 files = 12 scripts + 9 libs + cleanup + 8 hook scripts; GITIGNORE_ENTRIES is 7 lines, SKILL_INVOKED_SCRIPTS 5 names; parity test covers the .claude/scripts mirror.
- **updating-maestro:** eight hook scripts; generated libs are all scripts/lib/*.cjs except maestro-tasks.cjs, from 17 sources; mirror and parity note; latest minor 0.12.0, plugin.json at 0.12.3; template allowed-tools has four grants; asset count 30 (was 17).
- **agent-fork-sync:** "seven verdicts" (was five branches; decideSync order verified); Files row for agent-fork-review.tsx; gitignore claim fixed (installer block covers runtime state: sessions, channels, claims, metrics); test references fixed.
- **create-skills-architecture:** removed nonexistent docs/ai-tools-create-shared.md row; test references fixed; PANE_SKILLS ends in maestro-help and update-skill-tags (not super-help); "sixth entry" claim replaced with the real seven-module spawner list.
- **docs-view:** aggregator description corrected (merges shipped dirs, first holder wins a slug, title-sorted, tagged group "app"); Files table fixed (globalDocsData/readGlobalDoc, maestroAppDocsDirs() array with MAESTRO_APP_DOCS_DIR override) and missing rows added. Core claims held.
- **global-stores:** added maestro-project-tags.sqlite (project-tags.ts) beside the six stores; skill-lists.ts is a pure reader; "PRIOR_SEEDS is empty today" was wrong (holds pre-036 bodies for 23 ids, infra/reviewer none); "24 keys" -> "24 seeded keys".
- **maestro-config-model:** `gates` is only a leftover key, not a MaestroConfigV3 field; added `metrics?: {recent_runs?}`; runtimeVersion is not the only unasked install write (first-install seeding and seedMissingSkillLists also write); worktree.json added to session state; full config.ts export list plus rows for config-watch.ts, config-watch-context.tsx, config-issue-banner.tsx, external-change-banner.tsx; removed nonexistent MaestroConfigResult, listed the four real call sites; label-rename trap made precise (condition edges keep sourceHandle, matched by from|to|label). Other sub-concepts verified, unchanged.

## Stamps the tool couldn't write
task-queue, installing-maestro, updating-maestro (under .claude/skills): `skills stamp` failed with EROFS (exit 9). The frontmatter was set by Edit to exactly what the tool printed: `version: "2.0"`, `last-update: 5dd6034b3d6ad0c8c3543ac1fa572e0d2f4a486c`. The other five stamped normally.

## Suggested ticket changes
None. Note: the status output has no separate "unextracted" column; nothing is flagged.
