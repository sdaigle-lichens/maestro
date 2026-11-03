## Changed

- App core (`apps/maestro/src/core/`): `types.ts`, `contracts.ts`, `workflow-spec.ts`, `success-path.ts`, `handoff-routes.ts` (comments only), `label-layout.ts`.
- Canvas: `renderer/src/components/workflow-canvas.tsx`, new `renderer/src/utils/review-nodes.ts`.
- Plugin: `scripts/maestro-validate-tasks.js`, `templates/maestro/SKILL.md`, regenerated libs (`maestro-session`, `maestro-workflow-spec`, `maestro-seed`, `maestro-team-meeting`, `maestro-rule-move`), `plugin.json` 0.13.2 -> 0.13.3.
- Tests: `test/core/manager-review.test.ts` (5), `test/renderer/review-nodes.test.ts` (5).

## Did

- @backend: `manager_review` node type, `manager_review-N` parsing and round-trip, `manager review` label, layout size, validate-tasks heuristic, template bullet, libs rebuilt, version bump.
- @frontend: third 'Add step' option "Manager Review", violet node style with 'Manager' label (human_review stays amber), `managerStep` rf type, condition '+' prefilled with `manager requested direction change`.

## Deviations from the ticket

- `.claude/` mirrors NOT refreshed (sandbox-denied): `parity.test.ts` and `orchestrator-template-commands.test.ts` fail until the user runs the three `cp` commands and `/maestro-update`.
- `maestro-task-status plan` and success-edge resolution needed no change (already generic).
- The human-review gate hook only gates the `human review` label; `manager review` is not hook-enforced.
- Not run: lint/full suite after the frontend step, visual check of the app.
- workflow-view sub-concept docs still say 'Agent / Skill / Human Review'.
