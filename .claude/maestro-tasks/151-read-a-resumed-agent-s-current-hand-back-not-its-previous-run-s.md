# Read a resumed agent's current hand-back, not its previous run's

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

When an agent is resumed, the SubagentStop hook can record the final message of its previous run instead of the current one. A post-mortem of task 150 found this in that worker's session log: the handoffs for a resumed test agent, a resumed reviewer and a resumed backend agent were byte-length copies of their first runs, and a later resumed test run logged the message from the run before it. The reviewer's second run evidently passed (it wrote its payload for scribe and the worker moved on to scribe), yet the hook logged `FAIL: a test` from the first run and then raised a false missing-payload warning for the FAIL route.

Likely cause, from reading the code and the log, not yet reproduced: the hook reads hand-back tool calls from the agent's transcript, and `awaitHandback` stops at the first hand-back call it sees. Claude Code fires SubagentStop before the final hand-back is flushed to the transcript, and a resumed agent's transcript already holds the old call, so the wait ends at once with the old text. Confirm this first.

Desired behaviour: the hook judges only a hand-back made during the current run, and keeps waiting for it while the transcript is behind. The label, the logged output, the handoff check and the payload check all come from that message. A first (not resumed) run behaves as it does today. If no current-run hand-back appears within the wait, the hook reports what it would report for no hand-back, never an older run's message.

This is a code change with tests: the hand-back reading in the app's core source and the hook that calls it, then a rebuild of the generated plugin libs, a patch plugin version bump and the repo's runtime refresh.

Not in scope: a resumed run that only re-verifies a commit and has no payload to write still gets a missing-payload warning on its `success` route (line 260 of that log). That is a separate issue.

## Acceptance criteria

- [ ] The cause is confirmed, or the task reports what the real cause is before changing the behaviour
- [ ] A test covers a resumed agent whose transcript already holds an earlier hand-back: the hook waits for the new hand-back and returns its text
- [ ] A resumed reviewer that passes after an earlier FAIL is logged as passing and raises no missing-payload warning for the FAIL route
- [ ] When a current-run hand-back never appears, no earlier run's message is used
- [ ] A first-run agent's hand-back is handled as before, and the existing hand-back tests still pass
- [ ] The plugin version is bumped and the parity test passes after the runtime refresh

## Touched surfaces

- apps/maestro/src/core/handoff-label.ts
- plugins/maestro/scripts/maestro-subagent-log.js and its .claude/scripts mirror
- plugins/maestro/scripts/lib/*.cjs (generated: rebuild, never hand-edit) and .claude/scripts/lib mirrors
- plugins/maestro/.claude-plugin/plugin.json (version)
- apps/maestro/test/core/runtime-version-and-payload.test.ts
- .claude/skills/maestro-architecture concept docs, if they describe the hand-back read

## Blocked by

None — can start immediately
