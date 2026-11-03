// Does a subagent's final message agree with itself? (083)
//
// The HANDOFF contract has two halves that can drift apart: the report's verdict and the terminal
// HANDOFF line. A run that reports FAIL but ends "HANDOFF: success", or ends with no HANDOFF line
// at all, leaves the orchestrator to guess. This is the one pure judgement both the SubagentStop
// hook and the tests use. fs-free.

import { lastHandoffLabel } from "./handoff-label.js";

export type HandoffIssueKind = "missing" | "contradiction" | "missing_payload" | "unrouted";

export interface HandoffIssue {
  kind: HandoffIssueKind;
  /** The report's verdict (normalised), or null when the report carries none. */
  verdict: "SUCCESS" | "FAIL" | null;
  /** The HANDOFF label found, or null. */
  label: string | null;
  /** One sentence addressed to the orchestrator. */
  message: string;
  /** `missing_payload` only: the receivers whose payload was not written. */
  receivers?: string[];
  /** `missing_payload` only: the project-relative channel files that were not written. */
  files?: string[];
}

/** The slice of a `PayloadRoute` (handoff-payload.ts) this judgement needs. */
export interface PayloadRouteRef {
  label: string;
  receiver: string;
  channelFile: string;
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

/**
 * A condition label the active workflow has no edge for (`108`). A docs-only run whose scribe
 * stopped at `HANDOFF: partial` had nowhere to go, nothing flagged it, and the orchestrator
 * improvised an off-workflow dispatch. Null for `success` (the last node of a path has no success
 * edge either), for a missing line (`checkHandoff`'s job), or when a route with that label exists.
 * `routes` must be the sender's routes in the ACTIVE workflow only — the caller skips this check
 * when the workflow fell back to a guess, where an absent edge proves nothing.
 */
export function checkRoute(msg: unknown, routes: { label: string }[], workflow: string): HandoffIssue | null {
  const label = lastHandoffLabel(msg);
  if (label === null || label.toLowerCase() === "success") return null;
  const want = label.toLowerCase();
  if (routes.some((r) => r.label.toLowerCase() === want)) return null;
  const known = routes.filter((r) => r.label.toLowerCase() !== "success").map((r) => r.label);
  return {
    kind: "unrouted",
    verdict: reportVerdict(msg),
    label,
    message:
      "The subagent ended HANDOFF: " +
      label +
      ', which no condition edge in workflow "' +
      workflow +
      '" handles (its conditions: ' +
      (known.length ? known.join(", ") : "none") +
      "). Stop: tell the user what the agent could not do and let them choose (switch workflow, dispatch an agent outside it, or stop). " +
      "Do not dispatch another agent on your own.",
  };
}

/**
 * The third issue (`087`): the HANDOFF label the agent took names a route whose receiver expects a
 * payload, and the sender wrote no channel file for it during this run. Null when the message has
 * no HANDOFF line (that is `checkHandoff`'s `missing`), when no route with that label expects a
 * payload, or when every such payload was written. `written` is the caller's filesystem probe.
 */
export function checkPayload<R extends PayloadRouteRef>(
  msg: unknown,
  routes: R[],
  written: (route: R) => boolean
): HandoffIssue | null {
  const label = lastHandoffLabel(msg);
  if (label === null) return null;
  const want = label.toLowerCase();
  const unwritten = routes.filter((r) => r.label.toLowerCase() === want && !written(r));
  if (unwritten.length === 0) return null;
  const receivers = unwritten.map((r) => r.receiver);
  const files = unwritten.map((r) => r.channelFile);
  return {
    kind: "missing_payload",
    verdict: reportVerdict(msg),
    label,
    receivers,
    files,
    message:
      "The subagent ended HANDOFF: " +
      label +
      " but wrote no payload to " +
      files.join(", ") +
      " during this run. Do not dispatch " +
      receivers.join(", ") +
      " without it, and do not skip it: resume this agent (SendMessage to its agent_id) and ask it to write that file, then route.",
  };
}
