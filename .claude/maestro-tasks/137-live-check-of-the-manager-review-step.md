# Live check of the manager review step

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Run the manager review step once for real in an epic worker session, and record what happened. The workflows in this repo now stop at a manager review instead of a human review, but whether Claude Code honours the review gate's PreToolUse deny on SendMessage and AskUserQuestion has only been covered by unit tests. The work itself is deliberately tiny: add a short 'Live check' section to this repo's maestro-architecture developer skill that records, for the manager review step, what was observed: whether the gate denied a SendMessage to the manager before the round's review file existed, whether the review-request line reached the manager, which verdict came back and how the worker acted on it, and any surprise. To observe the deny, the worker deliberately tries the SendMessage to the manager once before writing the review file, then continues normally. If the manager redirects, the worker follows the redirect edge and re-requests as round 2 with the previous note quoted. Any defect found becomes a finding in the report, not a fix in this task. No plugin change, so no version bump.

## Acceptance criteria

- [ ] The workflow reached a manager review stop and the worker sent the manager the one review-request line, recorded with maestro-epic.cjs review-request
- [ ] A SendMessage to the manager attempted before the review file existed was observed as denied or not denied, and that result is written down
- [ ] The manager's verdict was recorded with review-verdict and the worker acted on it as the orchestrator describes
- [ ] The maestro-architecture developer skill has a short Live check section with the observations
- [ ] The epic report lists any defect found as a finding

## Blocked by

None — can start immediately
