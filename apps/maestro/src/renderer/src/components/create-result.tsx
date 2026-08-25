import { Check, FolderOpen, GitBranch, Terminal } from "lucide-react";
import type { CreateOutcome } from "../utils/create-flow";

/**
 * What the last submit put on disk.
 *
 * It names the files, because that is the difference between this and the web app: there, a submit
 * wrote a result file and a Claude session did the rest somewhere the user could not see, so the
 * toast could only say "submitted — generating now". Here the artifact exists by the time this
 * renders, and it can be opened.
 *
 * **Finish with Claude** stays available even after the confirmation was auto-opened and cancelled
 * — changing your mind about a run is not the same as never wanting one — and is the only route
 * from this page to a model.
 */
export default function CreateResult({
  outcome,
  busy,
  onFinish,
}: {
  outcome: CreateOutcome;
  busy: boolean;
  onFinish: () => void;
}) {
  const { result } = outcome;
  return (
    <div className="mb-4 p-4 rounded-lg border border-(--green)/40 bg-(--green-dim) flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-(--ink)">
        <Check size={14} className="text-(--green)" />
        Written to disk
      </div>

      <ul className="list-none p-0 m-0 flex flex-col gap-0.5">
        {result.written.map((file) => (
          <li key={file} className="font-mono text-[11px] text-(--ink-2) break-all">
            {file}
          </li>
        ))}
      </ul>

      {/*
        The repository is reported whether or not one was made. "It is a repo and everything is
        committed", "it was already inside one", and "git is not on this machine" are three states
        the user cannot tell apart by looking at the folder, and the last two are not failures —
        the marketplace is complete in all three.
      */}
      {result.repo && (
        <div className="flex items-start gap-1.5 text-[12px] text-(--ink-2)">
          <GitBranch size={13} className={`mt-0.5 shrink-0 ${result.repo.initialized ? "text-(--green)" : ""}`} />
          <span>{result.repo.note}</span>
        </div>
      )}

      {result.remaining && <p className="text-[12px] text-(--ink-2) m-0">{result.remaining}</p>}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => void window.maestro.shell.reveal(result.path)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-(--line) bg-(--bg-elev) px-3 py-1.5 text-[12px] font-medium text-(--ink-2) hover:text-(--ink) cursor-pointer focus:outline-none"
        >
          <FolderOpen size={13} /> Show in folder
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onFinish}
          className="inline-flex items-center gap-1.5 rounded-lg border border-primary bg-(--primary-dim) px-3 py-1.5 text-[12px] font-medium text-(--ink) hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus:outline-none"
        >
          <Terminal size={13} /> Finish with Claude
        </button>
      </div>
    </div>
  );
}
