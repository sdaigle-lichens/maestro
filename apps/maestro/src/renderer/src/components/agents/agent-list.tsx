// /agents left pane — the agent list.
//
// Deliberately NOT `DiscoveredDefinitionsList` (still shared with /skills): this list carries an
// avatar thumb and a per-row pencil, neither of which a skill has, and threading them through the
// shared table would mean special-casing agents inside a component /skills also renders.

import { PanelLeftClose, PanelLeftOpen, Pencil } from "lucide-react";
import { Link } from "@tanstack/react-router";
import AvatarCanvas from "../avatar/avatar-canvas";
import { clampText, ICON_BUTTON, PENCIL_BUTTON, PRIMARY_CHIP } from "./agent-shared";
import type { AvatarLayers } from "../../../../shared/ipc";

export interface AgentListItem {
  id: string;
  description: string;
  layers: AvatarLayers;
  /** The tier `discoverAgents` resolved this agent from — "project", "user", "maestro", or a plugin name. */
  source: string;
}

/**
 * One row. Extracted so the two sections below render identically — the split is what makes each
 * section exhaustive and non-overlapping, not a difference in how a row looks.
 */
function AgentRow({
  agent,
  selected,
  onSelect,
  onEdit,
}: {
  agent: AgentListItem;
  selected: string | null;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  return (
    <div
      onClick={() => onSelect(agent.id)}
      className="relative p-[11px] rounded-[10px] border border-(--line) bg-(--bg-2) cursor-pointer transition-colors duration-[120ms] hover:border-(--line-2)"
    >
      {/*
        The selected state is an overlay at -1px rather than a border colour on the card itself, so
        the card keeps its own border and the primary ring sits exactly on top of it instead of
        replacing it. pointer-events-none or it eats the row's click.
      */}
      {agent.id === selected && (
        <span
          aria-hidden
          className="absolute -inset-px rounded-[10px] border border-(--primary) bg-(--primary-dim) pointer-events-none"
        />
      )}
      <div className="relative flex items-center justify-between gap-2 mb-2">
        <span className={`${PRIMARY_CHIP} text-[13px] px-2 py-0.5`}>{agent.id}</span>
        <button
          type="button"
          title="Edit this agent"
          onClick={(e) => {
            // Without this the row's own onClick also fires and resets the mode to view.
            e.stopPropagation();
            onEdit(agent.id);
          }}
          className={PENCIL_BUTTON}
        >
          <Pencil size={12} />
        </button>
      </div>
      <div className="relative flex gap-[10px] items-start">
        <div className="relative flex-none w-[52px] h-[52px] rounded-lg border border-(--line) bg-(--pane) overflow-hidden">
          <AvatarCanvas layers={agent.layers} fill />
        </div>
        <p title={agent.description} className="m-0 text-[12.5px] leading-[1.45] text-(--ink-3) text-pretty">
          {clampText(agent.description)}
        </p>
      </div>
    </div>
  );
}

/** A left-pane section header — "Project" / "Global" — shown only when its section has rows. */
function SectionLabel({ children }: { children: string }) {
  return (
    <p className="m-0 mt-1 mb-0.5 px-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-(--ink-3)">
      {children}
    </p>
  );
}

export default function AgentList({
  items,
  selected,
  open,
  query,
  onQueryChange,
  onToggleOpen,
  onSelect,
  onEdit,
}: {
  items: AgentListItem[];
  selected: string | null;
  open: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  onToggleOpen: () => void;
  onSelect: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  // `discoverAgents` runs `dedupeById` over project → user → bundled → plugins, first wins, so an
  // agent appears exactly once, in its winning tier — which is what makes this split exhaustive
  // and non-overlapping for free, with no third bucket to account for.
  const projectItems = items.filter((a) => a.source === "project");
  const globalItems = items.filter((a) => a.source !== "project");

  return (
    <aside className="flex-none w-[292px] min-h-0 flex flex-col border-r border-(--line) bg-(--pane)">
      <div className="flex-none flex items-center gap-2 pt-[14px] px-4 pb-[10px]">
        <button
          type="button"
          onClick={onToggleOpen}
          title={open ? "Collapse panel" : "Expand panel"}
          className={`w-6 h-6 flex-none ${ICON_BUTTON}`}
        >
          {open ? <PanelLeftClose size={13} /> : <PanelLeftOpen size={13} />}
        </button>
        <span className="text-[15px] font-semibold tracking-[-0.01em]">Agents</span>
      </div>

      {open && (
        <>
          <div className="flex-none px-4 pb-[10px]">
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Filter agents…"
              className="w-full h-[30px] px-[10px] rounded-md bg-(--bg-2) border border-(--line) text-(--ink) text-[12px] outline-none placeholder:text-(--ink-3) focus:border-(--primary) focus:bg-(--bg-3)"
            />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-3 flex flex-col gap-[10px]">
            {items.length === 0 && (
              <p className="m-0 text-[12px] text-(--ink-3)">
                {query ? "No agent matches that filter." : "No agents discovered for this project."}
              </p>
            )}

            {projectItems.length > 0 && (
              <>
                <SectionLabel>Project</SectionLabel>
                {projectItems.map((agent) => (
                  <AgentRow key={agent.id} agent={agent} selected={selected} onSelect={onSelect} onEdit={onEdit} />
                ))}
              </>
            )}

            {globalItems.length > 0 && (
              <>
                <SectionLabel>Global</SectionLabel>
                {globalItems.map((agent) => (
                  <AgentRow key={agent.id} agent={agent} selected={selected} onSelect={onSelect} onEdit={onEdit} />
                ))}
              </>
            )}

            <Link
              to="/create-subagent"
              className="flex items-center justify-center gap-1.5 h-8 rounded-lg border border-dashed border-(--line-2) text-(--ink-3) text-[12px] no-underline transition-colors duration-[120ms] hover:text-(--primary) hover:border-(--primary)"
            >
              + New agent
            </Link>
          </div>
        </>
      )}
    </aside>
  );
}
