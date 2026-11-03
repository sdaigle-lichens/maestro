// Review-step helpers shared by the workflow canvas: the two non-agent "stop" node types
// (human_review, manager_review) differ only in id prefix, React Flow type and look.

export type ReviewNodeType = "human_review" | "manager_review";

/** The React Flow node type each non-agent, non-skill step renders as. */
export function reviewRfType(type: ReviewNodeType): "humanStep" | "managerStep" {
  return type === "manager_review" ? "managerStep" : "humanStep";
}

/** Next free `<type>-N` id (human_review-1, manager_review-2, ...). */
export function nextReviewId(existingIds: readonly string[], type: ReviewNodeType): string {
  let n = 1;
  while (existingIds.includes(`${type}-${n}`)) n++;
  return `${type}-${n}`;
}

/** Condition label a manager_review offers back to the producing agent. */
export const MANAGER_DIRECTION_CHANGE_LABEL = "manager requested direction change";

/** Tailwind classes + label for each review node's diamond. Manager is violet, human is amber. */
export const REVIEW_STYLE: Record<
  ReviewNodeType,
  { text: string; fill: string; border: string; borderSelected: string; kebab: string; plus: string; label: string }
> = {
  human_review: {
    text: "text-amber-800",
    fill: "bg-amber-50",
    border: "border-amber-300",
    borderSelected: "border-amber-500",
    kebab: "text-amber-500 hover:bg-amber-100",
    plus: "border-amber-400 text-amber-600 hover:bg-amber-50",
    label: "Review",
  },
  manager_review: {
    text: "text-violet-800",
    fill: "bg-violet-50",
    border: "border-violet-300",
    borderSelected: "border-violet-500",
    kebab: "text-violet-500 hover:bg-violet-100",
    plus: "border-violet-400 text-violet-600 hover:bg-violet-50",
    label: "Manager",
  },
};
