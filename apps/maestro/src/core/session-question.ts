// A structured question from the model — read out of the tool call, and answered back into it.
//
// THIS IS NOT A PERMISSION PROMPT, and the only thing the two share is the wire they arrive on.
// `AskUserQuestion` reaches `canUseTool` like everything else — it reaches it even when a rule would
// otherwise auto-approve it, because by definition it needs a human — but "Claude wants to use a
// tool — Allow / Deny" is the wrong sentence for "which of these three frontmatter shapes do you
// want". So `session-permission.ts` never sees one: `agent-sdk.ts` branches on the tool name first
// and hands the call here.
//
// THE ANSWER TRAVELS BACK THROUGH `updatedInput`, WHICH IS THE FIELD THIS APP OTHERWISE REFUSES TO
// EXPOSE. A permission answer carries a decision and no payload; this one carries the tool's own
// input back with the user's choices written into it, which is a payload by any reading. The
// carve-out is made checkable rather than trusted, and this module is where:
//
//   • The renderer sends a SELECTION — which question, which option labels — and never an
//     `answers` map, a `response` string or an input object.
//   • `answerQuestions` rebuilds the payload from the questions THE MODEL ASKED, and rejects any
//     label that was not among the options it offered. A selection naming an unknown label is an
//     error, not a filtered-out entry: silently dropping it would send the model an answer to a
//     question nobody asked.
//   • The caller applies it to the input the SDK actually delivered, so the validation runs against
//     the options as received rather than against a copy that crossed two process boundaries.
//
// PURE — object and string arithmetic, no `fs`, no SDK, exactly like the three scope modules, which
// is what lets the rejection above be asserted directly instead of inferred from a window.

import type { AgentQuestion, AgentQuestionOption, PermissionAnswer, QuestionChoice } from "./contracts.js";

/** The tool this module answers for. One literal, so the branch and the tool list cannot drift. */
export const QUESTION_TOOL = "AskUserQuestion";

/**
 * The preview format declared at session start, and the reason previews exist at all.
 *
 * `toolConfig: { askUserQuestion: { previewFormat } }` is opt-in: unset, Claude emits no `preview`
 * on any option and the list arrives bare. `markdown` rather than `html` because the pane renders a
 * preview in a monospace block and never as a document — an option preview is a mockup or a snippet
 * to compare against its neighbour, not a page.
 */
export const QUESTION_PREVIEW_FORMAT = "markdown";

/** How many labels a single-select question accepts. Named, because the error message says it. */
const SINGLE = 1;

/** What the model is told when a question arrived in a shape the pane cannot render. */
export const QUESTION_UNRENDERABLE =
  "That AskUserQuestion call could not be rendered as a question — it carried no question with " +
  "options. Ask in prose instead, and offer the choices in the text of your message.";

/**
 * The refusal itself, and not merely its wording.
 *
 * `startPaneSession` authors NO decision of its own — the whole of `020` is that it routes what a
 * pure module decided — so the one call it turns away comes back from here fully formed. The shape
 * matters as much as the sentence: a question that cannot be rendered must resolve the promise, and
 * a `deny` is the only arm that ends a call the user was never shown.
 */
export const QUESTION_REFUSAL: PermissionAnswer = { behavior: "deny", message: QUESTION_UNRENDERABLE };

/** Multi-select answers reach the tool as one string. The separator is the SDK's own. */
const JOIN = ", ";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** One option, or null when it carries no label — an unlabelled button cannot be picked or named. */
function optionOf(raw: unknown): AgentQuestionOption | null {
  const entry = (raw ?? {}) as Record<string, unknown>;
  const label = text(entry.label);
  if (label === "") return null;
  return {
    label,
    description: text(entry.description),
    // Null rather than "" so the pane can tell "no preview was emitted" (the session did not opt
    // in, or the model had nothing to show) from "the preview is empty", and render neither.
    preview: text(entry.preview) === "" ? null : String(entry.preview),
  };
}

/**
 * The questions inside one `AskUserQuestion` call, as the pane renders them.
 *
 * UNTRUSTED SHAPE, not a typed payload — the same posture `describeCall` takes with `tool_input`.
 * Everything is read defensively and anything unusable is dropped, so a question with one option,
 * or with no `question` text, cannot reach a card that then cannot be answered. An empty result is
 * the caller's signal to refuse the call outright with `QUESTION_UNRENDERABLE`: a question nobody
 * can answer parks a promise that only teardown will ever resolve.
 */
export function describeQuestions(input: Record<string, unknown>): AgentQuestion[] {
  const raw = Array.isArray(input?.questions) ? (input.questions as unknown[]) : [];
  const questions: AgentQuestion[] = [];

  for (const entry of raw) {
    const q = (entry ?? {}) as Record<string, unknown>;
    const question = text(q.question);
    const options = (Array.isArray(q.options) ? (q.options as unknown[]) : [])
      .map(optionOf)
      .filter((o): o is AgentQuestionOption => o !== null);
    // Two minimums, and both are about answerability rather than tidiness: a question with no text
    // is a card with no subject, and one with a single option is not a choice.
    if (question === "" || options.length < 2) continue;
    questions.push({
      question,
      header: text(q.header) || question.slice(0, 12),
      multiSelect: q.multiSelect === true,
      options,
    });
  }

  return questions;
}

/**
 * What `answerQuestions` produced: the fields to write into the tool input, or why it refused.
 *
 * The FIELDS, not the input. Merging them onto the call the SDK delivered is the caller's job, and
 * deliberately so — this module never sees the raw input, so it cannot pass anything through from
 * the renderer that it did not itself construct out of the questions asked.
 */
export type QuestionResolution =
  | {
      ok: true;
      /** Keyed by question TEXT, per the tool's own output shape; multi-select joined with ", ". */
      answers: Record<string, string>;
      /** Freeform text the user typed instead of choosing. Null on a structured answer. */
      response: string | null;
    }
  | { ok: false; error: string };

/**
 * Turn a selection into the answer the tool expects, or refuse it.
 *
 * THE REJECTION IS THE POINT. Every label is checked against the options of the question it claims
 * to answer, exactly as they were offered — so the payload this returns is constructed entirely
 * from strings the MODEL wrote, and the renderer's contribution is which of them were picked. A
 * label that was not offered is refused rather than forwarded, and the caller answers nothing:
 * there is no path by which a renderer's string reaches the model as the user's choice.
 *
 * The other three refusals are about answerability rather than trust, and each has its own message
 * because "you sent a label nobody offered" and "you left a question blank" call for different
 * fixes in whatever sent it.
 */
export function answerQuestions(questions: readonly AgentQuestion[], choice: QuestionChoice): QuestionResolution {
  if (choice?.choice === "reply") {
    const reply = text(choice.text);
    // A freeform reply IN PLACE OF an answer, not beside one: the tool's output carries `response`
    // and the model is then told "The user responded: …" rather than a per-question answer list.
    // An empty one would say nothing at all, which is worse than the question going unanswered.
    if (reply === "") return { ok: false, error: "A freeform reply cannot be empty." };
    return { ok: true, answers: {}, response: reply };
  }

  if (choice?.choice !== "answer") return { ok: false, error: "That is not an answer to a question." };

  const selections = Array.isArray(choice.selections) ? choice.selections : [];
  const answers: Record<string, string> = {};
  const seen = new Set<number>();

  for (const selection of selections) {
    const at = Number(selection?.question);
    if (!Number.isInteger(at) || at < 0 || at >= questions.length) {
      return { ok: false, error: `There is no question ${String(selection?.question)} in this request.` };
    }
    if (seen.has(at)) return { ok: false, error: `Question ${at + 1} was answered twice.` };
    seen.add(at);

    const question = questions[at];
    const labels = Array.isArray(selection?.labels) ? selection.labels.map(text).filter(Boolean) : [];
    if (labels.length === 0) return { ok: false, error: `"${question.header}" was left unanswered.` };
    // ONE ANSWER MEANS ONE ANSWER. `multiSelect` is the model's own statement about the question it
    // asked; letting two labels through on a single-select question would answer a different
    // question than the one it will read the answer as.
    if (!question.multiSelect && labels.length > SINGLE) {
      return { ok: false, error: `"${question.header}" takes a single answer, and ${labels.length} were sent.` };
    }

    const offered = question.options.map((o) => o.label);
    for (const label of labels) {
      if (!offered.includes(label)) {
        return { ok: false, error: `"${label}" was not one of the options offered for "${question.header}".` };
      }
    }

    answers[question.question] = labels.join(JOIN);
  }

  // Every question, or none of them. A partially answered call reaches the model as an answer list
  // with a question missing from it, which reads as "the user had no opinion" rather than as "the
  // UI dropped it".
  if (seen.size !== questions.length) {
    return { ok: false, error: `This request has ${questions.length} question(s) and ${seen.size} were answered.` };
  }

  return { ok: true, answers, response: null };
}
