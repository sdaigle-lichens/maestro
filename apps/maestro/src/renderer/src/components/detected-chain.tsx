import { useState } from "react";
import { Check, Info, X } from "lucide-react";
import type { RepoDetection } from "../utils/maestro";

/**
 * The implementation-agent chain the repo detection proposed, the evidence for it, and the
 * controls to change it — shown in the left sidebar while the canvas is still a starter
 * configuration, and only for the default (first) workflow: every other seeded workflow is a
 * variation someone already chose to add, not the one detection produced.
 *
 * Three things have to be true at once here, and each is why one part of this exists:
 *
 *   • **The choice is visible.** The seed used to hardcode `["backend"]`; a frontend project got a
 *     backend agent and nothing on screen said where that came from.
 *   • **The reasoning is visible.** `evidence` names the dependencies and files that matched. A
 *     detector that is sometimes wrong but shows its work can be corrected; the same detector,
 *     silent, is just an unexplained choice the user is asked to trust. It used to render inline as
 *     a block of monospace lines, which is what pushed this whole thing out of the sidebar in the
 *     first place — now it's a button that opens it in a popup instead.
 *   • **The user can override it before it counts.** Toggling a chip re-seeds the whole starter
 *     graph — nothing is on disk until Save, so being wrong here costs a click.
 */
export default function DetectedChain({
  detection,
  selected,
  candidates,
  busy,
  onChange,
}: {
  detection: RepoDetection;
  /** The chain currently in the canvas — the detection, or whatever the user changed it to. */
  selected: string[];
  /** Implementation agents on offer: the bundled ones, minus the core four every seed includes. */
  candidates: string[];
  busy: boolean;
  onChange(implAgents: string[]): void;
}) {
  const [showEvidence, setShowEvidence] = useState(false);

  const toggle = (agent: string) => {
    if (busy) return;
    const next = selected.includes(agent) ? selected.filter((a) => a !== agent) : [...selected, agent];
    // A workflow whose implementation step is missing has no happy path to run, so the last
    // remaining agent can't be turned off — the user swaps it, they don't empty the chain.
    if (next.length === 0) return;
    onChange(next);
  };

  return (
    <div data-testid="detected-chain" className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-1">
        <span className="text-[11px] font-semibold text-subtle uppercase tracking-wide">
          {detection.fallback ? "Could not detect — starting with" : "Detected from this repo"}
        </span>
        <button
          type="button"
          data-testid="detection-evidence-trigger"
          onClick={() => setShowEvidence(true)}
          title="Why these agents?"
          className="shrink-0 flex items-center justify-center w-5 h-5 rounded text-(--ink-3) hover:text-(--ink) cursor-pointer focus:outline-none bg-transparent border-0"
        >
          <Info size={12} />
        </button>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {candidates.map((agent) => {
          const on = selected.includes(agent);
          return (
            <button
              key={agent}
              type="button"
              data-agent={agent}
              aria-pressed={on}
              disabled={busy}
              onClick={() => toggle(agent)}
              title={
                on
                  ? `@${agent} implements the code in the seeded happy path — click to remove`
                  : `Add @${agent} to the seeded happy path`
              }
              className={`inline-flex items-center gap-1 h-6 px-2 rounded-full font-mono text-[11px] border cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                on
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-(--line) text-(--ink-3) hover:text-(--ink)"
              }`}
            >
              {on && <Check size={10} />}
              {agent}
            </button>
          );
        })}
      </div>

      <span className="text-[11px] text-(--ink-3)">
        {busy ? "Re-seeding…" : "Change it and the starter workflows are rebuilt around it."}
      </span>

      {showEvidence && (
        <div
          className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center"
          onClick={() => setShowEvidence(false)}
        >
          <div
            data-testid="detection-evidence-dialog"
            className="bg-(--bg) border border-(--line) rounded-xl p-5 shadow-xl w-96 max-h-[70vh] flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-(--ink)">Why these agents?</span>
              <button
                type="button"
                onClick={() => setShowEvidence(false)}
                title="Close"
                className="flex items-center justify-center w-6 h-6 rounded text-(--ink-3) hover:text-(--ink) cursor-pointer focus:outline-none bg-transparent border-0"
              >
                <X size={13} />
              </button>
            </div>
            {/*
              The evidence, verbatim from the detector. Rendered as plain text with backticks intact
              rather than parsed into markup: these are dependency and file names, and a `react-dom`
              the user can copy out of the line is more useful than a styled one.
            */}
            <ul
              data-testid="detection-evidence"
              className="list-none p-0 m-0 flex flex-col gap-1 text-[12px] text-(--ink-2) font-mono overflow-y-auto"
            >
              {detection.evidence.map((line) => (
                <li key={line} className="break-all">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
