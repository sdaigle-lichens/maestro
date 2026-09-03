// The per-agent half of `031`: what one forked agent's divergence from its template looks like,
// and the three things a user can do about it.
//
// It renders BELOW the card rather than inside it, deliberately. `CARD_MIN_HEIGHT` is a measured
// constant that keeps the card the same height in view and edit mode so pressing Edit does not
// reflow the page under the pointer (see the `agents-view` skill); a conditional block of diff
// inside the card would make that height vary by agent and by template state, which is exactly
// what the constant exists to prevent.
//
// The description sits next to the body diff on purpose. When the body advances and the
// description stays put — which is the whole point of a fork — the two can drift, the description
// promising something the new body no longer does. That is not a blocker, and the user can only
// notice it if both are on screen.

import { useState } from "react";
import { AlertTriangle, Check, GitBranch, Unlink } from "lucide-react";
import Button from "@repo/ui/button";
import type { AgentSyncAction, AgentSyncEntry } from "../../../../shared/ipc";

/** Where the template lives and what moved, in one line. */
function originLine(entry: AgentSyncEntry): string {
  if (entry.sourceTier === "user") {
    return "Forked from ~/.claude/agents — a hand-edited file with no version, so it is compared by content.";
  }
  const plugin = entry.sourcePlugin ?? "a plugin";
  const from = entry.trackedVersion ?? "(unversioned)";
  const to = entry.templateVersion ?? "(unversioned)";
  return entry.templateAdvanced
    ? `Shipped by the ${plugin} plugin — ${from} → ${to}.`
    : `Shipped by the ${plugin} plugin — ${to}, the version this fork already tracks.`;
}

/**
 * The verdict in a sentence. `no-template` and `unchanged` both land on the reassuring one; the two
 * that need a decision each say what the decision is about.
 */
function verdictLine(entry: AgentSyncEntry): { tone: "ok" | "warn" | "info"; text: string } {
  if (entry.templateFile === null) {
    return {
      tone: "warn",
      text: "The template this was forked from is no longer installed, so there is nothing to compare against. Detaching stops Maestro tracking it.",
    };
  }
  if (entry.verdict === "materialize") {
    return {
      tone: "warn",
      text: "This fork's own file is missing, but its provenance record is still here. Updating writes the template back out; detaching drops the record.",
    };
  }
  if (entry.verdict === "refresh") {
    return { tone: "info", text: "Untouched since it was forked, and the template has moved on. Updating is safe." };
  }
  if (entry.verdict === "stale-customized") {
    return entry.templateAdvanced
      ? {
          tone: "warn",
          text: "You edited this fork's body, and the template has moved on since. Nothing is overwritten automatically — the diff below is what taking the new body would change.",
        }
      : { tone: "ok", text: "You edited this fork's body. The template has not moved, so there is nothing to take." };
  }
  return { tone: "ok", text: "In step with its template." };
}

function DescriptionPair({ entry }: { entry: AgentSyncEntry }) {
  const drifted =
    entry.templateDescription !== null &&
    entry.description !== null &&
    entry.templateDescription.trim() !== entry.description.trim();
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="flex flex-col gap-1">
        <div className="text-[11px] font-semibold text-subtle uppercase tracking-wide">Your description</div>
        <p className="text-[12px] text-(--ink-2) m-0">{entry.description || <em>none</em>}</p>
      </div>
      <div className="flex flex-col gap-1">
        <div className="text-[11px] font-semibold text-subtle uppercase tracking-wide">
          Template&rsquo;s description
        </div>
        <p className={`text-[12px] m-0 ${drifted ? "text-amber-500" : "text-(--ink-3)"}`}>
          {entry.templateDescription || <em>none</em>}
        </p>
      </div>
    </div>
  );
}

function DiffBlock({ entry }: { entry: AgentSyncEntry }) {
  const changed = entry.diff.filter((l) => l.kind !== "ctx").length;
  if (entry.diff.length === 0) {
    return (
      <p className="text-[12px] text-(--ink-3) m-0">No diff to show — the fork or its template could not be read.</p>
    );
  }
  if (changed === 0) {
    return <p className="text-[12px] text-(--ink-3) m-0">The body is identical to the template&rsquo;s.</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[11px] font-semibold text-subtle uppercase tracking-wide">
        Body diff — {changed} line{changed === 1 ? "" : "s"} would change
      </div>
      <div
        data-testid="agent-fork-diff"
        className="max-h-72 overflow-auto rounded-lg border border-(--line) bg-(--sunken) p-2"
      >
        <pre className="m-0 font-mono text-[11px] leading-[1.45] whitespace-pre">
          {entry.diff.map((line, i) => (
            <div
              key={i}
              className={
                line.kind === "add"
                  ? "text-(--green) bg-green-500/10"
                  : line.kind === "del"
                    ? "text-red-500 bg-red-500/10"
                    : "text-(--ink-3)"
              }
            >
              {line.kind === "add" ? "+" : line.kind === "del" ? "-" : " "}
              {line.text || " "}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

export default function AgentForkReview({
  entry,
  busy,
  onAction,
}: {
  entry: AgentSyncEntry;
  busy: boolean;
  onAction: (action: AgentSyncAction) => void;
}) {
  // Taking the new body over edits the user made is the one action here that can lose work, so it
  // asks twice. Every other button is reversible: keep re-raises next version, detach leaves the
  // file exactly where it is.
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const verdict = verdictLine(entry);
  const destructive = entry.verdict === "stale-customized";
  const canUpdate = entry.templateFile !== null && (entry.verdict !== "unchanged" || entry.templateAdvanced);

  return (
    <div
      data-testid="agent-fork-review"
      data-verdict={entry.verdict}
      className="mx-6 mb-6 flex flex-col gap-3 p-4 rounded-lg border border-(--line) bg-(--bg-elev)"
    >
      <div className="flex items-center gap-2">
        <GitBranch size={13} className="text-(--ink-3)" />
        <span className="text-[13px] font-semibold text-(--ink)">Forked from a template</span>
        <span className="ml-auto font-mono text-[11px] text-(--ink-3)">{entry.templateFile ?? "template missing"}</span>
      </div>

      <p className="text-[12px] text-(--ink-3) m-0">{originLine(entry)}</p>

      <div
        className={`flex items-start gap-2 px-3 py-2 rounded-lg text-[12px] ${
          verdict.tone === "warn" ? "bg-amber-500/10" : verdict.tone === "info" ? "bg-(--primary-dim)" : "bg-(--sunken)"
        }`}
      >
        {verdict.tone === "warn" ? (
          <AlertTriangle size={14} className="shrink-0 mt-px text-amber-500" />
        ) : (
          <Check size={14} className="shrink-0 mt-px text-(--green)" />
        )}
        <span className="text-(--ink-2)">{verdict.text}</span>
      </div>

      <DescriptionPair entry={entry} />
      <DiffBlock entry={entry} />

      <div className="flex items-center gap-2 flex-wrap pt-1">
        <Button
          variant={destructive ? "secondary" : "primary"}
          disabled={busy || !canUpdate}
          onClick={() => {
            if (destructive && !confirmOverwrite) {
              setConfirmOverwrite(true);
              return;
            }
            setConfirmOverwrite(false);
            onAction("update");
          }}
        >
          {destructive
            ? confirmOverwrite
              ? "Discard my edits and take it"
              : "Take the new body…"
            : "Update — take the new body"}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => onAction("keep")}>
          Keep as fork
        </Button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onAction("detach")}
          className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg text-[13px] font-semibold border box-border transition-all duration-150 border-red-500/40 text-red-500 hover:bg-red-500/10 cursor-pointer focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Unlink size={13} /> Detach
        </button>
      </div>
      <p className="text-[12px] text-(--ink-3) m-0">
        <b>Update</b> keeps your description and your name and replaces the body. <b>Keep as fork</b> changes nothing
        and asks again the next time the template moves. <b>Detach</b> removes only the provenance record — the file
        stays exactly where it is, and Maestro stops tracking it.
      </p>
    </div>
  );
}
