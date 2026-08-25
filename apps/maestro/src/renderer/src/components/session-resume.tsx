// The picker for a conversation this app did not start (`025`), and the disclosure in front of it.
//
// TWO STEPS, NEVER ONE. The list is cheap and browsable; attaching is not, and what it costs is not
// only money. A resumed transcript was produced under the rules of the session that made it — the
// user's own terminal, any tools, any permission mode — so it can already carry the contents of
// files this pane's boundary would refuse today. The boundary applies to what happens NEXT. So a row
// is SELECTED first, its disclosure is fetched and rendered in full, and only then is there a button
// that resumes anything. Declining is one click away at every point.
//
// LIKE THE PANE ITSELF, THIS FILE MAY NOT REACH `window.maestro.session`. Everything goes through
// `useSession()`. It also names no path of its own: every row, every read and every sentence here
// came off `ResumableSession` / `ResumeDisclosure`, which main built from the CLI's own store.

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Clock, FileText, GitBranch, History, Loader2, Play, X } from "lucide-react";
import { useSession } from "../utils/session-context";
import type { ResumableSession, ResumeDisclosure } from "../../../shared/ipc";

/** How long ago, in the register a list of conversations is read in. */
function ago(ms: number): string {
  if (!ms) return "unknown";
  const secs = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(ms).toISOString().slice(0, 10);
}

/** Transcript size, so "this one is enormous" is visible before the disclosure is even opened. */
function bytes(size: number): string {
  if (size >= 1_000_000) return `${(size / 1_000_000).toFixed(1)} MB`;
  if (size >= 1_000) return `${Math.round(size / 1_000)} kB`;
  return `${size} B`;
}

export default function ResumePicker({ onClose }: { onClose(): void }) {
  const session = useSession();
  const [selected, setSelected] = useState<ResumableSession | null>(null);
  const [disclosure, setDisclosure] = useState<ResumeDisclosure | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Re-read on open rather than keeping a list in step: a conversation the user left in their
  // terminal a minute ago belongs on it, and nothing here is expensive enough to cache.
  useEffect(() => {
    void session.loadResumable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = async (row: ResumableSession) => {
    setSelected(row);
    setDisclosure(null);
    setLoadingDetail(true);
    try {
      setDisclosure(await session.resumeDetail(row.id));
    } finally {
      setLoadingDetail(false);
    }
  };

  const confirm = async () => {
    if (!selected) return;
    const ok = await session.resume(selected.id);
    if (ok) onClose();
  };

  return (
    <div
      data-testid="session-resume"
      className="border-b border-(--line) bg-(--bg-elev) px-4 py-3 flex flex-col gap-2 max-h-[60vh] overflow-y-auto"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-subtle">
          Pick up a conversation from this project
        </p>
        <button
          type="button"
          data-testid="session-resume-close"
          onClick={onClose}
          aria-label="Close the conversation picker"
          className="flex h-5 w-5 items-center justify-center rounded text-subtle hover:text-(--ink) bg-transparent border-0 cursor-pointer focus:outline-none"
        >
          <X size={12} />
        </button>
      </div>

      {session.loadingResumable && (
        <p data-testid="session-resume-loading" className="m-0 text-[11px] text-(--ink-3)">
          Reading Claude Code&apos;s session store…
        </p>
      )}

      {!session.loadingResumable && session.resumable.length === 0 && (
        <p data-testid="session-resume-empty" className="m-0 text-[11px] text-(--ink-3)">
          No recorded conversations for this project. Sessions you start in your terminal here — and the ones this pane
          runs — appear in this list.
        </p>
      )}

      {!selected && (
        <div data-testid="session-resume-list" data-count={session.resumable.length} className="flex flex-col gap-1">
          {session.resumable.map((row) => (
            <button
              key={row.id}
              type="button"
              data-testid="session-resume-item"
              data-id={row.id}
              onClick={() => void select(row)}
              className="w-full rounded-lg border border-(--line) bg-(--bg) px-2.5 py-2 text-left hover:border-primary/50 cursor-pointer focus:outline-none"
            >
              <p className="m-0 text-[12px] font-medium text-(--ink) truncate">{row.summary}</p>
              {/*
                THE FIRST PROMPT SITS BESIDE THE SUMMARY, not behind it. A summary is the model's
                reading of a conversation; the sentence the person actually typed is the one they
                will recognise, and it is what tells them whether the summary is describing what
                they think it is.
              */}
              {row.firstPrompt && (
                <p data-testid="session-resume-first-prompt" className="m-0 mt-0.5 text-[10px] text-(--ink-3) truncate">
                  “{row.firstPrompt}”
                </p>
              )}
              <p className="m-0 mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-subtle">
                <span className="inline-flex items-center gap-1">
                  <Clock size={9} /> {ago(row.lastModified)}
                </span>
                {row.branch && (
                  <span data-testid="session-resume-branch" className="inline-flex items-center gap-1">
                    <GitBranch size={9} /> {row.branch}
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <FileText size={9} /> {bytes(row.sizeBytes)}
                </span>
              </p>
              <p
                data-testid="session-resume-cwd"
                className="m-0 mt-0.5 font-mono text-[9px] text-(--ink-3) truncate"
                title={row.cwd}
              >
                {row.cwd}
              </p>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <Disclosure
          row={selected}
          disclosure={disclosure}
          loading={loadingDetail}
          resuming={session.resuming}
          onBack={() => {
            setSelected(null);
            setDisclosure(null);
          }}
          onConfirm={() => void confirm()}
        />
      )}
    </div>
  );
}

/**
 * What that conversation already read, what replaying it costs, and the two buttons.
 *
 * THE OUT-OF-SCOPE READS ARE LISTED FIRST AND IN AMBER, because they are the whole point of this
 * screen: they are the paths the pane's boundary would refuse today whose contents are already in
 * the transcript, and they are exactly the set the resumed session will start raising prompts about
 * — it arrives with no grants, which is correct rather than an omission.
 */
function Disclosure({
  row,
  disclosure,
  loading,
  resuming,
  onBack,
  onConfirm,
}: {
  row: ResumableSession;
  disclosure: ResumeDisclosure | null;
  loading: boolean;
  resuming: boolean;
  onBack(): void;
  onConfirm(): void;
}) {
  return (
    <div data-testid="session-resume-disclosure" data-id={row.id} className="flex flex-col gap-2">
      <div className="rounded-lg border border-(--line) bg-(--bg) px-2.5 py-2">
        <p className="m-0 text-[12px] font-medium text-(--ink)">{row.summary}</p>
        {row.firstPrompt && <p className="m-0 mt-0.5 text-[10px] text-(--ink-3)">“{row.firstPrompt}”</p>}
        <p className="m-0 mt-1 font-mono text-[9px] text-(--ink-3) truncate" title={row.cwd}>
          {row.cwd}
          {row.branch ? ` · ${row.branch}` : ""}
        </p>
      </div>

      {loading && (
        <p
          data-testid="session-resume-detail-loading"
          className="m-0 flex items-center gap-1.5 text-[11px] text-(--ink-3)"
        >
          <Loader2 size={11} className="animate-spin" /> Reading the transcript…
        </p>
      )}

      {disclosure && (
        <>
          <div
            data-testid="session-resume-reads"
            data-count={disclosure.reads.length}
            data-outside={disclosure.outside}
            className="flex flex-col gap-1"
          >
            <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-subtle">
              What this conversation already read
            </p>
            {disclosure.reads.length === 0 && (
              <p className="m-0 text-[11px] text-(--ink-3)">Its own tool calls read no files.</p>
            )}
            {disclosure.reads.map((read) => (
              <p
                key={read.path}
                data-testid="session-resume-read"
                data-in-scope={read.inScope}
                className={`m-0 flex items-start gap-1.5 font-mono text-[10px] break-all ${
                  read.inScope ? "text-(--ink-2)" : "text-amber-500"
                }`}
              >
                {read.inScope ? (
                  <Check size={10} className="mt-px shrink-0" />
                ) : (
                  <AlertTriangle size={10} className="mt-px shrink-0" />
                )}
                <span>
                  {read.path} <span className="text-(--ink-3)">· {read.tool}</span>
                </span>
              </p>
            ))}
            {disclosure.more > 0 && (
              <p className="m-0 text-[10px] text-(--ink-3)">…and {disclosure.more} more, not listed.</p>
            )}
            <p data-testid="session-resume-read-note" className="m-0 mt-0.5 text-[10px] text-(--ink-3)">
              {disclosure.readNote}
            </p>
          </div>

          <p
            data-testid="session-resume-replay"
            data-tokens={disclosure.replayTokens}
            className="m-0 text-[10px] text-(--ink-2)"
          >
            {disclosure.replayNote}
          </p>
          <p data-testid="session-resume-scope-note" className="m-0 text-[10px] text-(--ink-3)">
            {disclosure.scopeNote}
          </p>
        </>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          data-testid="session-resume-confirm"
          disabled={resuming || loading}
          onClick={onConfirm}
          className="inline-flex items-center gap-1 rounded-md border-0 bg-primary px-2.5 py-1 text-[11px] text-white hover:brightness-110 disabled:opacity-40 cursor-pointer focus:outline-none"
        >
          <Play size={11} /> {resuming ? "Resuming…" : "Resume a fork of this"}
        </button>
        {/*
          DECLINING IS A BUTTON, not an X in a corner. `025` requires that the user can say no after
          being shown what the transcript carries, so the refusal is as reachable as the acceptance.
        */}
        <button
          type="button"
          data-testid="session-resume-decline"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-md border border-(--line) bg-(--bg) px-2.5 py-1 text-[11px] text-(--ink-2) hover:text-(--ink) cursor-pointer focus:outline-none"
        >
          <History size={11} /> Don&apos;t resume this
        </button>
      </div>
    </div>
  );
}
