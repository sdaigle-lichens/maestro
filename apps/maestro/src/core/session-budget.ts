// What a session is allowed to spend, and what it says when it has spent it. Pure — no `fs`, no
// spawn, no SDK, exactly like the four scope modules it sits beside.
//
// A CEILING WITHOUT A DOOR DEFEATS ITSELF, and that is the whole reason this module exists rather
// than a `maxBudgetUsd` constant at the query. Reaching the ceiling ends the query, which on a
// conversation means the session is over — so a user who loses a transcript to it raises the
// ceiling until it never fires again, and the control stops being one. What is built here instead
// is the pair: a low ceiling, and a `Continue` that resumes the SAME conversation with a fresh
// allowance. The transcript survives, the user re-consents to spending, and the ceiling can be set
// genuinely low, which is the only condition under which it does its job.
//
// THREE NUMBERS, AND THEY ARE NOT THE SAME KIND OF THING:
//
//   • `maxBudgetUsd` is a HARD STOP, enforced by the CLI against its own client-side estimate. It
//     ends the query mid-flight — the model is not told, it is cut off.
//   • `taskBudget` is a PACING HINT, sent to the API so the model knows how much room it has left
//     and can wrap up rather than being cut off. For a session that might be mid-write when the
//     limit lands, finishing is a materially better failure mode than stopping.
//   • `maxTurns` is a CRUDER BRAKE for the loop the other two are bad at: one that is cheap per
//     turn and simply does not converge.
//
// AND THE FIGURE IS AN ESTIMATE. `total_cost_usd` is the CLI's own client-side estimate, the same
// one `maxBudgetUsd` is compared against, and it is not an invoice — the work draws on the user's
// subscription quota. Every string in this module is written to say so; `spendLabel` carries the
// `≈` and `spendNote` carries the sentence. A pane that renders it as an accounting figure is
// making a promise this app cannot keep.

import type { SessionEffort, SessionSpend, SpendCeiling } from "./contracts.js";

/** How much a session may spend before it stops and asks. Deliberately low — Continue is the door. */
export const DEFAULT_CEILING_USD = 0.5;

/**
 * The turn ceiling, and it is deliberately not derived from the budget.
 *
 * It catches the failure the budget is worst at: a loop that costs almost nothing per turn and
 * never converges, which can run for a long time under a dollar ceiling. A resumed session starts
 * the CLI's counter again, so this is per allowance rather than per conversation.
 */
export const DEFAULT_MAX_TURNS = 40;

/**
 * Tokens of pacing budget per dollar of ceiling — a COARSE blend, and deliberately generous.
 *
 * There is no exchange rate between dollars and tokens: it depends on the model, on the input/output
 * split, and above all on cache reads, which dominate a Claude Code session that mostly reads and
 * cost a tenth of fresh input. So this converts one to the other only well enough for the model to
 * pace itself, and errs high on purpose: the HARD stop is `maxBudgetUsd`, and a pacing budget set
 * too low makes the model wrap up while there is money left, which reads to the user as a session
 * that gave up for no reason.
 */
export const PACING_TOKENS_PER_USD = 200_000;

/** Bounds on the pacing budget: below the floor the model wraps up immediately, above it paces not at all. */
export const MIN_PACING_TOKENS = 20_000;
export const MAX_PACING_TOKENS = 2_000_000;

/**
 * The effort levels the SDK accepts. Named here so a renderer's word can be checked against them —
 * the list and the `SessionEffort` union in `contracts.ts` are two halves of one fact, and the
 * `satisfies` is what makes them fail together rather than drift apart.
 */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const satisfies readonly SessionEffort[];

/**
 * The pane's default effort, and the reason it is not the model's own default.
 *
 * Effort is a larger lever than model choice for a session that mostly reads — it decides how much
 * thinking each turn buys before any of it reaches a tool — so a pane with a low ceiling starts one
 * notch below the model default and puts the control in the header for the turns that need more.
 */
export const DEFAULT_EFFORT: SessionEffort = "medium";

export function isEffortLevel(value: unknown): value is SessionEffort {
  return typeof value === "string" && (EFFORT_LEVELS as readonly string[]).includes(value);
}

/** The three ceilings, resolved. What `startPaneSession` passes to the query. */
export interface BudgetPolicy {
  /** The hard stop, in USD, compared against the CLI's own estimate. */
  maxBudgetUsd: number;
  /** The turn ceiling for one allowance. */
  maxTurns: number;
  /** The pacing budget handed to the API so the model can wrap up rather than be cut off. */
  pacingTokens: number;
}

/** Tokens of pacing budget for a ceiling, clamped. See `PACING_TOKENS_PER_USD` for the honesty note. */
export function pacingTokens(ceilingUsd: number): number {
  const raw = Math.round(Math.max(0, ceilingUsd) * PACING_TOKENS_PER_USD);
  return Math.min(MAX_PACING_TOKENS, Math.max(MIN_PACING_TOKENS, raw));
}

/**
 * The policy a session runs under. Overrides are clamped rather than trusted: a ceiling of zero or
 * a negative one would make the pane unusable in a way that looks like a broken session.
 */
export function paneBudget(overrides: Partial<Pick<BudgetPolicy, "maxBudgetUsd" | "maxTurns">> = {}): BudgetPolicy {
  const maxBudgetUsd =
    typeof overrides.maxBudgetUsd === "number" && overrides.maxBudgetUsd > 0
      ? overrides.maxBudgetUsd
      : DEFAULT_CEILING_USD;
  const maxTurns =
    typeof overrides.maxTurns === "number" && overrides.maxTurns >= 1
      ? Math.floor(overrides.maxTurns)
      : DEFAULT_MAX_TURNS;
  return { maxBudgetUsd, maxTurns, pacingTokens: pacingTokens(maxBudgetUsd) };
}

export function newSpend(policy: BudgetPolicy): SessionSpend {
  return {
    estimateUsd: 0,
    allowanceUsd: 0,
    ceilingUsd: policy.maxBudgetUsd,
    turns: 0,
    maxTurns: policy.maxTurns,
    allowances: 1,
    ended: null,
  };
}

/** Cents, not fractions of one. Keeps a lifetime total from drifting into float noise on screen. */
function round(usd: number): number {
  return Math.round(usd * 1e6) / 1e6;
}

/**
 * Fold one turn's result into the running figure.
 *
 * `queryTotalUsd` IS CUMULATIVE FOR THE QUERY, not the cost of the turn — measured, because the
 * SDK's own documentation does not say which it is and the two produce very different numbers when
 * summed. Four one-word turns reported 0.00196, 0.00351, 0.00529, 0.00726: each result restates
 * the query's running total. So the allowance figure is the LATEST value rather than a sum, and
 * `Math.max` guards the one shape that would corrupt it — a result arriving out of order, or a
 * resumed query restarting its own counter at zero underneath a figure already displayed.
 *
 * The lifetime figure is the allowances already spent (`estimateUsd - allowanceUsd`, which survives
 * a renewal because that is exactly what `renewAllowance` leaves behind) plus the current one.
 */
export function accrueTurn(spend: SessionSpend, queryTotalUsd: number | null): SessionSpend {
  const carried = round(spend.estimateUsd - spend.allowanceUsd);
  const allowanceUsd = round(Math.max(spend.allowanceUsd, queryTotalUsd ?? 0));
  return { ...spend, allowanceUsd, estimateUsd: round(carried + allowanceUsd), turns: spend.turns + 1 };
}

/** Mark which ceiling ended the session. The figures are left exactly as the last turn reported. */
export function exhaust(spend: SessionSpend, ceiling: SpendCeiling): SessionSpend {
  return { ...spend, ended: ceiling };
}

/**
 * A fresh allowance for the same conversation — what Continue grants.
 *
 * The lifetime figure is kept and the allowance figure is reset, which is the honest pair: the user
 * is re-consenting to another `ceilingUsd`, not being told the conversation has spent nothing. The
 * turn count is kept for the same reason, while the CLI's own per-query counter starts again.
 */
export function renewAllowance(spend: SessionSpend, policy: BudgetPolicy): SessionSpend {
  return {
    ...spend,
    allowanceUsd: 0,
    ceilingUsd: policy.maxBudgetUsd,
    maxTurns: policy.maxTurns,
    allowances: spend.allowances + 1,
    ended: null,
  };
}

/**
 * Which ceiling a result message's subtype reports, if either.
 *
 * `error_max_budget_usd` and `error_max_turns` are the SDK's own words. Everything else — including
 * `error_during_execution` — is a failure rather than a ceiling, and must NOT offer Continue: a
 * session that broke is not a session that ran out of allowance.
 */
export function ceilingOf(subtype: string | null | undefined): SpendCeiling | null {
  if (subtype === "error_max_budget_usd") return "budget";
  if (subtype === "error_max_turns") return "turns";
  return null;
}

/** `$0.50`, `$0.02`, `$0.004` — enough precision to be useful without implying more than there is. */
export function formatUsd(usd: number): string {
  const value = Math.max(0, usd);
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

/** The header's one-line readout. The `≈` is not decoration — see `spendNote`. */
export function spendLabel(spend: SessionSpend): string {
  return `≈ ${formatUsd(spend.allowanceUsd)} of ${formatUsd(spend.ceilingUsd)}`;
}

/**
 * The sentence that keeps the readout honest.
 *
 * The figure is the CLI's client-side estimate with known accuracy limits, and the work draws on a
 * subscription rather than being invoiced. Rendering it without this is how a number that is
 * roughly right becomes a number someone reconciles against a bill.
 */
export function spendNote(spend: SessionSpend): string {
  const lifetime =
    spend.allowances > 1
      ? ` Across ${spend.allowances} allowances this conversation has used ≈ ${formatUsd(spend.estimateUsd)}.`
      : "";
  return (
    `An estimate, not a bill: it is Claude Code's own client-side figure, the same one the ceiling is ` +
    `measured against, and the work draws on your subscription.${lifetime}`
  );
}

/**
 * What the transcript says about the TURN a ceiling cut short, as distinct from the ending itself.
 *
 * Measured: the ceiling is checked when a turn's cost is known, so the turn it lands on ends where
 * it stood — in the run this was written from, immediately after a `Read` whose result never came
 * back. Reporting that as `The turn ended as error_max_budget_usd.` names an SDK enum at a person;
 * reporting it as nothing at all claims a turn finished that did not.
 */
export function ceilingTurnNote(ceiling: SpendCeiling): string {
  return ceiling === "budget"
    ? "This turn stopped part-way through: the session reached its spend ceiling."
    : "This turn stopped part-way through: the session reached its turn ceiling.";
}

/** What the pane says when a ceiling ends the session, and whether it offers the door. */
export interface CeilingEnding {
  /** Written for the person reading the transcript. Names what was spent and what Continue does. */
  text: string;
  canContinue: boolean;
}

export function ceilingEnding(ceiling: SpendCeiling, spend: SessionSpend): CeilingEnding {
  const spent = `≈ ${formatUsd(spend.allowanceUsd)}`;
  const text =
    ceiling === "budget"
      ? `This session stopped at its spend ceiling of ${formatUsd(spend.ceilingUsd)} — it has used ${spent} ` +
        `(an estimate, not a bill). The conversation is intact: Continue resumes it with a fresh ` +
        `${formatUsd(spend.ceilingUsd)} allowance, and nothing is spent until you do.`
      : `This session stopped at its ceiling of ${spend.maxTurns} turn${spend.maxTurns === 1 ? "" : "s"}, which is the brake for a loop that is ` +
        `cheap per turn and not converging. It has used ${spent} (an estimate, not a bill). Continue resumes the ` +
        `same conversation with a fresh allowance — read what it was doing first, in case it was going in circles.`;
  return { text, canContinue: true };
}

/**
 * The API's refusal of a pacing budget, which is a MODEL PROPERTY and not a broken session.
 *
 * MEASURED: with `taskBudget` set and Haiku 4.5 selected, every turn comes back as
 * `API Error: 400 This model does not support user-configurable task budgets.` — an assistant
 * message, a `success` result with `is_error: true` and `terminal_reason: "api_error"`, and no work
 * done. Nothing in `ModelInfo` advertises whether a model accepts one (there is a `supportsEffort`
 * flag and no equivalent), so the only way to know is to be told, and the only way to be told is to
 * try. The pane reopens the session without the pacing budget when it sees this; the HARD ceiling
 * is unaffected, which is why that recovery is safe rather than a quiet widening.
 */
export function isPacingUnsupported(text: string | null | undefined): boolean {
  return typeof text === "string" && /does not support user-configurable task budgets/i.test(text);
}

/** What the transcript says when that recovery fires. It is a notice, not an error. */
export const PACING_UNSUPPORTED_NOTICE =
  "This model does not accept a pacing budget, so the session was reopened without one — the conversation is " +
  "unchanged and the spend ceiling still applies. The model simply is not told how much room it has left, so it " +
  "may be cut off mid-action rather than wrapping up.";
