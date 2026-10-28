import type { ReviewNodeType } from "../utils/review-nodes";

export type AddStepKind = "agent" | "skill" | "review";

export const DEFAULT_REVIEW_TYPE: ReviewNodeType = "human_review";

/** The saved node type the modal's current choice adds. */
export function addStepNodeType(kind: AddStepKind, reviewType: ReviewNodeType): "agent" | "skill" | ReviewNodeType {
  return kind === "review" ? reviewType : kind;
}

const segment = (active: boolean, size: "md" | "sm") =>
  `flex-1 ${size === "md" ? "py-1.5 text-[12px] font-medium" : "py-1 text-[11px] font-medium"} cursor-pointer focus:outline-none transition-colors ${
    active ? "bg-maestro-primary text-white" : "bg-maestro-elevated text-maestro-muted hover:bg-maestro"
  }`;

const KINDS: { kind: AddStepKind; label: string }[] = [
  { kind: "agent", label: "Agent" },
  { kind: "skill", label: "Skill" },
  { kind: "review", label: "Review" },
];

const REVIEW_TYPES: { type: ReviewNodeType; label: string }[] = [
  { type: "human_review", label: "Human" },
  { type: "manager_review", label: "Manager" },
];

// The add-step modal's step choice: Agent / Skill / Review, and for Review a second Human / Manager choice.
export default function AddStepKindChoice({
  kind,
  reviewType,
  onKindChange,
  onReviewTypeChange,
}: {
  kind: AddStepKind;
  reviewType: ReviewNodeType;
  onKindChange: (kind: AddStepKind) => void;
  onReviewTypeChange: (type: ReviewNodeType) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex rounded-lg overflow-hidden border border-maestro" role="group" aria-label="Step kind">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            aria-pressed={kind === k.kind}
            onClick={() => onKindChange(k.kind)}
            className={segment(kind === k.kind, "md")}
          >
            {k.label}
          </button>
        ))}
      </div>
      {kind === "review" && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] text-maestro-muted uppercase tracking-wide">Review by</div>
          <div className="flex rounded-lg overflow-hidden border border-maestro" role="group" aria-label="Review type">
            {REVIEW_TYPES.map((r) => (
              <button
                key={r.type}
                type="button"
                aria-pressed={reviewType === r.type}
                onClick={() => onReviewTypeChange(r.type)}
                className={segment(reviewType === r.type, "sm")}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
