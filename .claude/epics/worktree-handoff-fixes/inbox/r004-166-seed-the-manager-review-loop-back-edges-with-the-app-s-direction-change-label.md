# Report r004: 166-seed-the-manager-review-loop-back-edges-with-the-app-s-direction-change-label.md

- Task: 166-seed-the-manager-review-loop-back-edges-with-the-app-s-direction-change-label.md
- Written: 2026-11-09T01:19:42.804Z
- From session: worktree-handoff-fixes-166

## Interim report, task 166 (not marked done; @scribe pending, nothing committed)

**Outcome:** The seed's manager-review loop-back edges all use the shared `MANAGER_DIRECTION_CHANGE_LABEL`, now in `apps/maestro/src/core/manager-review-label.ts` (renderer re-exports it). Plugin 0.13.32 to 0.13.33. Manager review: on-track (m003). Reviewer: success.

**Verified:** worktree `task-166` at HEAD ea0a2b0 plus the uncommitted task changes (not a commit). Full suite green: 146 files, 2934 passed, 5 skipped. Parity 44 passed. typecheck, lint and check clean. `pnpm verify` passed on a clean rerun; its first run hit 5s timeouts in three subprocess CLI test files, each green alone (load-related). Drift report: `default` and `tdd` differ from the seed only by the `code-graph:scribe` load.

**Finding: the ticket's assumption is wrong.** The ticket says "Nothing reads the label text at runtime (assumed, unverified)". `plugins/maestro/templates/maestro/SKILL.md:63` tells the orchestrator to follow the "manager requested direction change" edge by name. The old seed labels ("manager requested test/code/<agent> corrections") never matched it, so this task fixes a real mismatch, not only drift. No code matches on the text.

**Suggested ticket changes:**
- Reword the "Nothing reads the label text" sentence to say the orchestrator template already names the direction-change label, so the seed now matches it.
- Add `apps/maestro/tsconfig.web.json` and `apps/maestro/test/isolation.test.ts` (the `RENDERER_SAFE` allowlist) to Touched surfaces. The renderer may only import allowlisted core files.
- Epics 163-165 and siblings: check whether any other seed/config text assumes the old labels. I found none.

**Other:** cosmetic stale comment at `seed.ts` lines 177-182 (opens with "Human-review corrections" above the manager-review line). Merge order: last, after 165; take the next patch above the last merge, not 0.13.33.
