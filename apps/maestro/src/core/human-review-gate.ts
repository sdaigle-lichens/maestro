// The review summary gate (`130`, extended to manager review by `132`).
//
// At a `human review` step the orchestrator must show the user what changed. Prose alone was
// skipped or hidden behind the question dialog, so the summary is made structural: each round the
// orchestrator writes a review file next to the task file, and a PreToolUse hook
// (`plugins/maestro/scripts/maestro-human-review-gate.js`) refuses AskUserQuestion while the
// session's current step is a review stop and that round's file does not exist.
//
// `132`: a `manager review` stop is gated the same way. There the review file is the direction brief
// the epic's manager reads, so the hook also refuses a SendMessage addressed to that manager (the
// review request) until the file exists, and AskUserQuestion too (the escalation and fallback cases
// ask the user inline at the same stop).
//
// "Current step" is the first unfinished step of the plan recorded in the session's session.json
// (`maestro-task-status.cjs plan` / `plan-step`). A session with no plan, no `active_task`, or a
// current step that is not a review stop is never gated: the hook only ever narrows, and fails
// open on anything it cannot read.
//
// Imports nothing: the file-existence probe and the manager's name are passed in, so this rides the
// `maestro-session` bundle (which must stay free of `node:sqlite`) without touching its generated
// import names.

export const HUMAN_REVIEW_LABEL = "human review";
export const MANAGER_REVIEW_LABEL = "manager review";

/** `<task>.review.md` for round 1, `<task>.review-<n>.md` from round 2. */
export const REVIEW_FILE_PATTERN = /\.review(-\d+)?\.md$/;

export interface PlanStepLike {
  label?: unknown;
  status?: unknown;
}

export interface PlanLike {
  steps?: unknown;
  /** Loop-backs recorded by `plan-step <label> pending`; each one starts a new review round. */
  loopbacks?: unknown;
}

export type HumanReviewVerdict = { allow: true } | { allow: false; reason: string };

export type ReviewStopLabel = typeof HUMAN_REVIEW_LABEL | typeof MANAGER_REVIEW_LABEL;

function isReviewStop(label: unknown): label is ReviewStopLabel {
  return label === HUMAN_REVIEW_LABEL || label === MANAGER_REVIEW_LABEL;
}

/** Is this a review file rather than a task file? Task listings must skip these. */
export function isReviewFile(filename: string): boolean {
  return REVIEW_FILE_PATTERN.test(filename);
}

/** The review file name for a task file and a 1-based round. */
export function reviewFileName(taskFile: string, round: number): string {
  const base = taskFile.replace(/^.*[\\/]/, "").replace(/\.md$/, "");
  return round <= 1 ? `${base}.review.md` : `${base}.review-${round}.md`;
}

/**
 * The review stop the session is at and its round, or null when its current step is not a review
 * stop. Round = 1 + loop-backs recorded + review stops (human or manager) already passed, so a
 * second review stop in one plan and a re-review after corrections each get their own file.
 */
export function currentReviewStop(plan: PlanLike | null | undefined): { label: ReviewStopLabel; round: number } | null {
  if (!plan || !Array.isArray(plan.steps)) return null;
  const steps = plan.steps as PlanStepLike[];
  const next = steps.findIndex((s) => s && s.status !== "done");
  if (next === -1) return null;
  const label = steps[next].label;
  if (!isReviewStop(label)) return null;
  const doneReviews = steps.filter((s) => s && isReviewStop(s.label) && s.status === "done").length;
  const loopbacks = typeof plan.loopbacks === "number" && plan.loopbacks > 0 ? Math.floor(plan.loopbacks) : 0;
  return { label, round: 1 + loopbacks + doneReviews };
}

/** The round of the review stop the session is at (human or manager), or null when it is at none. */
export function currentReviewRound(plan: PlanLike | null | undefined): number | null {
  return currentReviewStop(plan)?.round ?? null;
}

/** `worker [3fa9c1]` → `worker`: SendMessage may address a session by name plus its listing ref. */
function bareRecipient(to: unknown): string {
  return typeof to === "string" ? to.replace(/\s*\[[^\]]*\]\s*$/, "").trim() : "";
}

const HUMAN_SECTIONS =
  "'## Changed' (files and areas), '## Did' (one line per agent), '## Deviations from the ticket' and, " +
  "on a re-review, '## Corrections since the last round'";

const BRIEF_SECTIONS =
  "'## Goal', '## Done', '## Deviations', '## Decisions', '## Touches' (files and modules by name, never a diff), " +
  "'## Sibling impact' and '## Questions'";

/**
 * Judge one tool call. `state` is the session's parsed session.json; `tasksDir` the project's
 * `.claude/maestro-tasks`; `exists` probes a file. AskUserQuestion is in scope at either review
 * stop; SendMessage only at a manager review, and only when it is addressed to `managerName` (the
 * active task's epic manager, resolved by the caller; null or absent leaves SendMessage ungated).
 */
export function checkHumanReview(input: {
  tasksDir: string;
  toolName: string | null | undefined;
  toolInput?: { to?: unknown } | null;
  managerName?: string | null;
  state: { plan?: PlanLike; active_task?: unknown } | null | undefined;
  exists: (file: string) => boolean;
}): HumanReviewVerdict {
  if (input.toolName !== "AskUserQuestion" && input.toolName !== "SendMessage") return { allow: true };
  const state = input.state;
  if (!state || typeof state.active_task !== "string" || !state.active_task) return { allow: true };
  const stop = currentReviewStop(state.plan);
  if (stop === null) return { allow: true };
  if (input.toolName === "SendMessage") {
    if (stop.label !== MANAGER_REVIEW_LABEL) return { allow: true };
    const manager = typeof input.managerName === "string" ? input.managerName.trim() : "";
    if (!manager || bareRecipient(input.toolInput?.to) !== manager) return { allow: true };
  }

  const { round } = stop;
  const name = reviewFileName(state.active_task, round);
  const file = `${input.tasksDir.replace(/[\\/]+$/, "")}/${name}`;
  if (input.exists(file)) return { allow: true };

  if (stop.label === MANAGER_REVIEW_LABEL) {
    return {
      allow: false,
      reason:
        `Manager review round ${round}: the review file is missing. Write ${file} first, as the direction brief ` +
        `with the sections ${BRIEF_SECTIONS}. Then record it with \`node .claude/scripts/maestro-epic.cjs ` +
        `review-request --task "${state.active_task}" --file "${file}"\` and send the manager the one line it ` +
        "prints. On an escalation, or the fallback to human review (no epic, no live manager), the same file is " +
        "the summary: print it above the question and put a digest of at most 15 lines in the Approve option's " +
        `preview, ending with the review file's path (${file}).`,
    };
  }
  return {
    allow: false,
    reason:
      `Human review round ${round}: the review file is missing. Write ${file} first, with the sections ` +
      `${HUMAN_SECTIONS}. Then print the full summary as text above the ` +
      "question and ask again, putting a digest of at most 15 lines (deviations, risks and open questions, " +
      "changed-file count, corrections since last round) in the Approve option's preview, ending with the " +
      `review file's path (${file}).`,
  };
}
