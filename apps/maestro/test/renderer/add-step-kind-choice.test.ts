// `138`: the add-step modal's three-kind choice. No jsdom, so the component is rendered to static
// markup for what is shown, and called as a plain function (it has no hooks) to find a button in the
// element tree and fire its onClick.

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import AddStepKindChoice, {
  DEFAULT_REVIEW_TYPE,
  addStepNodeType,
  type AddStepKind,
} from "../../src/renderer/src/components/add-step-kind-choice.js";
import type { ReviewNodeType } from "../../src/renderer/src/utils/review-nodes.js";

type Props = Parameters<typeof AddStepKindChoice>[0];

const render = (kind: AddStepKind, reviewType: ReviewNodeType = DEFAULT_REVIEW_TYPE) =>
  renderToStaticMarkup(
    createElement(AddStepKindChoice, { kind, reviewType, onKindChange: () => {}, onReviewTypeChange: () => {} })
  );

const buttons = (html: string) =>
  [...html.matchAll(/<button\b([^>]*)>([^<]*)<\/button>/g)].map((m) => ({
    label: m[2],
    pressed: /aria-pressed="true"/.test(m[1]),
  }));

function findButton(node: ReactNode, label: string): ReactElement<{ onClick: () => void }> | null {
  if (!isValidElement(node)) {
    if (Array.isArray(node))
      for (const c of node) {
        const f = findButton(c, label);
        if (f) return f;
      }
    return null;
  }
  const el = node as ReactElement<{ onClick: () => void; children?: ReactNode }>;
  if (el.type === "button" && el.props.children === label) return el;
  return findButton(el.props.children, label);
}

const click = (props: Props, label: string) => {
  const btn = findButton(AddStepKindChoice(props), label);
  expect(btn, `button ${label}`).not.toBeNull();
  btn!.props.onClick();
};

describe("add-step kind choice", () => {
  it("defaults the review type to Human", () => {
    expect(DEFAULT_REVIEW_TYPE).toBe("human_review");
    const b = buttons(render("review"));
    expect(b.find((x) => x.label === "Human")?.pressed).toBe(true);
    expect(b.find((x) => x.label === "Manager")?.pressed).toBe(false);
  });

  it.each<AddStepKind>(["agent", "skill", "review"])("shows Agent, Skill and Review when kind=%s", (kind) => {
    const labels = buttons(render(kind)).map((x) => x.label);
    expect(labels.slice(0, 3)).toEqual(["Agent", "Skill", "Review"]);
  });

  it.each<AddStepKind>(["agent", "skill"])("hides the Human/Manager choice when kind=%s", (kind) => {
    const html = render(kind);
    expect(html).not.toContain("Human");
    expect(html).not.toContain("Manager");
    expect(html).not.toContain("Review by");
    expect(buttons(html)).toHaveLength(3);
  });

  it("marks only the selected kind as pressed", () => {
    for (const kind of ["agent", "skill", "review"] as const) {
      const pressed = buttons(render(kind))
        .slice(0, 3)
        .filter((x) => x.pressed)
        .map((x) => x.label.toLowerCase());
      expect(pressed).toEqual([kind]);
    }
  });

  it("shows Human and Manager for review, with Manager pressed when chosen", () => {
    const b = buttons(render("review", "manager_review"));
    expect(b.map((x) => x.label)).toEqual(["Agent", "Skill", "Review", "Human", "Manager"]);
    expect(b.find((x) => x.label === "Manager")?.pressed).toBe(true);
    expect(b.find((x) => x.label === "Human")?.pressed).toBe(false);
  });

  it("maps the choice to the saved node type", () => {
    expect(addStepNodeType("review", "human_review")).toBe("human_review");
    expect(addStepNodeType("review", "manager_review")).toBe("manager_review");
    expect(addStepNodeType("review", DEFAULT_REVIEW_TYPE)).toBe("human_review");
    // review type is ignored for non-review kinds
    expect(addStepNodeType("agent", "manager_review")).toBe("agent");
    expect(addStepNodeType("skill", "manager_review")).toBe("skill");
    expect(addStepNodeType("agent", "human_review")).toBe("agent");
  });

  it("fires onKindChange with the clicked kind", () => {
    const onKindChange = vi.fn();
    const props: Props = { kind: "agent", reviewType: DEFAULT_REVIEW_TYPE, onKindChange, onReviewTypeChange: vi.fn() };
    click(props, "Review");
    click(props, "Skill");
    expect(onKindChange.mock.calls).toEqual([["review"], ["skill"]]);
  });

  it("Human click reports human_review and Manager click reports manager_review", () => {
    const onReviewTypeChange = vi.fn();
    const onKindChange = vi.fn();
    const props: Props = { kind: "review", reviewType: DEFAULT_REVIEW_TYPE, onKindChange, onReviewTypeChange };
    click(props, "Manager");
    click(props, "Human");
    expect(onReviewTypeChange.mock.calls).toEqual([["manager_review"], ["human_review"]]);
    expect(onKindChange).not.toHaveBeenCalled();
    expect(addStepNodeType("review", onReviewTypeChange.mock.calls[0][0])).toBe("manager_review");
    expect(addStepNodeType("review", onReviewTypeChange.mock.calls[1][0])).toBe("human_review");
  });
});
