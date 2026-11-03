# Human review asks with an Approve / Request changes picker

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Change the Maestro orchestrator's `human review` stop so the user answers through a structured prompt instead of free text, which lets session dashboards such as herdr show the session as blocked on the user. The orchestrator still summarises the work first, then asks with AskUserQuestion offering Approve and Request changes, the built-in free-text option carrying the requested corrections. Approve continues the success path as today; Request changes follows the review's condition edge to the agent that produced the work exactly as the current loop-back does. When AskUserQuestion is unavailable or fails, it falls back to asking in plain text. The review stays a hard stop that is never bypassed. This changes the orchestrator skill template and this repository's own rendered orchestrator skill copy, plus a patch bump of the maestro plugin version.

## Acceptance criteria

- [ ] The orchestrator template's human review stop summarises the work, then asks with AskUserQuestion offering Approve and Request changes, with corrections taken from the free-text option
- [ ] Request changes routes through the review's condition edge exactly as the current loop-back rule does; Approve continues the success path
- [ ] When AskUserQuestion is unavailable or fails, the orchestrator asks in plain text instead, and the review is still never bypassed
- [ ] This repository's rendered orchestrator skill matches the updated template
- [ ] The maestro plugin's plugin.json version gets a patch bump

## Blocked by

None — can start immediately
