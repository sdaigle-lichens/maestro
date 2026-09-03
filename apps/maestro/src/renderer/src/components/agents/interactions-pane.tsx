// /agents right pane — the agent's resolved report, under an instance header.
//
// The header row ("Main Session" + its own pencil) is the seam this pane exists in the shape it
// does for: a Maestro agent can be instantiated more than once in a workflow, and the next change
// here turns this into a LIST of header + body pairs, one per interaction instance. Today there is
// exactly one report per agent — `report-resolution.ts` resolves project override, else global
// default, else none — so there is exactly one pair.
//
// The pane has no Save of its own on purpose. It shares the card's edit session: the card's Save
// commits the report alongside the description, type, tag, skills and avatar, and Cancel discards
// all of it together.

import { useEffect, useRef } from "react";
import { PanelRightClose, PanelRightOpen, Pencil } from "lucide-react";
import { ICON_BUTTON, PENCIL_BUTTON, PRIMARY_CHIP, RIGHT_PANE_MAX, RIGHT_PANE_MIN } from "./agent-shared";

export default function InteractionsPane({
  report,
  editing,
  open,
  width,
  note,
  onToggleOpen,
  onStartEdit,
  onReport,
  onWidth,
}: {
  report: string;
  editing: boolean;
  open: boolean;
  width: number;
  note: string | null;
  onToggleOpen: () => void;
  onStartEdit: () => void;
  onReport: (value: string) => void;
  onWidth: (width: number) => void;
}) {
  const asideRef = useRef<HTMLElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Grow the editor to its whole content so the PANE scrolls rather than a box inside it. A report
   * is a long prompt; a fixed-height textarea inside a scrolling pane gives you two scrollbars and
   * neither of them reaches the end.
   */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 4}px`;
  }, [report, editing, open, width]);

  /**
   * The drag writes the width straight to the DOM and only tells React on mouseup. A setState per
   * mousemove would re-render the whole page — card, list, both canvases — on every pixel.
   */
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const start = asideRef.current?.getBoundingClientRect().width ?? width;
    let latest = width;
    const move = (ev: MouseEvent) => {
      latest = Math.max(RIGHT_PANE_MIN, Math.min(RIGHT_PANE_MAX, start + (startX - ev.clientX)));
      if (asideRef.current) asideRef.current.style.width = `${latest}px`;
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.style.userSelect = "";
      onWidth(latest);
    };
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  return (
    <aside
      ref={asideRef}
      style={{ width }}
      className="relative flex-none min-h-0 flex flex-col border-l border-(--line) bg-(--pane)"
    >
      <div
        onMouseDown={startResize}
        title="Drag to resize"
        className="absolute -left-[3px] top-0 bottom-0 w-1.5 z-10 cursor-col-resize hover:bg-(--primary-dim-2)"
      />
      <div className="flex-none flex items-center gap-2 pt-[14px] px-4 pb-[10px]">
        <span className="text-[15px] font-semibold tracking-[-0.01em]">Interactions</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onToggleOpen}
          title={open ? "Collapse panel" : "Expand panel"}
          className={`w-6 h-6 flex-none ${ICON_BUTTON}`}
        >
          {open ? <PanelRightClose size={13} /> : <PanelRightOpen size={13} />}
        </button>
      </div>

      {open && (
        <>
          <div className="flex-none px-4 pb-[10px] flex items-center gap-2">
            <span className={`${PRIMARY_CHIP} text-[11.5px] px-[7px] py-0.5`}>Main Session</span>
            <span className="flex-1" />
            {!editing && (
              <button type="button" onClick={onStartEdit} title="Edit this interaction" className={PENCIL_BUTTON}>
                <Pencil size={12} />
              </button>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-3.5 flex flex-col gap-2.5">
            {editing ? (
              <textarea
                ref={textareaRef}
                value={report}
                onChange={(e) => onReport(e.target.value)}
                placeholder="No report configured for this agent. Write one here — saving creates this project's override."
                className="flex-none w-full overflow-hidden resize-none p-3 rounded-[10px] bg-(--bg-2) border border-(--line-2) text-(--ink) font-mono text-[11.5px] leading-[1.65] outline-none focus:border-(--primary)"
              />
            ) : (
              // Content height, capped at half the pane, with the clipped tail faded rather than
              // cut — a hard edge reads as the end of the report, which it isn't.
              <pre
                className="flex-[0_1_auto] max-h-[50%] m-0 overflow-hidden p-3 rounded-[10px] bg-(--sunken) border border-(--line) text-(--ink-2) font-mono text-[11.5px] leading-[1.65] whitespace-pre-wrap"
                style={{
                  maskImage: "linear-gradient(#000 78%, transparent)",
                  WebkitMaskImage: "linear-gradient(#000 78%, transparent)",
                }}
              >
                {report || "No report configured for this agent."}
              </pre>
            )}
            {note && <p className="m-0 text-[10.5px] leading-[1.55] text-(--ink-3) text-pretty">{note}</p>}
          </div>
        </>
      )}
    </aside>
  );
}
