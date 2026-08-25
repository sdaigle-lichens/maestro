// The structured question — read out of an untrusted tool input, and answered back into it.
//
// THE ONE PROPERTY THIS FILE EXISTS FOR is the rejection: a label that was not among the options
// the model offered must be REFUSED rather than forwarded or quietly dropped. Everything the app
// writes into the tool call is built out of strings the model itself wrote, and the renderer's whole
// contribution is which of them were picked — so that has to be asserted directly, against the pure
// function, rather than inferred from a window where a card only offers the right buttons anyway.
//
// The rest is answerability: a question with one option is not a choice, a single-select question
// takes one answer, and a partially answered request reaches the model as a list with an entry
// missing, which reads as "the user had no opinion" rather than as "the UI dropped it".

import { describe, it, expect } from "vitest";
import {
  answerQuestions,
  describeQuestions,
  QUESTION_PREVIEW_FORMAT,
  QUESTION_TOOL,
  QUESTION_UNRENDERABLE,
} from "../../src/core/session-question.js";
import type { AgentQuestion } from "../../src/core/contracts.js";

const frontmatter = {
  questions: [
    {
      question: "Which frontmatter shape do you want?",
      header: "Frontmatter",
      multiSelect: false,
      options: [
        { label: "Minimal", description: "name and description only", preview: "---\nname: x\n---" },
        { label: "Full", description: "every documented field", preview: "---\nname: x\nallowed-tools: …\n---" },
      ],
    },
  ],
};

const oneQuestion = (over: Partial<AgentQuestion> = {}): AgentQuestion[] => [
  {
    question: "Which frontmatter shape do you want?",
    header: "Frontmatter",
    multiSelect: false,
    options: [
      { label: "Minimal", description: "", preview: null },
      { label: "Full", description: "", preview: null },
    ],
    ...over,
  },
];

describe("describeQuestions", () => {
  it("reads the questions, their options, descriptions and previews", () => {
    const questions = describeQuestions(frontmatter);
    expect(questions).toHaveLength(1);
    expect(questions[0].header).toBe("Frontmatter");
    expect(questions[0].multiSelect).toBe(false);
    expect(questions[0].options.map((o) => o.label)).toEqual(["Minimal", "Full"]);
    expect(questions[0].options[0].description).toBe("name and description only");
    expect(questions[0].options[0].preview).toContain("name: x");
  });

  it("reports a missing preview as null rather than as an empty one", () => {
    // The pane has to tell "no preview was emitted" — the session did not opt in, or the model had
    // nothing to show — from "the preview is empty", and render neither.
    const [question] = describeQuestions({
      questions: [{ question: "Pick", options: [{ label: "A" }, { label: "B", preview: "   " }] }],
    });
    expect(question.options[0].preview).toBeNull();
    expect(question.options[1].preview).toBeNull();
  });

  it("falls back to a header when the model sent none", () => {
    const [question] = describeQuestions({
      questions: [
        { question: "Which of these long options do you prefer?", options: [{ label: "A" }, { label: "B" }] },
      ],
    });
    expect(question.header).toBe("Which of the".slice(0, 12));
    expect(question.header.length).toBeLessThanOrEqual(12);
  });

  it("drops what cannot be rendered as a choice: no text, one option, unlabelled options", () => {
    expect(describeQuestions({ questions: [{ question: "", options: [{ label: "A" }, { label: "B" }] }] })).toEqual([]);
    expect(describeQuestions({ questions: [{ question: "Pick", options: [{ label: "A" }] }] })).toEqual([]);
    // An unlabelled option cannot be picked or named, so it goes — and with it the second option
    // the question needed to be a choice at all.
    expect(
      describeQuestions({ questions: [{ question: "Pick", options: [{ label: "A" }, { description: "no label" }] }] })
    ).toEqual([]);
  });

  it("survives an input of the wrong shape entirely", () => {
    // UNTRUSTED SHAPE, the same posture `describeCall` takes with `tool_input`. An empty result is
    // the caller's signal to refuse the call with `QUESTION_UNRENDERABLE` rather than park a promise
    // nobody can resolve.
    expect(describeQuestions({})).toEqual([]);
    expect(describeQuestions({ questions: "nope" } as unknown as Record<string, unknown>)).toEqual([]);
    expect(describeQuestions({ questions: [null, 7, "x"] } as unknown as Record<string, unknown>)).toEqual([]);
    expect(QUESTION_UNRENDERABLE).toContain("prose");
  });

  it("names the tool and the preview opt-in exactly once", () => {
    // Both are literals the query options and the branch in `canUseTool` read, so that a rename
    // cannot leave the tool offered and the branch looking for the old name.
    expect(QUESTION_TOOL).toBe("AskUserQuestion");
    expect(QUESTION_PREVIEW_FORMAT).toBe("markdown");
  });
});

describe("answerQuestions", () => {
  it("REFUSES A LABEL THAT WAS NOT OFFERED, rather than forwarding or dropping it", () => {
    const result = answerQuestions(oneQuestion(), {
      choice: "answer",
      selections: [{ question: 0, labels: ["Whatever I felt like"] }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Named, because the message is what tells whoever sent it which string was rejected.
    expect(result.error).toContain("Whatever I felt like");
    expect(result.error).toContain("not one of the options");
  });

  it("refuses a label that was not offered even when a real one is sent beside it", () => {
    // The dropping case: filtering the unknown label out would send the model an answer to a
    // question nobody asked, and it would look like a perfectly ordinary answer.
    const result = answerQuestions(oneQuestion({ multiSelect: true }), {
      choice: "answer",
      selections: [{ question: 0, labels: ["Minimal", "Something else"] }],
    });
    expect(result.ok).toBe(false);
  });

  it("builds the answer from the question TEXT and the labels as offered", () => {
    const result = answerQuestions(oneQuestion(), {
      choice: "answer",
      selections: [{ question: 0, labels: ["Full"] }],
    });
    expect(result).toEqual({
      ok: true,
      answers: { "Which frontmatter shape do you want?": "Full" },
      response: null,
    });
  });

  it("accepts several answers on a multi-select question, joined as the SDK joins them", () => {
    const result = answerQuestions(oneQuestion({ multiSelect: true }), {
      choice: "answer",
      selections: [{ question: 0, labels: ["Minimal", "Full"] }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.answers["Which frontmatter shape do you want?"]).toBe("Minimal, Full");
  });

  it("refuses several answers on a single-select question", () => {
    // `multiSelect` is the model's own statement about the question it asked: two labels through
    // here answers a different question than the one it will read the answer as.
    const result = answerQuestions(oneQuestion(), {
      choice: "answer",
      selections: [{ question: 0, labels: ["Minimal", "Full"] }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("single answer");
  });

  it("refuses an unanswered, a duplicated, and an unknown question", () => {
    const two = [...oneQuestion(), ...oneQuestion({ question: "And the body?", header: "Body" })];

    const blank = answerQuestions(oneQuestion(), { choice: "answer", selections: [{ question: 0, labels: [] }] });
    expect(blank.ok).toBe(false);

    const partial = answerQuestions(two, { choice: "answer", selections: [{ question: 0, labels: ["Full"] }] });
    expect(partial.ok).toBe(false);
    if (!partial.ok) expect(partial.error).toContain("2 question(s)");

    const twice = answerQuestions(two, {
      choice: "answer",
      selections: [
        { question: 0, labels: ["Full"] },
        { question: 0, labels: ["Minimal"] },
      ],
    });
    expect(twice.ok).toBe(false);

    const nowhere = answerQuestions(oneQuestion(), {
      choice: "answer",
      selections: [{ question: 4, labels: ["Full"] }],
    });
    expect(nowhere.ok).toBe(false);
  });

  it("sends a freeform reply IN PLACE OF an answer", () => {
    // The tool's output carries `response`, and the model is then told "the user responded: …"
    // rather than a per-question list — which is exactly right for "none of these".
    const result = answerQuestions(oneQuestion(), { choice: "reply", text: "  Neither — use the plugin's own  " });
    expect(result).toEqual({ ok: true, answers: {}, response: "Neither — use the plugin's own" });
  });

  it("refuses an empty freeform reply, and anything that is not a choice at all", () => {
    expect(answerQuestions(oneQuestion(), { choice: "reply", text: "   " }).ok).toBe(false);
    expect(answerQuestions(oneQuestion(), { choice: "nonsense" } as never).ok).toBe(false);
  });
});
