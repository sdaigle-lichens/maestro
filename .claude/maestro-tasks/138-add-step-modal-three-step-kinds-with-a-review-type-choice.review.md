## Goal
Replace the add-step modal's four cramped buttons (agent, human review, manager review, skill) with three step kinds (Agent, Skill, Review). Review reveals a Human/Manager choice, Human by default. Widen the modal.

## Done
- New `add-step-kind-choice.tsx`: `AddStepKindChoice` component, `DEFAULT_REVIEW_TYPE` (`human_review`), `addStepNodeType(kind, reviewType)`, `AddStepKind` type. Buttons carry `aria-pressed`.
- `workflow-canvas.tsx`: single `addStepType` state replaced by `addStepKind` + `addStepReviewType`; `addStepType` is derived, so `confirmAddStep` is unchanged.
- Modal widened from `w-80` to `w-[28rem]` (`max-w-[90%]`). Opening/resetting resets kind to Agent and review type to Human.
- Typecheck (node + web) and eslint pass on the two changed files.

## Deviations
- No tests yet: the Tests acceptance criterion is open for the @test step, which runs after this review. `pnpm verify` not yet run.

## Decisions
- Kept node creation going through the existing path, so the saved maestro.json shape is unchanged.
- Extracted the choice into its own component so @test can assert the default from static markup via `aria-pressed`.

## Touches
- apps/maestro/src/renderer/src/components/add-step-kind-choice.tsx (new)
- apps/maestro/src/renderer/src/components/workflow-canvas.tsx
- Nothing under plugins/ (no version bump).

## Sibling impact
None expected: `core/` types and the config shape are untouched; only the renderer modal changes.

## Questions
None.
