# Report r006: 132-manager-review-protocol-between-worker-and-manager.md

- Task: 132-manager-review-protocol-between-worker-and-manager.md
- Written: 2026-10-28T21:27:14.236Z
- From session: manager-review-132

# Report: 132 manager review protocol between worker and manager

## Outcome

Done; pnpm verify passes. Plugin 0.13.5 (patch). Workflow: default, 2 human-review rounds (1 reviewer loop-back).

- `maestro-epic.cjs review-request --task --file`: records a request (mNNN) with round = earlier requests for the ticket + 1; a re-send of the same open file is not a new round; prints the one SendMessage line and "redirects so far: k of 2". No epic, or an epic with no manager, prints the human-review fallback.
- `maestro-epic.cjs review-verdict --task <on-track|redirect|escalate>` (added beyond the ticket): the only place manager redirects are counted per ticket (never plan.loopbacks); at 2 redirects a redirect is recorded as escalate. Whoever runs it second gets the recorded verdict back.
- `show`/`reports` list open review requests with round and redirect count; `ack` refuses an mNNN and points to review-verdict.
- The review gate also gates a `manager review` stop: it denies AskUserQuestion, and a SendMessage to the epic's manager, until that round's review file exists. Matcher is now `AskUserQuestion|SendMessage`; both installers migrate an existing registration (`updateHookMatchers`).
- Review-file rounds now count passed manager review stops too (a human review after a manager review uses `.review-2.md`).
- Orchestrator template and maestro-manager skill describe the protocol; task 131's interim "treat as human review" text is gone except for escalation/fallback; both carry the approval-scope sentence.
- maestro-architecture and 5 other concept-skill files updated by @scribe.

## Findings

- Accepted, not fixed: the gate runs twice if settings.json already holds both a legacy and a current entry (hand edit only, same verdict); a SendMessage addressed to the manager by ref or session id is not gated (protocol says send by name).
- Manager liveness is checked only in skill text (ListAgents), no script. Worktree review paths and two concurrent review-verdict calls are untested.
- Whether Claude Code honours the gate's deny on SendMessage at runtime is not covered by tests; it needs one live check, like the AskUserQuestion deny from 130.
- `installing-maestro/sub-concepts/manifest.md`'s hook table was already missing the review-gate row before this task.

## Post-mortem notes

- Sandbox blocked agents from refreshing `.claude/scripts/` mirrors, re-rendering the orchestrator and editing `.claude/settings.json`; the user ran them by hand.
- The re-render command given (`maestro-render-orchestrator.cjs`) only rewrites HANDOFFS, not STEPS; `maestro-install.js .` was needed. A second user round-trip.
- Reviewer loop-back on a one-character hint typo; the first assertion on it would not have caught it.

## Suggested ticket changes

- A follow-up for a live check that a PreToolUse deny on SendMessage (and AskUserQuestion) is honoured.
- A follow-up to add the review-gate row to `installing-maestro/sub-concepts/manifest.md`.
- Consider a documented single command for refreshing this repo's mirrors and orchestrator (or let parity's failure message name `maestro-install.js .` for a stale STEPS region).
