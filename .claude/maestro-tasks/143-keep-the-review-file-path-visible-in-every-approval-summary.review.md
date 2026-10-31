Review file: .claude/maestro-tasks/143-keep-the-review-file-path-visible-in-every-approval-summary.review.md

## Changed

- `apps/maestro/src/core/human-review-gate.ts`: new exported `SUMMARY_PLACEMENT`, used by both denial messages (human review, and the manager-review fallback and escalate path).
- `plugins/maestro/templates/maestro/SKILL.md`: human-review text puts the path first, and says a shortened digest ends with a line pointing to the review file. The manager fallback and escalate bullets point at the human-review text.
- `plugins/maestro/scripts/lib/maestro-session.cjs`: regenerated with `pnpm --filter maestro build:plugin-libs`.
- `plugins/maestro/.claude-plugin/plugin.json`: version 0.13.9 to 0.13.10.
- `.claude/skills/maestro-architecture/sub-concepts/handoff-contract.md` and `.claude/epics/manager-review/EPIC.md`: wording updated.
- `apps/maestro/test/core/human-review-gate.test.ts`: one new test for the gate wording (human and manager review).
- Not yet updated (the sandbox blocked `pnpm refresh:runtime`): `.claude/skills/maestro/SKILL.md` and `.claude/scripts/lib/maestro-session.cjs` still carry the old wording.

## Did

- @backend: made the wording change in the gate source, template and concept text, added the test, rebuilt the libs, bumped the version. `human-review-gate.test.ts` passes 12 of 12. lint, check and typecheck passed.

## Deviations from the ticket

- `pnpm refresh:runtime` failed with EPERM on `.claude/skills/maestro/SKILL.md`, so the rendered orchestrator and the `.claude/scripts` mirror are stale. The user must run `! pnpm refresh:runtime`.
- Parity test: 3 of 44 fail, all stale mirrors. `pnpm verify` fails at the test stage for the same reason, but its output was truncated, so other failures can't be ruled out yet.
- The repo-wide old-wording search still has to be re-run after the refresh. The only hits so far are the two stale mirrors.
- Also edited `.claude/epics/manager-review/EPIC.md`, which the ticket didn't name.
