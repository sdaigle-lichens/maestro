# Manager review brief: task 165

## Goal
(1) to-maestro-tasks asks where any number or derived value shown in a UI comes from, and the written task states it. (2) The post-mortem digest lists every recorded outcome kind, not only success.

## Deviations
- Task 160's interim-stop signal is not merged in this tree. The digest's `isInterim()` guesses `interim: true` or `status: "interim"`. It needs a one-function adjustment after rebasing onto 160.
- `pnpm verify` / `pnpm lint` not yet run; the test and reviewer steps own that.

## Decisions
- No new template field in maestro-write-tasks.cjs; the source goes into `whatToBuild`. A "later task" source goes into `blockedBy`, or the task states what the UI shows until it lands.
- Digest tallies by returned label (success, fail, blocked, other conditions), with "missing HANDOFF" for a final stop with no parseable label and "no-return" for an agent that never stopped. "interim" is counted apart. Success is listed last, and a "Problems (non-success outcomes)" section precedes the timeline.
- No `.claude/scripts` mirror exists for maestro-post-mortem.js, so no `pnpm refresh:runtime` is needed.

## Touches
- plugins/maestro/skills/to-maestro-tasks/SKILL.md (step 4 bullet)
- plugins/maestro/scripts/maestro-post-mortem.js
- plugins/maestro/.claude-plugin/plugin.json (0.13.32 -> 0.13.33)
- apps/maestro/test/core/post-mortem-outcomes.test.ts (new)

## Sibling impact
- Task 160: supplies the real interim-stop field; merge order puts 165 after it.
- Task 157 edits the same SKILL.md after this epic.
- Renderer does not consume the digest JSON (the frontend step checked), so the new `problems` array and `interim` flag affect nothing there.

## Questions
- None.
