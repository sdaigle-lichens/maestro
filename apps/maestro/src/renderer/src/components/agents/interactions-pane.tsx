// /agents right pane — a LIST of header + body pairs: the agent's resolved report first, then one
// entry per outgoing handoff route the project's workflow graph wires (`034`).
//
// The seam the header row was built for is now filled. "Main Session" is the report — what the
// agent is told to emit back to the orchestrator — and each `→ receiver` entry below it is the
// `handoff_details` protocol for one route leaving this agent, resolved through `033`'s three
// tiers. Every entry says which tier its content came from, including "none": a wired route with
// no template anywhere is a real gap, and this pane is where it is visible rather than a silence.
//
// A route whose edge reaches no agent (a dangling edge, a condition into `human_review`) still
// gets a header and gets NO editor — there is no `(sender, receiver)` pair to key a template on.
//
// The pane has no Save of its own on purpose. It shares the card's edit session: the card's Save
// commits the report AND every changed handoff alongside the description, type, tag, skills and
// avatar, and Cancel discards all of it together.

import { useEffect, useRef, useState } from "react";
import { ArrowRight, PanelRightClose, PanelRightOpen, Pencil } from "lucide-react";
import { ICON_BUTTON, PENCIL_BUTTON, PRIMARY_CHIP, RIGHT_PANE_MAX, RIGHT_PANE_MIN } from "./agent-shared";
import type { ResolvedHandoffRoute } from "../../../../shared/ipc";

type PaneTab = "interactions" | "content";

const TAB_BUTTON =
  "h-[26px] px-[10px] rounded-md text-[11.5px] cursor-pointer transition-colors duration-[120ms] border";
const TAB_BUTTON_ACTIVE = "bg-(--primary-dim) border-(--primary-dim-2) text-(--primary)";
const TAB_BUTTON_INACTIVE = "bg-transparent border-transparent text-(--ink-2) hover:text-(--ink) hover:bg-(--bg-3)";

/** The tier a body resolved from, in the pane's own words. Four cases — see `ResolvedHandoff`. */
const HANDOFF_TIER: Record<ResolvedHandoffRoute["source"], string> = {
  project: "Project override",
  global: "Global default",
  seed: "Shipped by Maestro",
  none: "No protocol configured",
};

export default function InteractionsPane({
  report,
  reportNote,
  routes,
  content,
  contentEditable,
  contentNote,
  handoffs,
  editing,
  open,
  width,
  onToggleOpen,
  onStartEdit,
  onReport,
  onContent,
  onHandoff,
  onWidth,
}: {
  report: string;
  reportNote: string | null;
  /** The routes leaving the selected agent, in the graph walk's own order. */
  routes: ResolvedHandoffRoute[];
  /**
   * The selected agent's markdown body — everything after the closing frontmatter `---` — for the
   * Content tab. The DRAFT value while editing (`045`), same as `report`/`handoffs` below.
   */
  content: string;
  /** Whether the Content tab's body may be edited — project-tier only, same gate as the description. */
  contentEditable: boolean;
  /** Why the Content tab is locked, when it is. Null when `contentEditable`. */
  contentNote: string | null;
  /** The DRAFT bodies, keyed by handoff id — what the editors show and what Save compares. */
  handoffs: Record<string, string>;
  editing: boolean;
  open: boolean;
  width: number;
  onToggleOpen: () => void;
  onStartEdit: () => void;
  onReport: (value: string) => void;
  onContent: (value: string) => void;
  onHandoff: (handoffId: string, value: string) => void;
  onWidth: (width: number) => void;
}) {
  const asideRef = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<PaneTab>("interactions");

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
        <div className="flex-none flex items-center gap-1.5 px-4 pb-3" data-testid="interactions-tabs">
          <button
            type="button"
            data-testid="interactions-tab-interactions"
            onClick={() => setTab("interactions")}
            className={`${TAB_BUTTON} ${tab === "interactions" ? TAB_BUTTON_ACTIVE : TAB_BUTTON_INACTIVE}`}
          >
            Interactions
          </button>
          <button
            type="button"
            data-testid="interactions-tab-content"
            onClick={() => setTab("content")}
            className={`${TAB_BUTTON} ${tab === "content" ? TAB_BUTTON_ACTIVE : TAB_BUTTON_INACTIVE}`}
          >
            Content
          </button>
        </div>
      )}

      {open && tab === "content" && (
        // Everything after the closing frontmatter `---`, resolved through the same tier order the
        // description editor walks (`044`). Editable via a textarea when `contentEditable` (`045`)
        // — same project-tier gate as the description — with its own pencil so the tab can start
        // the card's edit session without switching tabs first.
        <div data-testid="agent-content" className="flex-1 min-h-0 overflow-y-auto px-4 pb-3.5 flex flex-col gap-2.5">
          {!editing && contentEditable && (
            <div className="flex-none flex items-center justify-end">
              <button type="button" onClick={onStartEdit} title="Edit this agent's content" className={PENCIL_BUTTON}>
                <Pencil size={12} />
              </button>
            </div>
          )}
          {editing && contentEditable ? (
            <textarea
              data-testid="agent-content-editor"
              value={content}
              onChange={(e) => onContent(e.target.value)}
              placeholder="This agent has no content yet."
              className="flex-1 min-h-0 w-full resize-none p-3 rounded-[10px] bg-(--bg-2) border border-(--line-2) text-(--ink) font-mono text-[11.5px] leading-[1.65] outline-none focus:border-(--primary)"
            />
          ) : (
            <pre className="flex-1 min-h-0 m-0 overflow-y-auto whitespace-pre-wrap p-3 rounded-[10px] bg-(--sunken) border border-(--line) text-(--ink-2) font-mono text-[11.5px] leading-[1.65]">
              {content || "No content."}
            </pre>
          )}
          {contentNote && <p className="m-0 text-[10.5px] leading-[1.55] text-(--ink-3) text-pretty">{contentNote}</p>}
        </div>
      )}

      {open && tab === "interactions" && (
        // ONE scroll region for the whole list. Each entry's editor grows to its own content (see
        // `Entry`), so the pane scrolls rather than every box inside it — a page with six routes
        // would otherwise give you seven scrollbars.
        <div
          data-testid="interactions-list"
          data-routes={routes.length}
          className="flex-1 min-h-0 overflow-y-auto px-4 pb-3.5 flex flex-col gap-4"
        >
          <Entry
            header={<span className={`${PRIMARY_CHIP} text-[11.5px] px-[7px] py-0.5`}>Main Session</span>}
            value={report}
            editable
            editing={editing}
            placeholder="No report configured for this agent. Write one here — saving creates this project's override."
            emptyText="No report configured for this agent."
            note={reportNote}
            onChange={onReport}
            onStartEdit={onStartEdit}
          />

          {routes.map((route) => {
            const id = route.handoffId;
            const value = id ? (handoffs[id] ?? route.content) : "";
            // The route's payload is no longer a JSON field the agent returns (`036`) — it is the
            // content of the file its own SubagentStart writes into the receiver's lane. Only
            // routes with a receiver have one to name.
            const lanePath = route.receiver ? `.claude/channels/${route.receiver}/${route.sender}.1.md` : null;
            return (
              <Entry
                key={`${route.label}:${route.receiver ?? "—"}`}
                testId={id ?? undefined}
                header={
                  <span className="inline-flex items-center gap-1 font-mono text-[11.5px] text-(--ink-2)">
                    <ArrowRight size={11} className="text-(--ink-3)" />
                    {route.receiver ?? "nowhere"}
                    {route.label !== "success" && <span className="text-(--ink-3) not-italic"> · {route.label}</span>}
                  </span>
                }
                value={value}
                // A route with no receiver has no pair, so there is nothing a save could write.
                editable={id !== null}
                editing={editing}
                placeholder="No handoff protocol for this route. Write one here — saving creates this project's override."
                emptyText={
                  id
                    ? "No handoff protocol for this route — this agent hands off with no payload shape."
                    : "This edge reaches no agent, so there is no protocol to attach to it."
                }
                note={id ? HANDOFF_TIER[route.source] : "Unrouted edge"}
                lanePath={lanePath}
                onChange={(v) => id && onHandoff(id, v)}
                onStartEdit={onStartEdit}
              />
            );
          })}
        </div>
      )}
    </aside>
  );
}

/**
 * One header + body pair. The pencil is per entry and they all start the SAME edit session — the
 * card's — because that session is what Save and Cancel act on; a per-entry save would be a
 * seventh place a partial write could land without the card knowing.
 */
function Entry({
  header,
  testId,
  value,
  editable,
  editing,
  placeholder,
  emptyText,
  note,
  lanePath,
  onChange,
  onStartEdit,
}: {
  header: React.ReactNode;
  testId?: string;
  value: string;
  editable: boolean;
  editing: boolean;
  placeholder: string;
  emptyText: string;
  note: string | null;
  /** Where this route's template lands at runtime (`036`) — null for the report entry. */
  lanePath?: string | null;
  onChange: (value: string) => void;
  onStartEdit: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const open = editing && editable;

  /**
   * Grow the editor to its whole content so the PANE scrolls rather than a box inside it. A
   * protocol is a long prompt; a fixed-height textarea inside a scrolling pane gives you two
   * scrollbars and neither of them reaches the end.
   */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 4}px`;
  }, [value, open]);

  return (
    <div data-testid={testId ? `interaction-${testId}` : undefined} className="flex flex-col gap-2.5">
      <div className="flex-none flex items-center gap-2">
        {header}
        <span className="flex-1" />
        {!editing && editable && (
          <button type="button" onClick={onStartEdit} title="Edit this interaction" className={PENCIL_BUTTON}>
            <Pencil size={12} />
          </button>
        )}
      </div>

      {open ? (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-none w-full overflow-hidden resize-none p-3 rounded-[10px] bg-(--bg-2) border border-(--line-2) text-(--ink) font-mono text-[11.5px] leading-[1.65] outline-none focus:border-(--primary)"
        />
      ) : (
        // Content height, capped at 320px, with the clipped tail faded rather than cut — a hard
        // edge reads as the end of the body, which it isn't.
        <pre
          className="flex-none m-0 max-h-[320px] overflow-hidden p-3 rounded-[10px] bg-(--sunken) border border-(--line) text-(--ink-2) font-mono text-[11.5px] leading-[1.65] whitespace-pre-wrap"
          style={{
            maskImage: "linear-gradient(#000 78%, transparent)",
            WebkitMaskImage: "linear-gradient(#000 78%, transparent)",
          }}
        >
          {value || emptyText}
        </pre>
      )}
      {note && <p className="m-0 text-[10.5px] leading-[1.55] text-(--ink-3) text-pretty">{note}</p>}
      {lanePath && <p className="m-0 text-[10.5px] leading-[1.55] text-(--ink-3) font-mono truncate">→ {lanePath}</p>}
    </div>
  );
}
