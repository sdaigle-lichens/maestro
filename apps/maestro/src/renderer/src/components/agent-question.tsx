// A structured question from the model, as a card the user answers by picking.
//
// NOT A PERMISSION PROMPT, and the whole reason this is a second component rather than a branch
// inside `PermissionCard`. That card asks "should this happen" and offers Allow / Deny / Stop; this
// one asks "which of these" and offers the model's own options, each with the description and the
// preview it wrote for them. Rendering the second as the first would put the words "Claude wants to
// use a tool" above a choice between three frontmatter shapes.
//
// WHAT THIS COMPONENT SENDS IS A SELECTION. `QuestionChoice` has two arms — the labels picked per
// question, or a line of typed text — and neither can express the payload the tool reads. That is
// built at the far end, inside `startPaneSession`, out of the questions the SDK delivered: a label
// that was not among the options offered is refused there rather than forwarded. So this file picks
// from a list it was given and cannot write into it, which `test/isolation.test.ts` asserts by
// reading this source rather than by trusting the sentence.

import { useState } from "react";
import { CircleHelp, MessageSquareText, Send } from "lucide-react";
import type { AgentQuestion, QuestionChoice, QuestionPrompt } from "../../../shared/ipc";

/** Picked labels, by question index. A set per question, because a multi-select holds several. */
type Picked = Record<number, string[]>;

/**
 * Is this question ready to send?
 *
 * One label is the minimum and, on a single-select, also the maximum — the card enforces the second
 * half by REPLACING the pick rather than by refusing the click, since a user who taps a second
 * option on a one-answer question has changed their mind, not made a mistake.
 */
function chosen(picked: Picked, at: number): string[] {
  return picked[at] ?? [];
}

export default function QuestionCard({
  request,
  onAnswer,
}: {
  request: QuestionPrompt;
  onAnswer(choice: QuestionChoice): void;
}) {
  const [picked, setPicked] = useState<Picked>({});
  const [reply, setReply] = useState("");
  const [sent, setSent] = useState(false);

  const send = (choice: QuestionChoice) => {
    if (sent) return;
    setSent(true);
    onAnswer(choice);
  };

  const toggle = (question: AgentQuestion, at: number, label: string) => {
    setPicked((prev) => {
      const current = chosen(prev, at);
      if (!question.multiSelect) return { ...prev, [at]: current[0] === label ? [] : [label] };
      return {
        ...prev,
        [at]: current.includes(label) ? current.filter((l) => l !== label) : [...current, label],
      };
    });
  };

  // Every question, or none. A partial answer reaches the model as a list with an entry missing,
  // which reads as "the user had no opinion" rather than as "the pane dropped it" — the far end
  // refuses one outright, and this is the same rule said in a disabled button.
  const complete = request.questions.every((_, at) => chosen(picked, at).length > 0);

  return (
    <div
      data-testid="session-question"
      data-request={request.requestId}
      data-questions={request.questions.length}
      className="mb-2 rounded-xl border border-primary/40 bg-(--primary-dim) px-3 py-2.5"
    >
      <div className="flex items-start gap-2">
        <CircleHelp size={14} className="mt-0.5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[12px] font-semibold text-(--ink)">Claude is asking you to decide</p>
          {request.agentId && <p className="m-0 text-[10px] text-(--ink-3)">Asked by subagent {request.agentId}</p>}
        </div>
      </div>

      {request.questions.map((question, at) => (
        <div
          key={`${question.question}-${at}`}
          data-testid="session-question-item"
          data-index={at}
          data-multi={question.multiSelect ? "yes" : "no"}
          className="mt-2.5"
        >
          <div className="flex items-baseline gap-1.5">
            <span className="rounded-md bg-(--bg-elev) px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-(--ink-3)">
              {question.header}
            </span>
            {/*
              WHICH QUESTIONS TAKE SEVERAL, said in the card. `multiSelect` is the model's own
              statement about the question it asked, and a user who does not know which kind they are
              looking at learns it by clicking and watching their first pick disappear.
            */}
            <span data-testid="session-question-mode" className="text-[9px] text-(--ink-3)">
              {question.multiSelect ? "pick any" : "pick one"}
            </span>
          </div>
          <p className="m-0 mt-1 text-[11px] text-(--ink)">{question.question}</p>

          <div className="mt-1.5 flex flex-col gap-1.5">
            {question.options.map((option) => {
              const on = chosen(picked, at).includes(option.label);
              return (
                <button
                  key={option.label}
                  type="button"
                  data-testid="session-question-option"
                  data-question={at}
                  data-label={option.label}
                  data-selected={on ? "yes" : "no"}
                  disabled={sent}
                  onClick={() => toggle(question, at, option.label)}
                  className={`w-full rounded-lg border px-2.5 py-1.5 text-left disabled:opacity-40 cursor-pointer focus:outline-none ${
                    on
                      ? "border-primary bg-primary/10"
                      : "border-(--line) bg-(--bg) hover:border-ring hover:bg-(--bg-elev)"
                  }`}
                >
                  <span className="block text-[11px] font-semibold text-(--ink)">{option.label}</span>
                  {option.description && (
                    <span className="mt-0.5 block text-[10px] text-(--ink-2)">{option.description}</span>
                  )}
                  {/*
                    THE PREVIEW, in a monospace block and not as a document. An option preview is a
                    mockup or a snippet to compare against its neighbour — it exists so the two
                    options can be read side by side, which is also why it is never truncated behind
                    a "show more". Present only when the session opted into previews at start.
                  */}
                  {option.preview && (
                    <pre
                      data-testid="session-question-preview"
                      className="m-0 mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-(--bg-elev) px-2 py-1 font-mono text-[10px] text-(--ink-2)"
                    >
                      {option.preview}
                    </pre>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          data-testid="session-question-send"
          disabled={sent || !complete}
          onClick={() =>
            send({
              choice: "answer",
              selections: request.questions.map((_, at) => ({ question: at, labels: chosen(picked, at) })),
            })
          }
          className="inline-flex items-center gap-1 rounded-md border-0 bg-primary px-2.5 py-1 text-[11px] text-white hover:brightness-110 disabled:opacity-40 cursor-pointer focus:outline-none"
        >
          <Send size={11} /> Send answer
        </button>
        <span className="text-[10px] text-(--ink-3)">
          {complete ? "" : `Pick an option for each question (${request.questions.length}).`}
        </span>
      </div>

      {/*
        THE FREEFORM REPLY, kept because a user who disagrees with every option should be able to say
        so. It goes IN PLACE OF the structured answer rather than beside it — the tool tells the model
        "the user responded: …" instead of a per-question list, which is exactly right for "none of
        these". Typed text is what this pane is already allowed to carry; it is what the composer
        carries on every turn.
      */}
      <div className="mt-2 border-t border-(--line) pt-2">
        <label className="flex items-center gap-1 text-[10px] text-(--ink-3)">
          <MessageSquareText size={10} /> None of these?
        </label>
        <textarea
          data-testid="session-question-reply-text"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          rows={2}
          placeholder="Say what you want instead…"
          className="mt-1 w-full resize-none rounded-md border border-(--line) bg-(--bg) px-2 py-1.5 text-[11px] text-(--ink) placeholder-subtle outline-none focus:border-primary"
        />
        <button
          type="button"
          data-testid="session-question-reply"
          disabled={sent || reply.trim() === ""}
          onClick={() => send({ choice: "reply", text: reply.trim() })}
          className="mt-1 inline-flex items-center gap-1 rounded-md border border-(--line) bg-(--bg) px-2.5 py-1 text-[11px] text-(--ink-2) hover:text-(--ink) disabled:opacity-40 cursor-pointer focus:outline-none"
        >
          Send this instead
        </button>
      </div>
    </div>
  );
}
