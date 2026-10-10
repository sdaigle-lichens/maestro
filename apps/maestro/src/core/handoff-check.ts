// Does a subagent's final message agree with itself? (083)
//
// The HANDOFF contract has two halves that can drift apart: the report's verdict and the terminal
// HANDOFF line. A run that reports FAIL but ends "HANDOFF: success", or ends with no HANDOFF line
// at all, leaves the orchestrator to guess. This is the one pure judgement both the SubagentStop
// hook and the tests use. fs-free.

import { lastHandoffLabel } from "./handoff-label.js";

export type HandoffIssueKind = "missing" | "contradiction";

export interface HandoffIssue {
  kind: HandoffIssueKind;
  /** The report's verdict (normalised), or null when the report carries none. */
  verdict: "SUCCESS" | "FAIL" | null;
  /** The HANDOFF label found, or null. */
  label: string | null;
  /** One sentence addressed to the orchestrator. */
  message: string;
}

// verdict: FAIL, "verdict": "FAIL", Verdict: FAIL. The unfilled template value "SUCCESS | FAIL" is
// not a verdict, hence the negative lookahead for a following pipe.
const VERDICT_RE = /verdict["'*]*\s*[:=]\s*["'*]*\s*(SUCCESS|FAIL(?:URE|ED)?|PASS(?:ED)?)\b(?!\s*\|)/gi;

/** The LAST verdict a message states, normalised to SUCCESS or FAIL, or null. */
export function reportVerdict(msg: unknown): "SUCCESS" | "FAIL" | null {
  if (typeof msg !== "string") return null;
  const all = [...msg.matchAll(VERDICT_RE)];
  if (all.length === 0) return null;
  const v = all[all.length - 1][1].toUpperCase();
  return v.startsWith("FAIL") ? "FAIL" : "SUCCESS";
}

/**
 * The problem with a workflow agent's final message, or null when it is sound. msg is the text the
 * agent produced (or the SendMessage hand-back recovered for it).
 */
export function checkHandoff(msg: unknown): HandoffIssue | null {
  const label = lastHandoffLabel(msg);
  const verdict = reportVerdict(msg);
  if (label === null) {
    return {
      kind: "missing",
      verdict,
      label: null,
      message:
        "The subagent ended with no HANDOFF: line" +
        (verdict ? " (its report verdict is " + verdict + ")" : "") +
        ". Do not default to success: decide the route from its report, or resume it and ask for the matching HANDOFF line.",
    };
  }
  if (verdict === "FAIL" && label.toLowerCase() === "success") {
    return {
      kind: "contradiction",
      verdict,
      label,
      message:
        "The subagent's report verdict is FAIL but it ended HANDOFF: success, which is invalid. Do not continue the success path: " +
        "route to the workflow's matching condition edge for this defect, or resume the agent and ask for a corrected HANDOFF line.",
    };
  }
  return null;
}
