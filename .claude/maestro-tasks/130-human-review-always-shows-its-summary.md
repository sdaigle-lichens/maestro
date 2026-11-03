# Human review always shows its summary

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

At a human review step the orchestrator sometimes asks for approval without showing the changes, or shows them but the question dialog hides them. Make the summary structural. At each human review round the orchestrator writes a review file next to the task file (e.g. `<task>.review.md`, one per round) with a fixed format: Changed (files and areas), Did (one line per agent), Deviations from the ticket, Corrections since the last round (re-reviews only). It prints the full summary as text above the question, then asks with AskUserQuestion as today (AskUserQuestion stays: it gives herdr its 'input needed' state). The Approve option's preview carries a digest capped at about 15 lines: deviations, risks and open questions, the changed-file count, corrections since last round, and as its last line the review file's path. A new PreToolUse hook on AskUserQuestion blocks the question while the session's current step is a human review and that round's review file does not exist, telling the agent to write it first. This touches the orchestrator template's instructions, a new hook script and its registration in the plugin and the project-local install path, the generated plugin libs if the hook logic lives in a plugin-entries source, the tracked .claude/scripts mirrors, tests, and a plugin version bump.

## Acceptance criteria

- [ ] The orchestrator template tells the agent to write the per-round review file in the fixed format, print the full summary, and put the capped digest ending with the file path in the Approve option's preview
- [ ] A PreToolUse hook on AskUserQuestion denies the call when the current step is a human review and that round's review file is missing, and allows it otherwise (including every AskUserQuestion outside a human review)
- [ ] The hook is registered both by the plugin and by the project-local install, and the parity test passes
- [ ] Tests cover the hook's allow and deny cases
- [ ] The maestro plugin's version is bumped (minor: new hook event surface) and pnpm verify passes

## Blocked by

None — can start immediately
