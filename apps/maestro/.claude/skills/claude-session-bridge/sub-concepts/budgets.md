# Budgets and ceilings

`session-budget.ts` decides what a pane session may spend and what it says when it has spent it.
Pure, like the scope modules beside it.

**A ceiling without a door defeats itself.** Reaching a ceiling ends the query, which for a
conversation means the session is over — so a user who loses a transcript to it raises the ceiling
until it never fires again, and the control stops being one. What is built instead is the pair: a low
ceiling (`DEFAULT_CEILING_USD`, $0.50) and a **Continue** that resumes the _same_ conversation with a
fresh allowance. That is the only condition under which a low ceiling does its job. Anything added
here that cannot be continued past is working against the module.

## Three numbers, and they are not the same kind of thing

|                       | What it is                                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxBudgetUsd`        | A **hard stop**, enforced by the CLI against its own estimate. Ends the query mid-flight; the model is not told, it is cut off.                    |
| `taskBudget` (pacing) | A **hint** sent to the API so the model knows its remaining room and can wrap up. For a session that might be mid-write, finishing beats stopping. |
| `maxTurns`            | A **cruder brake** for the loop the other two are bad at — cheap per turn, never converging. Deliberately not derived from the budget.             |

`PACING_TOKENS_PER_USD` converts one to the other and **errs high on purpose**: there is no exchange
rate between dollars and tokens (cache reads dominate a session that mostly reads and cost a tenth of
fresh input), the hard stop is `maxBudgetUsd`, and a pacing budget set too low makes the model wrap
up while there is money left — which reads as a session that gave up for no reason.

## The figure is an estimate

`total_cost_usd` is the CLI's own client-side figure, the same one the ceiling is measured against,
and the work draws on the user's **subscription**. Every string in this module says so: `spendLabel`
carries the `≈` and `spendNote` carries the sentence. A pane that renders it as an accounting figure
is making a promise this app cannot keep.

## Two measured behaviours worth knowing before you touch this

- **`queryTotalUsd` is cumulative for the query, not the cost of the turn.** Measured: four one-word
  turns reported 0.00196, 0.00351, 0.00529, 0.00726 — each result restates the running total. So
  `accrueTurn` takes the **latest** value rather than summing, guarded by `Math.max` against an
  out-of-order result or a resumed query restarting its counter under a figure already displayed.
  The lifetime total is "allowances already spent + the current one", which is exactly what
  `renewAllowance` leaves behind.
- **Some models reject a pacing budget outright.** Measured: with `taskBudget` set and Haiku 4.5
  selected, _every_ turn returns `API Error: 400 This model does not support user-configurable task
budgets` and no work is done. Nothing in `ModelInfo` advertises this, so the only way to know is to
  try. `isPacingUnsupported` detects it and the pane reopens the session without pacing
  (`PACING_UNSUPPORTED_NOTICE` explains it in the transcript). The hard ceiling is unaffected, which
  is why that recovery is safe rather than a quiet widening.

## Only a ceiling may offer Continue

`ceilingOf(subtype)` maps `error_max_budget_usd` → `"budget"` and `error_max_turns` → `"turns"`.
**Everything else — `error_during_execution` included — is a failure**, and must not offer Continue:
a session that broke is not a session that ran out of allowance. `ceilingTurnNote` separately
describes the _turn_ a ceiling cut short, because the ceiling is checked once a turn's cost is known
and the turn it lands on ends where it stood.

`renewAllowance` keeps the lifetime figure and the turn count and resets the allowance — the honest
pair, since the user is re-consenting to another `ceilingUsd` rather than being told the conversation
has spent nothing.

`DEFAULT_EFFORT` is `"medium"`, one notch below the model default, because effort is a larger lever
than model choice for a session that mostly reads. `EFFORT_LEVELS` is `satisfies readonly
SessionEffort[]` so the list and the union in `contracts.ts` fail together rather than drift.

File: `src/core/session-budget.ts`. Test: `test/core/session-budget.test.ts`.
