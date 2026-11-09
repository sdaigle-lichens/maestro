## Goal

Cut the number of test-and-fix rounds in this repo's Backend workflow (task 160 took nine) by making
the test -> backend loop fix a whole defect class per round, and by escalating a repeating class to
@refactor.

## Deviations

- The Backend workflow already had a refactor node and a refactor -> backend edge, so only one edge was
  added (test -> refactor). No node was added.
- The "same defectClass in the previous two backend rounds" comparison is done by @test reading the
  retired payloads under `.claude/channels/<scope>/.consumed/backend/test.*.md`. Nothing in code
  enforces it beyond the instruction in `test.md`.
- There is no test -> refactor handoff file, so that route carries no payload. @test lists the three
  `defectClass` values in its report instead.
- No re-render of the orchestrator was needed: the new edge is a condition edge, so the success-path
  HANDOFFS table is unchanged.

## Decisions

- The backend -> test payload field is named `grammar` (accepted forms, rejected forms, one example of
  each), required when the change classifies free text.
- The test -> backend payload gains `defectClass` and `sameClassProbes`; the backend side is told to
  fix the whole class in one round.
- The edge label reads: "FAIL: same defectClass as the previous two backend rounds of this run;
  refactor reports whether the defects come from the design".

## Touches

- `.claude/maestro.json` (Backend workflow: new test -> refactor edge)
- `.claude/handoffs/test/backend.md`, `.claude/handoffs/backend/test.md`
- `.claude/agents/test.md`
- `.claude/skills/maestro-architecture/sub-concepts/handoff-contract.md` (new section on the loop)
- Nothing under `plugins/`.

## Sibling impact

Every session that runs the Backend workflow in this repo now gets the new handoff fields and the new
edge. Other epics' managers need a note before this merges (the task file asks for it). The plugin's
seeded workflow and handoff defaults are untouched.

## Questions

- Is a comparison done by @test reading retired payload files acceptable, or should it be a recorded
  value the orchestrator checks?
