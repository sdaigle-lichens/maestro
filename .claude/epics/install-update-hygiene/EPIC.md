# Epic: install-update-hygiene

## Goal

Stop maestro-install and maestro-update from silently misreporting a project's managed files and workflows: keep formatters off managed files (161) and report workflow drift from the seed (162).

## Scope

In: the two tickets as written — the formatter-ignore step and staleCustomized hint (161), and the
read-only workflow drift report (162), both surfaced through `maestro-update`.

Out: auto-applying any workflow change (162 is read-only by design), creating formatter ignore files
that don't exist, and the other branch's tasks 158–160 (numbered there; this queue skips to 161 to
avoid a collision).

## Merge plan

| Order | Task | Base | Version bump | Shared surfaces with siblings |
| ----- | ---- | ---- | ------------ | ----------------------------- |
| 1 | 161 formatter ignore | `main` | Worker bumps patch on its branch | `plugins/maestro/scripts/maestro-install.js`, `plugins/maestro/skills/maestro-update/SKILL.md`, `plugins/maestro/.claude-plugin/plugin.json`, `.claude/scripts/` mirrors (via `pnpm refresh:runtime`) |
| 2 | 162 workflow drift | `main` | Worker bumps patch; on rebase after 161 merges, re-bump to the next patch above 161's | same as 161, plus the new `maestro-workflow-drift.cjs` and possibly `maestro-sandbox-allow.cjs` |

Both start in parallel from `main` (no `blockedBy`). 162 merges second: it rebases onto `main` after
161 lands, resolves `plugin.json` by taking the next patch, re-runs `pnpm refresh:runtime` instead of
hand-merging any mirror, and re-runs the parity test and full verify on the rebased commit.

**Revised (user, after 161 committed as `a4595f3`):** one PR for both. 161 is not merged to `main`
alone; 162 lands on `feat/formatter-ignore-managed-files` (rebased onto it, 0.13.29, step 8,
Report step 9), the full suite is re-run on the combined head, then the user opens one PR with
`create-pr`.

## Follow-ups (remind the user)

- [x] (PR #25 merged; report run and shown to the user, applying is theirs) **After the 161+162 PR merges:** remind the user to run
  `node .claude/scripts/maestro-workflow-drift.cjs .` on this repo and apply what it lists with
  `update-workflow` or the app. Expected: `default` and `Tests` differ because this repo's
  `maestro.json` still uses the pre-`27e12e8` test FAIL labels (and may lack the "blocked" path).
  Not a code ticket: the seed is correct; this repo's config is stale. Keeping the old labels is the
  user's option.

## Decisions

- Parallel, not blocked: the two tickets edit different parts of `maestro-install.js` (161: a new
  formatter-ignore step and summary field; 162: one more script in the copy list) and different
  sections of the `maestro-update` skill. The merge order above covers the overlap.
- 162 also touches `apps/maestro/src/core/install.ts` (its install manifest must agree with
  `maestro-install.js`); 161 does not, so no new overlap.
- 162 (m002, escalated, user decided): the drift report compares loaded skills and skill-node ids
  only, not referenced skills, since those are seeded from each project's own tag/skill maps and
  would flag every fresh install. The omission is documented in `references/workflow-drift.md`.
- Final `maestro-update` step order after both merge: 161's formatter step 7, 162's drift step 8,
  Report step 9; versions 0.13.28 (161) then 0.13.29 (162).
