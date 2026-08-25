// The spend ceiling and the door out of it (`024`).
//
// Everything here is arithmetic and wording, which is exactly why it is a pure module: the parts of
// this slice that cannot be unit-tested — that the CLI actually stops at `maxBudgetUsd`, that the
// SDK throws behind the result, that a resumed session still has its transcript — were measured in
// a real window and are pinned by `test/isolation.test.ts` and written down in CLAUDE.md.

import { describe, it, expect } from "vitest";
import {
  accrueTurn,
  ceilingEnding,
  ceilingTurnNote,
  ceilingOf,
  exhaust,
  formatUsd,
  isEffortLevel,
  isPacingUnsupported,
  newSpend,
  pacingTokens,
  paneBudget,
  renewAllowance,
  spendLabel,
  spendNote,
  DEFAULT_CEILING_USD,
  DEFAULT_MAX_TURNS,
  EFFORT_LEVELS,
  MAX_PACING_TOKENS,
  MIN_PACING_TOKENS,
} from "../../src/core/session-budget.js";

describe("the policy", () => {
  it("defaults low, because the door is what makes a low ceiling usable", () => {
    const policy = paneBudget();
    expect(policy.maxBudgetUsd).toBe(DEFAULT_CEILING_USD);
    expect(policy.maxTurns).toBe(DEFAULT_MAX_TURNS);
    // A measured 25-turn exploration cost $1.43. The default has to be a fraction of that or it is
    // not a ceiling, it is a formality.
    expect(policy.maxBudgetUsd).toBeLessThan(1.43);
  });

  it("clamps an override rather than trusting it", () => {
    // Zero or negative is not "no budget", it is a pane where the first turn dies — which reads as
    // a broken session rather than as a setting.
    expect(paneBudget({ maxBudgetUsd: 0 }).maxBudgetUsd).toBe(DEFAULT_CEILING_USD);
    expect(paneBudget({ maxBudgetUsd: -5 }).maxBudgetUsd).toBe(DEFAULT_CEILING_USD);
    expect(paneBudget({ maxTurns: 0 }).maxTurns).toBe(DEFAULT_MAX_TURNS);
    expect(paneBudget({ maxBudgetUsd: 0.02, maxTurns: 3 })).toMatchObject({ maxBudgetUsd: 0.02, maxTurns: 3 });
  });

  it("bounds the pacing budget at both ends", () => {
    // Too low and the model wraps up immediately with money left; too high and it paces not at all.
    expect(pacingTokens(0.000001)).toBe(MIN_PACING_TOKENS);
    expect(pacingTokens(1000)).toBe(MAX_PACING_TOKENS);
    expect(pacingTokens(1)).toBeGreaterThan(MIN_PACING_TOKENS);
  });

  it("keeps the effort list and the wire type in step", () => {
    expect([...EFFORT_LEVELS]).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(isEffortLevel("xhigh")).toBe(true);
    // The check exists so a renderer cannot put an arbitrary string into the CLI's flag layer.
    expect(isEffortLevel("ultra")).toBe(false);
    expect(isEffortLevel(null)).toBe(false);
  });
});

describe("the running figure", () => {
  it("reads the query total as CUMULATIVE, which is what it measured as", () => {
    // Four one-word turns reported 0.00196, 0.00351, 0.00529, 0.00726 — each result restates the
    // query's running total rather than pricing its own turn. Summing them would treble the figure
    // on screen, and the ceiling would appear to fire early for no reason anyone could see.
    let spend = newSpend(paneBudget());
    for (const total of [0.00196, 0.00351, 0.00529, 0.00726]) spend = accrueTurn(spend, total);
    expect(spend.allowanceUsd).toBeCloseTo(0.00726, 6);
    expect(spend.estimateUsd).toBeCloseTo(0.00726, 6);
    expect(spend.turns).toBe(4);
  });

  it("never lets the figure go backwards", () => {
    let spend = accrueTurn(newSpend(paneBudget()), 0.05);
    spend = accrueTurn(spend, 0.01);
    expect(spend.allowanceUsd).toBe(0.05);
    expect(spend.turns).toBe(2);
  });

  it("counts a turn whose cost is unknown, and spends nothing for it", () => {
    const spend = accrueTurn(newSpend(paneBudget()), null);
    expect(spend.turns).toBe(1);
    expect(spend.allowanceUsd).toBe(0);
  });
});

describe("the door", () => {
  it("renews the allowance and keeps the total", () => {
    // The honest pair. Zeroing both would tell the user the conversation had cost nothing; zeroing
    // neither would leave them one ceiling away from never being able to continue again.
    let spend = accrueTurn(newSpend(paneBudget()), 0.5);
    spend = exhaust(spend, "budget");
    expect(spend.ended).toBe("budget");

    const next = renewAllowance(spend, paneBudget());
    expect(next.allowanceUsd).toBe(0);
    expect(next.estimateUsd).toBeCloseTo(0.5, 6);
    expect(next.allowances).toBe(2);
    expect(next.turns).toBe(1);
    expect(next.ended).toBeNull();
  });

  it("keeps the lifetime figure accruing across allowances", () => {
    let spend = accrueTurn(newSpend(paneBudget()), 0.5);
    spend = renewAllowance(exhaust(spend, "budget"), paneBudget());
    spend = accrueTurn(spend, 0.2);
    expect(spend.allowanceUsd).toBeCloseTo(0.2, 6);
    expect(spend.estimateUsd).toBeCloseTo(0.7, 6);
    expect(spend.turns).toBe(2);
  });

  it("opens for a ceiling and for nothing else", () => {
    // `error_during_execution` is a session that BROKE. Offering to continue it would promise a
    // transcript that may not be there, and would tell the user a failure was a budget decision.
    expect(ceilingOf("error_max_budget_usd")).toBe("budget");
    expect(ceilingOf("error_max_turns")).toBe("turns");
    expect(ceilingOf("error_during_execution")).toBeNull();
    expect(ceilingOf("success")).toBeNull();
    expect(ceilingOf(null)).toBeNull();
  });

  it("says what was spent and what continuing does, for either ceiling", () => {
    const spend = accrueTurn(newSpend(paneBudget()), 0.5);
    const budget = ceilingEnding("budget", spend);
    expect(budget.canContinue).toBe(true);
    expect(budget.text).toContain("$0.50");
    expect(budget.text).toMatch(/estimate, not a bill/);
    expect(budget.text).toMatch(/Continue resumes/);

    const turns = ceilingEnding("turns", spend);
    // The turn ceiling means something different — a loop that is not converging — and says so
    // rather than reusing the money sentence.
    expect(turns.text).toContain(`${spend.maxTurns} turns`);
    expect(turns.text).toMatch(/circles/);
  });

  it("says the turn the ceiling landed on stopped part-way, without naming an SDK enum", () => {
    // The ceiling is checked once a turn's cost is known, so the turn it lands on ends where it
    // stood — measured in a window, immediately after a `Read` whose result never came back. The
    // transcript entry for that turn has to say so: `The turn ended as error_max_budget_usd.` is an
    // internal name pointed at a person, and saying nothing claims a turn finished that did not.
    for (const ceiling of ["budget", "turns"] as const) {
      expect(ceilingTurnNote(ceiling)).toMatch(/stopped part-way/);
      expect(ceilingTurnNote(ceiling)).not.toMatch(/error_max/);
    }
    expect(ceilingTurnNote("budget")).toMatch(/spend ceiling/);
    expect(ceilingTurnNote("turns")).toMatch(/turn ceiling/);
  });
});

describe("the honesty requirements", () => {
  it("renders a figure as an approximation, never as an accounting number", () => {
    const spend = accrueTurn(newSpend(paneBudget()), 0.0123);
    expect(spendLabel(spend)).toBe("≈ $0.01 of $0.50");
    expect(spendNote(spend)).toMatch(/estimate, not a bill/);
    expect(spendNote(spend)).toMatch(/subscription/);
    // Below a cent, two decimals would render every early turn as $0.00 — which reads as free.
    expect(formatUsd(0.0004)).toBe("$0.0004");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(1.239)).toBe("$1.24");
  });

  it("mentions the allowances once there has been more than one", () => {
    const one = accrueTurn(newSpend(paneBudget()), 0.5);
    expect(spendNote(one)).not.toMatch(/allowances/);
    const two = accrueTurn(renewAllowance(one, paneBudget()), 0.1);
    expect(spendNote(two)).toMatch(/2 allowances/);
    expect(spendNote(two)).toMatch(/\$0\.60/);
  });
});

describe("a model that will not take a pacing budget", () => {
  it("is recognised from what the API actually says", () => {
    // MEASURED: Haiku 4.5 answers every turn with this while `taskBudget` is set, and does no work
    // at all. Nothing in the model list advertises it, so being told is the only way to know.
    expect(isPacingUnsupported("API Error: 400 This model does not support user-configurable task budgets.")).toBe(
      true
    );
    expect(isPacingUnsupported("API Error: 400 something else entirely")).toBe(false);
    expect(isPacingUnsupported(null)).toBe(false);
  });
});
