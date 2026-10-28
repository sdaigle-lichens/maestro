// The human-review summary gate (`130`).
//
// At a `human review` step the orchestrator must show the user what changed. Prose alone was
// skipped or hidden behind the question dialog, so the summary is made structural: each round the
// orchestrator writes a review file next to the task file, and a PreToolUse hook on
// AskUserQuestion (`plugins/maestro/scripts/maestro-human-review-gate.js`) refuses the question
// while the session's current step is a human review and that round's file does not exist.
//
// "Current step" is the first unfinished step of the plan recorded in the session's session.json
// (`maestro-task-status.cjs plan` / `plan-step`). A session with no plan, no `active_task`, or a
// current step that is not a human review is never gated: the hook only ever narrows, and fails
// open on anything it cannot read.
//
// Imports nothing: the file-existence probe is passed in, so this rides the `maestro-session`
// bundle (which must stay free of `node:sqlite`) without touching its generated import names.

export const HUMAN_REVIEW_LABEL = "human review";

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
 * Which human-review round is the session in, or null when its current step is not a human review.
 * Round = 1 + loop-backs recorded + human reviews already approved, so a second review step in one
 * plan and a re-review after corrections each get their own file.
 */
export function currentReviewRound(plan: PlanLike | null | undefined): number | null {
  if (!plan || !Array.isArray(plan.steps)) return null;
  const steps = plan.steps as PlanStepLike[];
  const next = steps.findIndex((s) => s && s.status !== "done");
  if (next === -1 || steps[next].label !== HUMAN_REVIEW_LABEL) return null;
  const doneReviews = steps.filter((s) => s && s.label === HUMAN_REVIEW_LABEL && s.status === "done").length;
  const loopbacks = typeof plan.loopbacks === "number" && plan.loopbacks > 0 ? Math.floor(plan.loopbacks) : 0;
  return 1 + loopbacks + doneReviews;
}

/**
 * Judge one tool call. `state` is the session's parsed session.json; `tasksDir` the project's
 * `.claude/maestro-tasks`; `exists` probes a file. Only AskUserQuestion is in scope.
 */
export function checkHumanReview(input: {
  tasksDir: string;
  toolName: string | null | undefined;
  state: { plan?: PlanLike; active_task?: unknown } | null | undefined;
  exists: (file: string) => boolean;
}): HumanReviewVerdict {
  if (input.toolName !== "AskUserQuestion") return { allow: true };
  const state = input.state;
  if (!state || typeof state.active_task !== "string" || !state.active_task) return { allow: true };
  const round = currentReviewRound(state.plan);
  if (round === null) return { allow: true };

  const name = reviewFileName(state.active_task, round);
  const file = `${input.tasksDir.replace(/[\\/]+$/, "")}/${name}`;
  if (input.exists(file)) return { allow: true };

  return {
    allow: false,
    reason:
      `Human review round ${round}: the review file is missing. Write ${file} first, with the sections ` +
      "'## Changed' (files and areas), '## Did' (one line per agent), '## Deviations from the ticket' and, " +
      "on a re-review, '## Corrections since the last round'. Then print the full summary as text above the " +
      "question and ask again, putting a digest of at most 15 lines (deviations, risks and open questions, " +
      "changed-file count, corrections since last round) in the Approve option's preview, ending with the " +
      `review file's path (${file}).`,
  };
}
