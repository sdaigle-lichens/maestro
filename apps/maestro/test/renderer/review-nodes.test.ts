import { describe, expect, it } from "vitest";
import {
  MANAGER_DIRECTION_CHANGE_LABEL,
  REVIEW_STYLE,
  nextReviewId,
  reviewRfType,
} from "../../src/renderer/src/utils/review-nodes";

describe("review node helpers", () => {
  it("maps each review type to its own React Flow node type", () => {
    expect(reviewRfType("human_review")).toBe("humanStep");
    expect(reviewRfType("manager_review")).toBe("managerStep");
  });

  it("generates unique ids per type", () => {
    expect(nextReviewId([], "manager_review")).toBe("manager_review-1");
    expect(nextReviewId(["manager_review-1", "human_review-1"], "manager_review")).toBe("manager_review-2");
    expect(nextReviewId(["manager_review-1"], "human_review")).toBe("human_review-1");
  });

  it("generated manager ids match the workflow-spec vocabulary", () => {
    expect(nextReviewId(["manager_review-1"], "manager_review")).toMatch(/^manager_review-\d+$/);
  });

  it("styles manager_review distinctly from human_review", () => {
    expect(REVIEW_STYLE.manager_review.fill).not.toBe(REVIEW_STYLE.human_review.fill);
    expect(REVIEW_STYLE.manager_review.label).not.toBe(REVIEW_STYLE.human_review.label);
  });

  it("uses the backend's condition label", () => {
    expect(MANAGER_DIRECTION_CHANGE_LABEL).toBe("manager requested direction change");
  });
});
