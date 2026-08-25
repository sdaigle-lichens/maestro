# A budget ceiling you can continue past

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

A conversational pane has no natural end, and a measured 25-turn exploration cost $1.43 against a
$1.50 ceiling. Read that as subscription quota, not an invoice — but an always-on pane consumes it
far faster than one-shot runs did, and the surface that replaced the help chat has lost the chat's
natural per-message bound.

Give the session a spend ceiling, and give the ceiling a door.

**The naive version defeats itself.** Reaching the ceiling ends the query — which on a conversation
means the session is over. So the transcript is lost, users raise the ceiling until it never fires,
and it stops being a control at all. Instead: the budget fires, the session ends cleanly, and the
pane says what was spent and offers to continue — resuming the same session with a fresh allowance.
The transcript survives, the user re-consents to spending, and the ceiling can be set genuinely low,
which is the only condition under which it does its job.

Pair the hard ceiling with a budget the **model** is told about, so it paces itself and wraps up
rather than being cut off. For a session that might be mid-write when the limit lands, finishing is
a materially better failure mode than stopping.

Two honesty requirements. The ceiling is compared against a client-side **estimate** with known
accuracy limits, so present it as an approximation rather than an accounting figure. And a turn
limit is worth setting alongside it as a cruder brake on a loop that is cheap per turn but does not
converge.

Some of the plumbing is already there and should not be re-derived: `018`'s `AgentSessionResult`
already carries `costUsd`, `numTurns` and `sessionId` off the SDK's own result message, and `billing`
off its init message. That is the end-of-session figure; what this slice adds is the running one and
the ceiling. `sessionId` is also what **Continue** resumes against, and what `025` lists.

### What `019` already built, and what it deliberately did not

- **`019` passed nothing budget-related at all**, and this slice owns every one of them: no
  `maxBudgetUsd`, no `taskBudget`, no `effort`, no `enableFileCheckpointing`, no `persistSession`.
  `startPaneSession()` in `src/core/agent-sdk.ts` is the single place they go in — extend that
  options object rather than adding a second session builder; it is a sibling of `startAgentSession`
  over the same options and `agent-sdk.ts` is still the only module in the app that imports the SDK.
- **`startPaneSession` simply ends the session when the SDK stream ends.** So the end path exists but
  carries no reason a UI could branch on. "The budget fires, the session ends cleanly, and the pane
  offers Continue" needs the ending to say _why_ — that distinction is new work, and it is the
  difference between a door and a crash.
- **The surfaces to render on already exist.** `SessionInfo` and `session:info` are there to carry
  spend-to-date, `session:event` is the stream to push it on, and the pane header is where `019` put
  the read-scope disclosure — that is where an effort level and a model selector belong. `SessionInfo`
  grew twice and the `SessionEvent` union grew three times. `023`: `SessionInfo` also carries
  `grants: SessionGrant[]`, `SessionEvent` has a `{ kind: "scope" }` member, and the header's scope
  panel lists session grants with a Revoke button each. `022`: `SessionInfo` also carries
  `writes: SessionWrite[]` (with `writable` derived from it), the `scope` event carries both, the same
  panel now holds a `WriteScope` list beside the grants, and `SessionEvent` gained
  `{ kind: "context" }`. `021`: `SessionEvent` gained a third member, `{ kind: "question" }`, resolved
  by the same `{ kind: "permission-resolved" }` event a permission prompt already used
  (`PermissionOutcome` gained `answered`) — nothing was added to `SessionInfo` for it, since a
  question is parked in the registry and rendered from its own `questions` list rather than folded
  into the info object. Extend those; a spend figure and an effort control are two more fields on the
  same info object, not a second header.
- **A zero-cost `result` message is deliberately NOT reported as a turn**, which matters the moment
  spend accrues per turn rather than only at the end. `022` seeds a handoff's context with
  `shouldQuery: false`, and the SDK answers that append with its own `result` message carrying
  `total_cost_usd: 0` and no assistant text; `startPaneSession` counts outstanding user turns and
  drops a result answering none of them, because reporting it claimed something had run and cleared
  the renderer's `busy` mid-turn. A running spend figure has to be fed from the same place, or it
  will count an append that cost nothing as a turn that did.
- **`interrupt()`'s receipt is no longer discarded — `020` picked it up, and this slice does not own
  it.** `stop()` in `src/core/agent-sdk.ts` returns `{ stillQueued }` off the `query.interrupt()`
  receipt, and `stopSession` in `src/main/claude-session.ts` emits a `notice` when the interrupt left
  messages queued. `SESSION-PANE-PLAN.md`'s verification item 12 is **delivered**. Nothing to build
  here; the reason it is still written down is that the budget path ends a session for a reason of its
  own, and `stop()`'s receipt is the shape to follow rather than a second one to invent.

Surface spend as it accrues rather than only at the end, and put an effort level and a model
selector in the header — both can change on a live session without losing the conversation, and
effort is a larger lever than model choice for a session that mostly reads.

### What this slice built, and where the plan above was wrong

**Delivered.** The policy and every user-facing sentence about it live in one new pure module,
`src/core/session-budget.ts` — a fifth module beside the four scope ones, no `fs`, no spawn, no SDK.
It exports the three ceilings (`DEFAULT_CEILING_USD` `0.5`, `DEFAULT_MAX_TURNS` `40`,
`PACING_TOKENS_PER_USD`), the arithmetic (`paneBudget`, `newSpend`, `accrueTurn`, `exhaust`,
`renewAllowance`, `ceilingOf`), the wording (`formatUsd`, `spendLabel`, `spendNote`,
`ceilingTurnNote`, `ceilingEnding`, `PACING_UNSUPPORTED_NOTICE`) and the effort vocabulary
(`EFFORT_LEVELS`, `DEFAULT_EFFORT`, `isEffortLevel`, `isPacingUnsupported`). `startPaneSession` was
extended as the page asked — `maxBudgetUsd`, `maxTurns`, `taskBudget`, `effort`, `persistSession:
true`, `resume`, `enableFileCheckpointing: true` — and `agent-sdk.ts` is still the only SDK importer.
`contracts.ts` was extended in place, never forked: `SpendCeiling`, `SessionEndReason`
(`closed | budget | turns | error`), `SessionEffort`, `SessionModel`, `SessionSpend`; `SessionEvent`
gained `spend` and `settings` and an `ended` that carries a reason; `SessionInfo` gained `spend`,
`endReason`, `canContinue`, `effort`, `model`, `models`. Three channels are new — `session:continue`
(the session id and nothing else), `session:effort`, `session:model`. Tests:
`test/core/session-budget.test.ts` (15) plus two blocks in `test/isolation.test.ts` — _"stops a
session at a spend ceiling and gives the ending a door"_ and _"changes effort and model on a live
session, from lists main published"_. 477 passing, both typechecks clean, packaged build green.

Seven things were measured rather than reasoned about, and five of them contradict the page above.

- **Reaching the ceiling does NOT end the query in streaming-input mode, which is what the pane is,
  and this is the single most important fact for anyone who touches the read loop next.** After the
  `error_max_budget_usd` result the pump is still open, so the CLI takes the next turn and answers it
  with another error result — measured at 12 further turns inside 1.6 seconds, none of which reached
  the model, while the pane still looked alive and the composer stayed enabled. So the read loop
  **leaves** on a ceiling (`break`, then `finish`, then `query.close()`) rather than waiting for a
  stream end that never comes. A latch alone — which the first implementation had, and which the
  one-shot case genuinely needs, since there the SDK throws instead of yielding — makes the ceiling
  decoration. `ceilingHit` is therefore both: read at the `break` and again in the `catch`.
- **`maxTurns` counts AGENT turns inside one request, not user messages.** Twelve one-word user turns
  under `maxTurns: 1` never trip it; the turn ceiling only fires on a request that cannot finish
  without going round again — one needing two tool calls, say. Anyone planning a turn-ceiling test
  needs this or they will conclude the option is broken.
- **`total_cost_usd` is CUMULATIVE for the query, not the price of a turn.** Four one-word turns
  reported 0.00196, 0.00351, 0.00529, 0.00726 — each restating the running total. `accrueTurn` takes
  the latest with `Math.max`; summing it treble-counts.
- **A pane turn is not a cheap turn, so the default ceiling is tens of turns rather than hundreds.**
  The first turn of a pane session costs roughly $0.01–$0.10 depending on cache state — the whole
  tool set, the plugin's skills and the preset system prompt are uncached — and subsequent one-word
  turns run ≈ $0.006.
- **Haiku 4.5 refuses `taskBudget` outright, and nothing advertises that it will.** Every turn comes
  back `API Error: 400 This model does not support user-configurable task budgets`, with no work
  done; `ModelInfo` has a `supportsEffort` flag and no equivalent for budgets, so the only way to
  know is to try. Hence `isPacingUnsupported`, the `onPacingRejected` callback, and
  `reopenWithoutPacing`, which resumes the same conversation with the pacing budget **omitted** (not
  zeroed) and posts `PACING_UNSUPPORTED_NOTICE`. The hard ceiling is unaffected, which is what makes
  that recovery safe rather than a quiet widening.
- **One `openSession` builder in `src/main/claude-session.ts` serves start, continue and the pacing
  reopen**, differing only in a `CarriedSession` — resume id, spend, grants, writes, effort, model,
  pacing — every field of which is main's own record and none of which a renderer can supply. And the
  exhausted `LiveSession` entry is **kept, but only for a ceiling**: that entry holds the id
  `session:continue` resumes against, the figures to show and the scope the conversation already had.
  Every other ending deletes it, and all three teardown paths are unchanged.
- **The ceiling is demonstrable for cents.** `sessionBudget()` reads `MAESTRO_SESSION_CEILING_USD` and
  `MAESTRO_SESSION_MAX_TURNS` from the launching process's environment **only** — the
  `MAESTRO_AGENT_SDK_SMOKE` precedent — because proving the CLI actually stops at $0.50 costs $0.50 of
  somebody's subscription every time, which is the kind of check people run once and then stop
  running. Nothing on any channel reaches it and `paneBudget` clamps nonsense back to the default.
- **The renderer formats dollars locally rather than importing the module**, because the renderer may
  import only `contracts` and `text` from `src/core`. Two copies of `formatUsd`-shaped code is the
  cost of that rule and is paid deliberately.
- **`interrupt()`'s `still_queued` receipt, listed on this page, had already been done by `020`.**
  `024` did not own it and did not touch it.

## Acceptance criteria

- [x] A session has a spend ceiling, set low by default, and spend-to-date is visible while it runs — `DEFAULT_CEILING_USD` is $0.50, and the header carries `≈ $x / $y` with a bar (`data-testid="session-spend"`) fed by the `{ kind: "spend" }` event
- [x] Reaching the ceiling ends the session cleanly rather than erroring or hanging — and **not** by the mechanism this page assumed: the read loop `break`s on the ceiling result, because a streaming-input query does not tear itself down
- [x] Continue resumes the same conversation with a fresh allowance, transcript intact — `session:continue` carries the session id and nothing else; `renewAllowance` zeroes the allowance and keeps the lifetime figure, and grants, writes, effort and model carry over
- [x] The model is given a budget it can pace against, and wraps up rather than being cut off mid-action — `taskBudget: { total: pacingTokens(ceiling) }`, with the measured caveat that some models refuse one and are reopened without it
- [x] A turn ceiling stops a cheap non-converging loop — `maxTurns: 40` per allowance; note it counts **agent** turns inside a request, not user messages
- [x] Spend is presented as an estimate, not as a bill — the `≈`, the word "estimate" and the subscription sentence are in the pure module and in the markup's own title text
- [x] Effort level and model can be changed mid-session without losing the transcript — `session:effort` / `session:model` over `setEffort` / `setModel`; the selectors offer only what the CLI's own `supportedModels()` published
- [x] A runaway session is stopped by the ceiling — demonstrated, not assumed — driven in a real window at a two-cent ceiling, which is what `MAESTRO_SESSION_CEILING_USD` exists for

## Blocked by

- `019-a-live-session-in-the-pane.md`
