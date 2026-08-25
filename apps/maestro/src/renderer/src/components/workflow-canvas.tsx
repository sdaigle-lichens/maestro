import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { MaestroWorkflowV3, MaestroNodeV3, MaestroEdgeV3, MaestroInstanceV3 } from "../utils/maestro";
import InstancePicker, {
  blankInstancePicker,
  resolveInstanceFromPicker,
  type InstancePickerValue,
} from "./instance-picker";
import InstanceSkillPicker from "./instance-skill-picker";
import { Check } from "lucide-react";

import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  Panel,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  ConnectionMode,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  useReactFlow,
  type Node,
  type Edge,
  type NodeProps,
  type EdgeProps,
  type Connection,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";

interface WorkflowCanvasProps {
  workflow: MaestroWorkflowV3 | null;
  /** Pass activeWorkflowIdx so the canvas can detect a workflow switch and bypass the echo guard. */
  workflowKey: number;
  availableAgents: string[];
  availableSkills: string[];
  instances: MaestroInstanceV3[];
  onChange: (w: MaestroWorkflowV3) => void;
  onInstancesChange: (instances: MaestroInstanceV3[]) => void;
}

// Vertical gap between a node and the step added below it.
const INSERT_ROW_HEIGHT = 160;

// ── Dagre layout ────────────────────────────────────────────────────

// Estimated rendered height of a node, so dagre spaces skill-heavy agent nodes apart
// instead of overlapping them. Each skill chip wraps onto ~its own row (~30px).
function dagreNodeHeight(n: Node): number {
  const inst = n.data?.instanceData as MaestroInstanceV3 | undefined;
  const skills = (inst?.loaded_skills?.length ?? 0) + (inst?.referenced_skills?.length ?? 0);
  return 60 + skills * 30;
}

function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", ranksep: 80, nodesep: 60 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: 180, height: dagreNodeHeight(n) });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  return nodes.map((n) => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - 90, y: pos.y - dagreNodeHeight(n) / 2 } };
  });
}

// ── Helpers: MaestroWorkflowV3 <-> React Flow ──────────────────────────

function workflowToRfNodes(workflow: MaestroWorkflowV3, instances: MaestroInstanceV3[]): Node[] {
  const nodes: Node[] = [
    {
      id: "main-session",
      type: "mainSession",
      position: { x: 0, y: 0 },
      data: {},
      deletable: false,
    },
  ];
  for (const n of workflow.nodes) {
    const instanceData = n.type === "agent" ? instances.find((i) => i.name === n.instance) : undefined;
    const rfType = n.type === "agent" ? "agentNode" : n.type === "skill" ? "skillNode" : "humanStep";
    nodes.push({
      id: n.id,
      type: rfType,
      position: n.position ?? { x: 0, y: 0 },
      data: { maestroNode: n, instanceData },
    });
  }
  return nodes;
}

function workflowToRfEdges(workflow: MaestroWorkflowV3): Edge[] {
  return workflow.edges.map((e, i) => ({
    id: `e-${e.from}-${e.to}-${i}`,
    source: e.from,
    sourceHandle: e.sourceHandle ?? (e.kind === "condition" ? "right" : "bottom"),
    target: e.to,
    targetHandle: e.targetHandle ?? "top",
    type: e.kind === "condition" ? "conditionEdge" : "successEdge",
    label: e.label,
    animated: e.kind === "condition",
    style: e.kind === "condition" ? { stroke: "#f97316", strokeDasharray: "5 4" } : undefined,
    data: { maestroEdge: e },
  }));
}

function rfNodesToMaestroNodes(nodes: Node[]): MaestroNodeV3[] {
  return nodes
    .filter((n) => n.id !== "main-session")
    .map((n) => {
      const maestro = n.data.maestroNode as MaestroNodeV3;
      return {
        id: maestro.id,
        type: maestro.type,
        instance: maestro.instance,
        skill: maestro.skill,
        position: n.position,
      };
    });
}

function rfEdgesToMaestroEdges(edges: Edge[]): MaestroEdgeV3[] {
  return edges.map((e) => {
    const maestro = e.data?.maestroEdge as MaestroEdgeV3 | undefined;
    return {
      from: e.source,
      to: e.target,
      kind: (maestro?.kind ?? (e.type === "conditionEdge" ? "condition" : "success")) as "success" | "condition",
      label: typeof e.label === "string" ? e.label : maestro?.label,
      label_offset: maestro?.label_offset,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
    };
  });
}

function isSuccessEdge(e: Edge): boolean {
  return (
    e.type === "successEdge" ||
    ((e.data as Record<string, unknown> | undefined)?.maestroEdge as MaestroEdgeV3 | undefined)?.kind === "success"
  );
}

// Walk the success path from main-session; the last node reached is the terminal
function findSuccessTerminalId(edges: Edge[]): string {
  let terminalId = "main-session";
  const visited = new Set<string>();
  while (!visited.has(terminalId)) {
    visited.add(terminalId);
    const next = edges.find((e) => e.source === terminalId && isSuccessEdge(e));
    if (!next) break;
    terminalId = next.target;
  }
  return terminalId;
}

// Strip any existing outgoing success edge from a given source node.
// Enforces the "at most one success edge per node" constraint.
function replaceSuccessEdgeFrom(edges: Edge[], sourceId: string): Edge[] {
  return edges.filter((e) => !(e.source === sourceId && isSuccessEdge(e)));
}

// Build a success edge (bottom → top) between two nodes.
function makeSuccessEdge(from: string, to: string): Edge {
  return {
    id: `e-${from}-${to}`,
    source: from,
    sourceHandle: "bottom",
    target: to,
    targetHandle: "top",
    type: "successEdge",
    data: {
      maestroEdge: {
        from,
        to,
        kind: "success",
        sourceHandle: "bottom",
        targetHandle: "top",
      } as MaestroEdgeV3,
    },
  };
}

// Generate a unique human-review node id of the form "human_review-N"
function nextHumanId(nodes: Node[]): string {
  let n = 1;
  while (nodes.some((nd) => nd.id === `human_review-${n}`)) n++;
  return `human_review-${n}`;
}

// Generate a unique skill-step node id of the form "skill-N"
function nextSkillId(nodes: Node[]): string {
  let n = 1;
  while (nodes.some((nd) => nd.id === `skill-${n}`)) n++;
  return `skill-${n}`;
}

// ── Node components (defined outside — stable references for React Flow) ──

function MainSessionNode({
  data,
}: NodeProps & {
  data: { onAddNext?: (id: string) => void };
}) {
  return (
    <>
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Left} id="left" style={{ top: "50%" }} />
      <Handle type="source" position={Position.Right} id="right" style={{ top: "50%" }} />
      <div className="relative select-none">
        <div className="w-48 rounded-2xl border-2 border-green-400 bg-green-100 shadow-sm">
          {/* Header row */}
          <div className="flex items-center px-2.5 py-2">
            <span className="text-green-800 text-[12px] font-semibold">Claude Main Session</span>
          </div>
        </div>
        {/* Bottom "+" — add next step */}
        <button
          type="button"
          style={{ position: "absolute", bottom: -10, left: "50%", transform: "translateX(-50%)" }}
          className="w-5 h-5 rounded-full bg-white border-2 border-green-400 text-green-600 text-[11px] font-bold flex items-center justify-center cursor-pointer z-10 shadow-sm hover:bg-green-50 focus:outline-none"
          onClick={(e) => {
            e.stopPropagation();
            data.onAddNext?.("main-session");
          }}
          title="Add next step"
        >
          +
        </button>
      </div>
      <Handle type="source" position={Position.Bottom} id="bottom" />
    </>
  );
}

function AgentNodeComponent({
  data,
}: NodeProps & {
  data: {
    maestroNode: MaestroNodeV3;
    instanceData?: MaestroInstanceV3;
    onAddConditionEdge?: (id: string) => void;
    onAddNext?: (id: string) => void;
    isPickingConditionSource?: boolean;
    isTerminal?: boolean;
    isSelectedInstance?: boolean;
  };
}) {
  const maestro = data.maestroNode;
  const inst = data.instanceData;
  const term = !!data.isTerminal;
  const selected = !!data.isSelectedInstance;

  const sideButtonClass = `w-5 h-5 rounded-full bg-white border-2 text-orange-500 text-[11px] font-bold flex items-center justify-center cursor-pointer z-10 shadow-sm focus:outline-none transition-all ${
    data.isPickingConditionSource
      ? "border-orange-500 animate-pulse scale-125"
      : "border-orange-300 hover:bg-orange-50 hover:border-orange-500"
  }`;

  // Terminal node renders green (task-complete); others orange.
  const cardClass = term
    ? `bg-green-50 text-green-900 ${selected ? "border-green-500" : "border-green-300"}`
    : `bg-orange-50 text-orange-900 ${selected ? "border-orange-500" : "border-orange-200"}`;
  const nameClass = term ? "text-green-900" : "text-orange-900";
  const subClass = term ? "text-green-600" : "text-orange-500";
  const chipClass = term
    ? "bg-green-100 border-green-300 text-green-700"
    : "bg-orange-100 border-orange-200 text-orange-700";

  return (
    <>
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Left} id="left" style={{ top: "50%" }} />
      <Handle type="source" position={Position.Right} id="right" style={{ top: "50%" }} />
      <div className="relative">
        {/* Left condition + button */}
        <button
          type="button"
          style={{ position: "absolute", left: -10, top: "50%", transform: "translateY(-50%)" }}
          className={sideButtonClass}
          onClick={(e) => {
            e.stopPropagation();
            data.onAddConditionEdge?.(maestro.id);
          }}
          title="Add condition from this node"
        >
          +
        </button>

        {/* Right condition + button */}
        <button
          type="button"
          style={{ position: "absolute", right: -10, top: "50%", transform: "translateY(-50%)" }}
          className={sideButtonClass}
          onClick={(e) => {
            e.stopPropagation();
            data.onAddConditionEdge?.(maestro.id);
          }}
          title="Add condition from this node"
        >
          +
        </button>

        <div className={`w-44 rounded-lg border-2 shadow-sm transition-colors ${cardClass}`}>
          <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
            <div className="flex flex-col min-w-0 flex-1">
              {/* Instance name (primary) */}
              <span className={`font-mono text-[12px] font-semibold truncate ${nameClass}`}>
                {maestro.instance ?? maestro.id}
              </span>
              {/* Agent name (secondary) */}
              {inst && <span className={`text-[10px] truncate font-mono ${subClass}`}>@{inst.agent}</span>}
            </div>
          </div>
          {/* Skill chips from instance: loaded (solid) auto-load at start; referenced (dashed) are available on demand. */}
          {inst && inst.loaded_skills.length + inst.referenced_skills.length > 0 && (
            <div className="px-2.5 pb-2 flex flex-wrap gap-1">
              {inst.loaded_skills.map((s) => (
                <span key={s} className={`px-1.5 py-0.5 rounded-full border text-[10px] font-mono ${chipClass}`}>
                  {s}
                </span>
              ))}
              {inst.referenced_skills.map((s) => (
                <span
                  key={s}
                  title="Referenced — loaded only if the task needs it"
                  className={`px-1.5 py-0.5 rounded-full border border-dashed text-[10px] font-mono opacity-70 ${chipClass}`}
                >
                  {s}
                </span>
              ))}
            </div>
          )}
        </div>
        {/* Bottom "+" — add next step */}
        <button
          type="button"
          style={{ position: "absolute", bottom: -10, left: "50%", transform: "translateX(-50%)" }}
          className={`w-5 h-5 rounded-full bg-white border-2 text-[11px] font-bold flex items-center justify-center cursor-pointer z-10 shadow-sm hover:opacity-80 focus:outline-none ${term ? "border-green-400 text-green-600" : "border-orange-300 text-orange-500"}`}
          onClick={(e) => {
            e.stopPropagation();
            data.onAddNext?.(maestro.id);
          }}
          title="Add next step"
        >
          +
        </button>
      </div>
      <Handle type="source" position={Position.Bottom} id="bottom" />
    </>
  );
}

function HumanStepNode({
  data,
  selected,
}: NodeProps & {
  data: {
    maestroNode: MaestroNodeV3;
    onDelete?: (id: string) => void;
    onAddNext?: (id: string) => void;
    onAddConditionEdge?: (id: string) => void;
    isPickingConditionSource?: boolean;
  };
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const maestro = data.maestroNode;

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as globalThis.Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // Side condition "+" buttons let a human-review step route corrections back to the
  // agent that produced the work under review (e.g. "human requested code corrections" → @backend).
  const sideButtonClass = `w-5 h-5 rounded-full bg-white border-2 text-orange-500 text-[11px] font-bold flex items-center justify-center cursor-pointer z-10 shadow-sm focus:outline-none transition-all ${
    data.isPickingConditionSource
      ? "border-orange-500 animate-pulse scale-125"
      : "border-orange-300 hover:bg-orange-50 hover:border-orange-500"
  }`;
  return (
    <>
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Left} id="left" style={{ top: "50%" }} />
      <Handle type="source" position={Position.Right} id="right" style={{ top: "50%" }} />
      <div className="relative" style={{ width: 120, height: 60 }}>
        {/* Left condition + button */}
        <button
          type="button"
          style={{ position: "absolute", left: -10, top: "50%", transform: "translateY(-50%)" }}
          className={sideButtonClass}
          onClick={(e) => {
            e.stopPropagation();
            data.onAddConditionEdge?.(maestro.id);
          }}
          title="Add condition from this node"
        >
          +
        </button>

        {/* Right condition + button */}
        <button
          type="button"
          style={{ position: "absolute", right: -10, top: "50%", transform: "translateY(-50%)" }}
          className={sideButtonClass}
          onClick={(e) => {
            e.stopPropagation();
            data.onAddConditionEdge?.(maestro.id);
          }}
          title="Add condition from this node"
        >
          +
        </button>

        <div
          className={`flex items-center justify-center border-2 bg-amber-50 text-amber-800 ${selected ? "border-amber-500" : "border-amber-300"}`}
          style={{ clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)", width: 120, height: 60 }}
        >
          <span className="text-[11px] font-medium text-amber-800">Review</span>
        </div>

        {/* Kebab menu — sibling of the clipped diamond so it isn't cut off by the clipPath */}
        <div className="absolute" style={{ right: -6, top: -14 }} ref={menuRef}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className="w-5 h-5 flex items-center justify-center rounded cursor-pointer focus:outline-none text-amber-500 hover:bg-amber-100"
            title="Step options"
          >
            ⋮
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-6 z-50 w-40 bg-(--bg) border border-(--line) rounded-lg shadow-lg py-1">
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 text-[12px] text-red-500 hover:bg-(--bg-elev) cursor-pointer"
                onClick={() => {
                  data.onDelete?.(maestro.id);
                  setMenuOpen(false);
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
        {/* Bottom "+" — add next step */}
        <button
          type="button"
          style={{ position: "absolute", bottom: -10, left: "50%", transform: "translateX(-50%)" }}
          className="w-5 h-5 rounded-full bg-white border-2 border-amber-400 text-amber-600 text-[11px] font-bold flex items-center justify-center cursor-pointer z-10 shadow-sm hover:bg-amber-50 focus:outline-none"
          onClick={(e) => {
            e.stopPropagation();
            data.onAddNext?.(maestro.id);
          }}
          title="Add next step"
        >
          +
        </button>
      </div>
      <Handle type="source" position={Position.Bottom} id="bottom" />
    </>
  );
}

function SkillNodeComponent({
  data,
  selected,
}: NodeProps & {
  data: {
    maestroNode: MaestroNodeV3;
    onDelete?: (id: string) => void;
    onChangeSkill?: (id: string) => void;
    onAddNext?: (id: string) => void;
  };
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const maestro = data.maestroNode;

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as globalThis.Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <>
      <Handle type="target" position={Position.Top} id="top" />
      <div className="relative">
        <div
          className={`w-44 rounded-lg border-2 shadow-sm bg-violet-50 text-violet-900 ${selected ? "border-violet-500" : "border-violet-300"}`}
        >
          <div className="flex items-center justify-between px-2.5 py-2">
            <span className="font-mono text-[12px] font-semibold truncate text-violet-800">
              /{maestro.skill ?? maestro.id}
            </span>
            <div className="relative ml-1 shrink-0" ref={menuRef}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
                className="w-5 h-5 flex items-center justify-center rounded cursor-pointer focus:outline-none text-violet-400 hover:bg-violet-100"
              >
                ⋮
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-6 z-50 w-40 bg-(--bg) border border-(--line) rounded-lg shadow-lg py-1">
                  <button
                    type="button"
                    className="w-full text-left px-3 py-1.5 text-[12px] text-(--ink-2) hover:bg-(--bg-elev) cursor-pointer"
                    onClick={() => {
                      data.onChangeSkill?.(maestro.id);
                      setMenuOpen(false);
                    }}
                  >
                    Change skill
                  </button>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-1.5 text-[12px] text-red-500 hover:bg-(--bg-elev) cursor-pointer"
                    onClick={() => {
                      data.onDelete?.(maestro.id);
                      setMenuOpen(false);
                    }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        {/* Bottom "+" — add next step */}
        <button
          type="button"
          style={{ position: "absolute", bottom: -10, left: "50%", transform: "translateX(-50%)" }}
          className="w-5 h-5 rounded-full bg-white border-2 border-violet-400 text-violet-600 text-[11px] font-bold flex items-center justify-center cursor-pointer z-10 shadow-sm hover:bg-violet-50 focus:outline-none"
          onClick={(e) => {
            e.stopPropagation();
            data.onAddNext?.(maestro.id);
          }}
          title="Add next step"
        >
          +
        </button>
      </div>
      <Handle type="source" position={Position.Bottom} id="bottom" />
    </>
  );
}

function SuccessEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd }: EdgeProps) {
  const [edgePath] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  return <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={{ stroke: "#94a3b8", strokeWidth: 1.5 }} />;
}

function ConditionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  markerEnd,
  data,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const typedData = data as
    | {
        onLabelMove?: (id: string, offset: { x: number; y: number }) => void;
        maestroEdge?: MaestroEdgeV3;
        // Set when an instance is selected in the side panel and this edge doesn't touch it —
        // dims the edge + its label so the selected instance's own conditions stand out.
        dimmed?: boolean;
        // Set when this edge itself was clicked directly (rather than via an instance) — puts
        // it "in evidence" the same way a selected instance's own conditions are.
        isSelectedEdge?: boolean;
        // 1-based position of this edge among the currently-selected instance's conditions —
        // shown as a matching badge here and in the side panel so the two are easy to correlate.
        conditionIndex?: number;
      }
    | undefined;
  const onLabelMove = typedData?.onLabelMove;
  const storedOffset = typedData?.maestroEdge?.label_offset;
  const dimmed = !!typedData?.dimmed;
  const isSelectedEdge = !!typedData?.isSelectedEdge;
  const conditionIndex = typedData?.conditionIndex;
  const fadedOpacity = dimmed ? 0.08 : 1;

  const { getViewport } = useReactFlow();
  const localOffsetRef = useRef<{ x: number; y: number }>(storedOffset ?? { x: 0, y: 0 });
  const [displayOffset, setDisplayOffset] = useState<{ x: number; y: number }>(storedOffset ?? { x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ mx: number; my: number; ox: number; oy: number } | null>(null);

  // Sync display when stored offset changes (e.g. on save/load)
  useEffect(() => {
    const off = storedOffset ?? { x: 0, y: 0 };
    localOffsetRef.current = off;
    setDisplayOffset(off);
  }, [storedOffset?.x, storedOffset?.y]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = { mx: e.clientX, my: e.clientY, ox: localOffsetRef.current.x, oy: localOffsetRef.current.y };
    setIsDragging(true);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStartRef.current) return;
      const { zoom } = getViewport();
      const dx = (e.clientX - dragStartRef.current.mx) / zoom;
      const dy = (e.clientY - dragStartRef.current.my) / zoom;
      const next = { x: dragStartRef.current.ox + dx, y: dragStartRef.current.oy + dy };
      localOffsetRef.current = next;
      setDisplayOffset(next);
    },
    [getViewport]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStartRef.current) return;
      const { zoom } = getViewport();
      const dx = (e.clientX - dragStartRef.current.mx) / zoom;
      const dy = (e.clientY - dragStartRef.current.my) / zoom;
      const next = { x: dragStartRef.current.ox + dx, y: dragStartRef.current.oy + dy };
      localOffsetRef.current = next;
      dragStartRef.current = null;
      setIsDragging(false);
      onLabelMove?.(id, next);
    },
    [id, getViewport, onLabelMove]
  );

  const hasLabel = typeof label === "string" && label.length > 0;
  const finalX = labelX + displayOffset.x;
  const finalY = labelY + displayOffset.y;

  // When the label has been repositioned, draw a quadratic bezier that passes through
  // the label position at t=0.5: CP = 2·label − (source+target)/2
  const hasOffset = displayOffset.x !== 0 || displayOffset.y !== 0;
  const activePath = hasOffset
    ? `M ${sourceX},${sourceY} Q ${2 * finalX - (sourceX + targetX) / 2},${2 * finalY - (sourceY + targetY) / 2} ${targetX},${targetY}`
    : edgePath;

  return (
    <>
      <BaseEdge
        id={id}
        path={activePath}
        markerEnd={markerEnd}
        style={{
          stroke: "#f97316",
          strokeWidth: isSelectedEdge ? 3 : 1.5,
          strokeDasharray: "5 4",
          opacity: fadedOpacity,
          transition: "opacity 150ms, stroke-width 150ms",
        }}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${finalX}px,${finalY}px)`,
            pointerEvents: "all",
            cursor: isDragging ? "grabbing" : "grab",
            userSelect: "none",
            opacity: fadedOpacity,
            transition: "opacity 150ms, box-shadow 150ms",
            borderRadius: 4,
            boxShadow: isSelectedEdge ? "0 0 0 2px #f97316" : undefined,
          }}
          className="flex items-center gap-1 nodrag nopan"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {typeof conditionIndex === "number" && (
            <span className="w-4 h-4 rounded-full bg-orange-500 text-white text-[9px] font-semibold flex items-center justify-center shrink-0">
              {conditionIndex}
            </span>
          )}
          {hasLabel ? (
            <span
              className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-50 border border-orange-300 text-orange-700 block max-w-[140px] truncate"
              title={String(label)}
            >
              {String(label)}
            </span>
          ) : (
            <span className="px-1.5 py-0.5 rounded text-[10px] italic bg-orange-50/70 border border-dashed border-orange-300 text-orange-400">
              no label
            </span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

/**
 * The app's resolved theme, as React Flow's `colorMode`.
 *
 * React Flow ships its own light and dark palettes behind `--xy-*` variables and picks between
 * them from its own `colorMode` prop — it does not inherit the app's theme. Left unset it stays
 * light, and in dark mode the Controls buttons render a near-white icon on a near-white button:
 * zoom in/out, fit view and lock are all invisible. Only visible in a rendered window, which is
 * why it survived the port from the web app.
 *
 * Mirrors the `light`/`dark` class that public/theme-bootstrap.js sets before first paint and
 * @repo/ui's ThemeToggle updates afterwards — hence the observer rather than a one-shot read:
 * "auto" resolves against the OS and the toggle can change it while the canvas is mounted.
 */
function useColorMode(): "light" | "dark" {
  const read = () => (document.documentElement.classList.contains("dark") ? "dark" : "light");
  const [mode, setMode] = useState<"light" | "dark">(read);
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setMode(el.classList.contains("dark") ? "dark" : "light");
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return mode;
}

// Re-fits the viewport whenever the active workflow changes (fitView prop only fires on mount).
function FitViewEffect({ workflowName }: { workflowName: string | undefined }) {
  const { fitView } = useReactFlow();
  const prevRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (workflowName !== prevRef.current) {
      prevRef.current = workflowName;
      setTimeout(() => fitView({ padding: 0.4 }), 50);
    }
  }, [workflowName, fitView]);
  return null;
}

// Stable module-level constants — never recreated, so React Flow never remounts nodes.
const NODE_TYPES = {
  mainSession: MainSessionNode,
  agentNode: AgentNodeComponent,
  humanStep: HumanStepNode,
  skillNode: SkillNodeComponent,
};
const EDGE_TYPES = { successEdge: SuccessEdge, conditionEdge: ConditionEdge };

// ── Main component ──────────────────────────────────────────────────

export default function WorkflowCanvas({
  workflow,
  workflowKey,
  availableAgents,
  availableSkills,
  instances,
  onChange,
  onInstancesChange,
}: WorkflowCanvasProps) {
  const [rfNodes, setRfNodes] = useState<Node[]>([]);
  const [rfEdges, setRfEdges] = useState<Edge[]>([]);
  const rfNodesRef = useRef<Node[]>([]);
  const rfEdgesRef = useRef<Edge[]>([]);
  rfNodesRef.current = rfNodes;
  rfEdgesRef.current = rfEdges;
  // Tracks the last workflow object we emitted so the sync effect can ignore the echo
  const lastEmittedRef = useRef<MaestroWorkflowV3 | null>(null);

  // Condition edge state machine
  const [conditionSourceNodeId, setConditionSourceNodeId] = useState<string | null>(null);
  const [conditionModalOpen, setConditionModalOpen] = useState(false);
  const [conditionLabel, setConditionLabel] = useState("");
  const [conditionTargetNodeId, setConditionTargetNodeId] = useState("");
  const [conditionPicker, setConditionPicker] = useState<InstancePickerValue>(blankInstancePicker());

  // Selected instance — clicking an agent node opens the right-side edit panel in place of the
  // old kebab-menu "Edit instance" modal. Edits apply live (no separate Save/Cancel), since the
  // panel is an inspector rather than a confirmation dialog. Selecting an instance and selecting
  // a condition edge are mutually exclusive — only one side panel shows at a time.
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  // Selected condition edge — clicking a condition directly on the canvas behaves like clicking
  // an instance: it's put "in evidence" (full opacity while others dim) and shown/edited here.
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Change-skill modal (skill nodes)
  const [changeSkillNodeId, setChangeSkillNodeId] = useState<string | null>(null);
  const [changeSkillValue, setChangeSkillValue] = useState("");

  const colorMode = useColorMode();

  // Track the previous workflowKey to detect switches between workflows
  const prevKeyRef = useRef(workflowKey);

  // Sync incoming workflow → RF state (always produces at least the main-session node)
  useEffect(() => {
    if (!workflow) return;
    const switched = prevKeyRef.current !== workflowKey;
    prevKeyRef.current = workflowKey;
    // Skip if this is the echo of our own pushChange — but always rebuild on a workflow switch
    if (!switched && workflow === lastEmittedRef.current) return;
    // Clear the last-emitted ref on switch so subsequent edits don't stale-match the old workflow
    if (switched) {
      lastEmittedRef.current = null;
      setSelectedInstanceId(null);
      setSelectedEdgeId(null);
    }
    let nodes = workflowToRfNodes(workflow, instances);
    const edges = workflowToRfEdges(workflow);
    const hasPositions = workflow.nodes.length > 0 && workflow.nodes.every((n) => n.position != null);
    if (!hasPositions) nodes = applyDagreLayout(nodes, edges);
    setRfNodes(nodes);
    setRfEdges(edges);
  }, [workflow, instances, workflowKey]);

  const pushChange = useCallback(
    (nodes: Node[], edges: Edge[]) => {
      if (!workflow) return;
      const updated: MaestroWorkflowV3 = {
        ...workflow,
        nodes: rfNodesToMaestroNodes(nodes),
        edges: rfEdgesToMaestroEdges(edges),
      };
      lastEmittedRef.current = updated; // mark so the sync effect ignores the echo
      onChange(updated);
    },
    [workflow, onChange]
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const next = applyNodeChanges(changes, rfNodesRef.current);
      setRfNodes(next);
      // Push only when there is a structural change worth saving:
      // - position: only on drag-end (dragging === false) — not on every mousemove
      // - dimensions / select: React Flow internal bookkeeping, never push
      // - everything else (add, remove, reset): push immediately
      const shouldPush = changes.some(
        (c) =>
          (c.type === "position" && c.dragging === false) ||
          (c.type !== "position" && c.type !== "dimensions" && c.type !== "select")
      );
      if (shouldPush) pushChange(next, rfEdgesRef.current);
    },
    [pushChange]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const next = applyEdgeChanges(changes, rfEdgesRef.current);
      setRfEdges(next);
      pushChange(rfNodesRef.current, next);
    },
    [pushChange]
  );

  const handleConnect = useCallback(
    (params: Connection) => {
      const isCondition = params.sourceHandle === "left" || params.sourceHandle === "right";
      const newEdge: Partial<Edge> = {
        ...params,
        type: isCondition ? "conditionEdge" : "successEdge",
        animated: isCondition,
        style: isCondition ? { stroke: "#f97316", strokeDasharray: "5 4" } : undefined,
        data: {
          maestroEdge: {
            from: params.source,
            to: params.target,
            kind: isCondition ? "condition" : "success",
            sourceHandle: params.sourceHandle ?? undefined,
            targetHandle: params.targetHandle ?? undefined,
          } as MaestroEdgeV3,
        },
      };
      setRfEdges((eds) => {
        // Enforce single success edge per source node
        const base = isCondition ? eds : replaceSuccessEdgeFrom(eds, params.source!);
        const next = addEdge(newEdge as Edge, base);
        pushChange(rfNodesRef.current, next);
        return next;
      });
    },
    [pushChange]
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      const edges = rfEdgesRef.current;
      const nextNodes = rfNodesRef.current.filter((n) => n.id !== nodeId);
      let nextEdges = edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
      // Removing a node from the middle of the success path would leave the chain severed —
      // re-join its predecessor to its successor so the happy path stays connected.
      const incoming = edges.find((e) => e.target === nodeId && isSuccessEdge(e));
      const outgoing = edges.find((e) => e.source === nodeId && isSuccessEdge(e));
      if (incoming && outgoing && incoming.source !== outgoing.target) {
        nextEdges = [
          ...replaceSuccessEdgeFrom(nextEdges, incoming.source),
          makeSuccessEdge(incoming.source, outgoing.target),
        ];
      }
      setRfNodes(nextNodes);
      setRfEdges(nextEdges);
      pushChange(nextNodes, nextEdges);
      setSelectedInstanceId((cur) => (cur === nodeId ? null : cur));
      setSelectedEdgeId((cur) => (cur && nextEdges.some((e) => e.id === cur) ? cur : null));
    },
    [pushChange]
  );

  // Delete one or more condition edges at once — surfaced in the side panel now that conditions
  // no longer carry their own delete affordance on the canvas.
  const deleteEdges = useCallback(
    (edgeIds: Iterable<string>) => {
      const ids = new Set(edgeIds);
      if (ids.size === 0) return;
      const nextEdges = rfEdgesRef.current.filter((e) => !ids.has(e.id));
      setRfEdges(nextEdges);
      pushChange(rfNodesRef.current, nextEdges);
      setSelectedEdgeId((cur) => (cur && ids.has(cur) ? null : cur));
    },
    [pushChange]
  );

  const deleteEdge = useCallback((edgeId: string) => deleteEdges([edgeId]), [deleteEdges]);

  // Live-edit a condition edge's label — from either the instance panel's Conditions list or
  // the standalone condition panel. Keeps `edge.label` and `maestroEdge.label` in sync, same as
  // the modal this replaces used to.
  const updateEdgeLabel = useCallback(
    (edgeId: string, label: string) => {
      const next = rfEdgesRef.current.map((e) => {
        if (e.id !== edgeId) return e;
        const maestro = e.data?.maestroEdge as MaestroEdgeV3 | undefined;
        return { ...e, label, data: { ...e.data, maestroEdge: { ...(maestro as MaestroEdgeV3), label } } };
      });
      setRfEdges(next);
      pushChange(rfNodesRef.current, next);
    },
    [pushChange]
  );

  // ── Move condition-edge label ────────────────────────────────────

  const moveLabelOffset = useCallback(
    (edgeId: string, offset: { x: number; y: number }) => {
      const next = rfEdgesRef.current.map((e) => {
        if (e.id !== edgeId) return e;
        const maestro = e.data?.maestroEdge as MaestroEdgeV3 | undefined;
        // Round near-zero offsets back to undefined to keep maestro.json clean
        const cleanOffset = Math.abs(offset.x) < 0.5 && Math.abs(offset.y) < 0.5 ? undefined : offset;
        return {
          ...e,
          data: { ...e.data, maestroEdge: { ...(maestro as MaestroEdgeV3), label_offset: cleanOffset } },
        };
      });
      setRfEdges(next);
      pushChange(rfNodesRef.current, next);
    },
    [pushChange]
  );

  // ── Instance edit panel (right side, opened by clicking an agent node) ──────

  const selectedInstance = selectedInstanceId ? instances.find((i) => i.name === selectedInstanceId) ?? null : null;
  // The node id backing the selected instance — usually equal to the instance name (see
  // workflow-view skill), but resolved defensively rather than assumed, same as handleNodeClick.
  const selectedInstanceNodeId = selectedInstanceId
    ? rfNodes.find((n) => (n.data.maestroNode as MaestroNodeV3 | undefined)?.instance === selectedInstanceId)?.id ??
      selectedInstanceId
    : null;
  const selectedEdge = selectedEdgeId ? rfEdges.find((e) => e.id === selectedEdgeId) ?? null : null;

  const updateSelectedInstance = useCallback(
    (patch: Partial<MaestroInstanceV3>) => {
      if (!selectedInstanceId) return;
      onInstancesChange(instances.map((i) => (i.name === selectedInstanceId ? { ...i, ...patch } : i)));
    },
    [selectedInstanceId, instances, onInstancesChange]
  );

  // ── Change-skill modal (skill nodes) ────────────────────────────

  const openChangeSkill = useCallback(
    (nodeId: string) => {
      const node = rfNodesRef.current.find((n) => n.id === nodeId);
      const maestro = node?.data.maestroNode as MaestroNodeV3 | undefined;
      setChangeSkillNodeId(nodeId);
      setChangeSkillValue(maestro?.skill ?? availableSkills[0] ?? "");
    },
    [availableSkills]
  );

  const confirmChangeSkill = useCallback(() => {
    if (!changeSkillNodeId || !changeSkillValue) return;
    const next = rfNodesRef.current.map((n) => {
      if (n.id !== changeSkillNodeId) return n;
      const maestro = n.data.maestroNode as MaestroNodeV3;
      return { ...n, data: { ...n.data, maestroNode: { ...maestro, skill: changeSkillValue } } };
    });
    setRfNodes(next);
    pushChange(next, rfEdgesRef.current);
    setChangeSkillNodeId(null);
  }, [changeSkillNodeId, changeSkillValue, pushChange]);

  // Instances already placed in this workflow (for uniqueness enforcement)
  const placedInstanceNames = useMemo(
    () =>
      new Set(
        rfNodes
          .filter((n) => n.id !== "main-session" && (n.data.maestroNode as MaestroNodeV3 | undefined)?.type === "agent")
          .map((n) => (n.data.maestroNode as MaestroNodeV3).instance ?? "")
          .filter(Boolean)
      ),
    [rfNodes]
  );

  // Subagents (agent types) already placed in this workflow. A subagent can only
  // appear once per workflow — the SubagentStart hook keys off agent_type, so two
  // instances of the same agent would merge. Used to hide already-used subagents.
  const placedAgentTypes = useMemo(
    () =>
      new Set(
        Array.from(placedInstanceNames)
          .map((name) => instances.find((i) => i.name === name)?.agent)
          .filter(Boolean) as string[]
      ),
    [placedInstanceNames, instances]
  );

  // ── Condition state machine ──────────────────────────────────────

  const resetConditionState = useCallback(() => {
    setConditionSourceNodeId(null);
    setConditionModalOpen(false);
    setConditionLabel("");
    setConditionTargetNodeId("");
    setConditionPicker(blankInstancePicker());
  }, []);

  const openConditionModal = useCallback(
    (nodeId: string) => {
      setConditionSourceNodeId(nodeId);
      setConditionModalOpen(true);
      setConditionLabel("");
      setConditionTargetNodeId("");
      const firstFree = availableAgents.find((a) => !placedAgentTypes.has(a));
      setConditionPicker(blankInstancePicker(firstFree ?? ""));
    },
    [availableAgents, placedAgentTypes]
  );

  const handleStartAddCondition = useCallback(() => {
    if (conditionSourceNodeId === "__picking__") {
      resetConditionState();
    } else {
      setConditionSourceNodeId("__picking__");
    }
  }, [conditionSourceNodeId, resetConditionState]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (conditionSourceNodeId === "__picking__") {
        if (node.id !== "main-session") openConditionModal(node.id);
        return;
      }
      // Clicking an agent node opens (or, on a second click, closes) the right-side edit panel —
      // this replaces the kebab menu's old "Edit instance" modal. Instances are keyed by name,
      // not node id — the two are the same by convention (see workflow-view skill) but resolve
      // through `instance` rather than assume it, same fallback the old kebab handler used.
      const maestroNode = node.data.maestroNode as MaestroNodeV3 | undefined;
      if (maestroNode?.type === "agent") {
        const instanceName = maestroNode.instance ?? node.id;
        setSelectedEdgeId(null);
        setSelectedInstanceId((cur) => (cur === instanceName ? null : instanceName));
      }
    },
    [conditionSourceNodeId, openConditionModal]
  );

  // Clicking a condition edge behaves the same way clicking an instance does: it's selected,
  // put "in evidence" on the canvas (other conditions dim), and shown/edited in the side panel.
  const handleEdgeClick = useCallback((_event: React.MouseEvent, edge: Edge) => {
    if (edge.type !== "conditionEdge") return;
    setSelectedInstanceId(null);
    setSelectedEdgeId((cur) => (cur === edge.id ? null : edge.id));
  }, []);

  // Clicking empty canvas closes whichever side panel is open, the same way it deselects RF's
  // own nodes.
  const handlePaneClick = useCallback(() => {
    setSelectedInstanceId(null);
    setSelectedEdgeId(null);
  }, []);

  const confirmAddCondition = useCallback(() => {
    if (!conditionSourceNodeId || conditionSourceNodeId === "__picking__") return;

    const nextNodes = [...rfNodes];
    let targetId: string;

    if (conditionTargetNodeId) {
      // Targeting an existing node
      targetId = conditionTargetNodeId;
    } else {
      // Creating / reusing a node via the instance picker
      const resolved = resolveInstanceFromPicker(conditionPicker, {
        instances,
        placedNames: placedInstanceNames,
        // Fall back only to a subagent not already placed in this workflow.
        availableAgents: availableAgents.filter((a) => !placedAgentTypes.has(a)),
      });
      if (!resolved) return;
      const instanceName = resolved.instance.name;
      if (resolved.isNew) onInstancesChange([...instances, resolved.instance]);
      targetId = instanceName;
      const sourceNode = rfNodes.find((n) => n.id === conditionSourceNodeId);
      const position = {
        x: (sourceNode?.position.x ?? 0) + 240,
        y: sourceNode?.position.y ?? 0,
      };
      const newMaestroNode: MaestroNodeV3 = { id: instanceName, type: "agent", instance: instanceName, position };
      nextNodes.push({
        id: instanceName,
        type: "agentNode",
        position,
        data: { maestroNode: newMaestroNode, instanceData: resolved.instance },
      });
    }

    const newEdge: Edge = {
      id: `e-cond-${conditionSourceNodeId}-${targetId}-${rfEdges.length}`,
      source: conditionSourceNodeId,
      sourceHandle: "right",
      target: targetId,
      targetHandle: "top",
      type: "conditionEdge",
      label: conditionLabel || undefined,
      animated: true,
      style: { stroke: "#f97316", strokeDasharray: "5 4" },
      data: {
        maestroEdge: {
          from: conditionSourceNodeId,
          to: targetId,
          kind: "condition",
          label: conditionLabel || undefined,
          sourceHandle: "right",
          targetHandle: "top",
        } as MaestroEdgeV3,
      },
    };

    const nextEdges = [...rfEdges, newEdge];
    setRfNodes(nextNodes);
    setRfEdges(nextEdges);
    pushChange(nextNodes, nextEdges);
    resetConditionState();
  }, [
    conditionSourceNodeId,
    conditionTargetNodeId,
    conditionPicker,
    conditionLabel,
    rfNodes,
    rfEdges,
    instances,
    availableAgents,
    placedAgentTypes,
    placedInstanceNames,
    onInstancesChange,
    pushChange,
    resetConditionState,
  ]);

  // ── Add step (per-node "+" button) ──────────────────────────────

  const [addStepSourceId, setAddStepSourceId] = useState<string | null>(null);
  const [addStepType, setAddStepType] = useState<"agent" | "human_review" | "skill">("agent");
  const [addStepPicker, setAddStepPicker] = useState<InstancePickerValue>(blankInstancePicker());
  const [addStepSkill, setAddStepSkill] = useState("");

  const resetAddStep = useCallback(() => {
    setAddStepSourceId(null);
    setAddStepType("agent");
    setAddStepPicker(blankInstancePicker());
    setAddStepSkill("");
  }, []);

  const openAddStep = useCallback(
    (sourceId: string) => {
      setAddStepSourceId(sourceId);
      setAddStepType("agent");
      const firstFree = availableAgents.find((a) => !placedAgentTypes.has(a));
      setAddStepPicker(blankInstancePicker(firstFree ?? ""));
      setAddStepSkill(availableSkills[0] ?? "");
    },
    [availableAgents, placedAgentTypes, availableSkills]
  );

  const confirmAddStep = useCallback(() => {
    if (!addStepSourceId || !workflow) return;

    const sourceNode = rfNodes.find((n) => n.id === addStepSourceId);
    const position = {
      x: sourceNode?.position.x ?? 0,
      y: (sourceNode?.position.y ?? 0) + INSERT_ROW_HEIGHT,
    };

    let newRfNode: Node;
    let nodeId: string;

    if (addStepType === "agent") {
      const resolved = resolveInstanceFromPicker(addStepPicker, {
        instances,
        placedNames: placedInstanceNames,
        // Fall back only to a subagent not already placed in this workflow.
        availableAgents: availableAgents.filter((a) => !placedAgentTypes.has(a)),
      });
      if (!resolved) return;
      nodeId = resolved.instance.name;
      if (resolved.isNew) onInstancesChange([...instances, resolved.instance]);
      const maestroNode: MaestroNodeV3 = { id: nodeId, type: "agent", instance: nodeId, position };
      newRfNode = { id: nodeId, type: "agentNode", position, data: { maestroNode, instanceData: resolved.instance } };
    } else if (addStepType === "skill") {
      if (!addStepSkill) return;
      nodeId = nextSkillId(rfNodes);
      const maestroNode: MaestroNodeV3 = { id: nodeId, type: "skill", skill: addStepSkill, position };
      newRfNode = { id: nodeId, type: "skillNode", position, data: { maestroNode } };
    } else {
      // human_review
      nodeId = nextHumanId(rfNodes);
      const maestroNode: MaestroNodeV3 = { id: nodeId, type: "human_review", position };
      newRfNode = { id: nodeId, type: "humanStep", position, data: { maestroNode } };
    }

    // The step is inserted *between* the source and whatever it already pointed at, so the
    // downstream link has to be re-attached to the new node — not just dropped.
    const displaced = rfEdges.find((e) => e.source === addStepSourceId && isSuccessEdge(e));

    // Enforce single success edge per source: replace any existing success edge from addStepSourceId
    const nextEdges = [...replaceSuccessEdgeFrom(rfEdges, addStepSourceId), makeSuccessEdge(addStepSourceId, nodeId)];
    if (displaced && displaced.target !== nodeId) nextEdges.push(makeSuccessEdge(nodeId, displaced.target));

    // Push the rest of the column down so the inserted node doesn't land on top of the
    // node it displaced (only when inserting mid-chain — appending needs no reflow).
    const nextNodes = [
      ...(displaced
        ? rfNodes.map((n) =>
            n.id !== addStepSourceId && n.position.y >= position.y
              ? { ...n, position: { ...n.position, y: n.position.y + INSERT_ROW_HEIGHT } }
              : n
          )
        : rfNodes),
      newRfNode,
    ];
    setRfNodes(nextNodes);
    setRfEdges(nextEdges);
    pushChange(nextNodes, nextEdges);
    resetAddStep();
  }, [
    addStepSourceId,
    addStepType,
    addStepPicker,
    addStepSkill,
    workflow,
    rfNodes,
    rfEdges,
    instances,
    availableAgents,
    placedAgentTypes,
    placedInstanceNames,
    onInstancesChange,
    pushChange,
    resetAddStep,
  ]);

  // ── Add Agent (bottom bar) — routes through add-step modal at terminal ──

  const handleAddAgent = useCallback(() => {
    if (!workflow) return;
    const terminalId = findSuccessTerminalId(rfEdges);
    openAddStep(terminalId);
  }, [workflow, rfEdges, openAddStep]);

  // ── Enriched nodes ───────────────────────────────────────────────

  const terminalId = useMemo(() => findSuccessTerminalId(rfEdges), [rfEdges]);

  const enrichedNodes = useMemo(
    () =>
      rfNodes.map((n) => {
        if (n.id === "main-session") {
          return {
            ...n,
            data: { onAddNext: openAddStep },
          };
        }
        const maestroNode = n.data.maestroNode as MaestroNodeV3;
        // Always resolve instanceData fresh from the instances prop so edit-panel updates are reflected immediately
        const instanceData =
          maestroNode.type === "agent" ? instances.find((i) => i.name === maestroNode.instance) : undefined;
        return {
          ...n,
          data: {
            ...n.data,
            instanceData,
            onDelete: deleteNode,
            onChangeSkill: openChangeSkill,
            onAddConditionEdge: openConditionModal,
            onAddNext: openAddStep,
            isPickingConditionSource: conditionSourceNodeId === "__picking__",
            isTerminal: n.id === terminalId,
            isSelectedInstance: n.id === selectedInstanceId,
          },
        };
      }),
    [rfNodes, instances, deleteNode, openChangeSkill, openConditionModal, openAddStep, conditionSourceNodeId, terminalId, selectedInstanceId]
  );

  // Condition edges touching the selected instance, in canvas order — indexed 1, 2, 3… so the
  // same numbers can badge each edge on the canvas and its row in the side panel.
  const relatedConditionEdges = useMemo(
    () =>
      selectedInstanceId
        ? rfEdges.filter(
            (e) => e.type === "conditionEdge" && (e.source === selectedInstanceId || e.target === selectedInstanceId)
          )
        : [],
    [rfEdges, selectedInstanceId]
  );
  const conditionIndexByEdgeId = useMemo(() => {
    const m = new Map<string, number>();
    relatedConditionEdges.forEach((e, i) => m.set(e.id, i + 1));
    return m;
  }, [relatedConditionEdges]);

  // Which of the selected instance's conditions are checked for bulk deletion — a checklist
  // rather than single-row selection, so several conditions can be removed in one go.
  const [checkedConditionIds, setCheckedConditionIds] = useState<Set<string>>(new Set());

  // Clear the checklist whenever the instance panel switches to a different instance.
  useEffect(() => {
    setCheckedConditionIds(new Set());
  }, [selectedInstanceId]);

  // Drop any checked id whose edge no longer exists (deleted elsewhere — e.g. via the
  // standalone condition panel, or the instance itself being removed).
  useEffect(() => {
    setCheckedConditionIds((prev) => {
      const live = new Set(relatedConditionEdges.map((e) => e.id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [relatedConditionEdges]);

  const toggleConditionChecked = useCallback((edgeId: string) => {
    setCheckedConditionIds((prev) => {
      const next = new Set(prev);
      if (next.has(edgeId)) next.delete(edgeId);
      else next.add(edgeId);
      return next;
    });
  }, []);

  const deleteCheckedConditions = useCallback(() => {
    deleteEdges(checkedConditionIds);
    setCheckedConditionIds(new Set());
  }, [checkedConditionIds, deleteEdges]);

  // Thread the label-move handler into every condition edge, and dim the ones unrelated to the
  // current selection (instance or edge) so whatever is being edited in the side panel stands out.
  const enrichedEdges = useMemo(
    () =>
      rfEdges.map((e) => {
        if (e.type !== "conditionEdge") return e;
        const relatedToInstance = e.source === selectedInstanceId || e.target === selectedInstanceId;
        const isSelectedEdge = e.id === selectedEdgeId;
        const anySelection = selectedInstanceId != null || selectedEdgeId != null;
        const dimmed = anySelection && !relatedToInstance && !isSelectedEdge;
        return {
          ...e,
          data: {
            ...e.data,
            onLabelMove: moveLabelOffset,
            dimmed,
            isSelectedEdge,
            conditionIndex: conditionIndexByEdgeId.get(e.id),
          },
        };
      }),
    [rfEdges, moveLabelOffset, selectedInstanceId, selectedEdgeId, conditionIndexByEdgeId]
  );

  const isPicking = conditionSourceNodeId === "__picking__";
  // Available instances for reuse: exclude ones already placed in this workflow,
  // and ones whose subagent is already used (a subagent appears at most once).
  const availableForReuse = instances.filter((i) => !placedInstanceNames.has(i.name) && !placedAgentTypes.has(i.agent));
  // Subagents still selectable when creating a new node here.
  const availableAgentsForNew = availableAgents.filter((a) => !placedAgentTypes.has(a));
  const existingInstanceNames = instances.map((i) => i.name);
  // When editing an instance in the side panel, keep its own subagent selectable but hide
  // subagents already taken by other instances in this workflow.
  const panelAvailableAgents = availableAgents.filter(
    (a) => a === selectedInstance?.agent || !placedAgentTypes.has(a)
  );

  return (
    <div
      className={`flex-1 relative flex flex-col overflow-hidden ${isPicking ? "cursor-crosshair" : ""}`}
      style={{ minHeight: 400 }}
    >
      <ReactFlowProvider>
        <FitViewEffect workflowName={workflow?.name} />
        <ReactFlow
          nodes={enrichedNodes}
          edges={enrichedEdges}
          colorMode={colorMode}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          connectionMode={ConnectionMode.Loose}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onNodeClick={handleNodeClick}
          onEdgeClick={handleEdgeClick}
          onPaneClick={handlePaneClick}
          fitView
          fitViewOptions={{ padding: 0.4 }}
          className="bg-(--bg)"
        >
          <Background />
          <Controls />

          {/* Bottom action bar */}
          <Panel position="bottom-center" style={{ marginBottom: 16 }}>
            <div className="flex items-center gap-2 bg-(--bg) border border-(--line) rounded-xl px-3 py-2 shadow-lg">
              <button
                type="button"
                onClick={handleAddAgent}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100 cursor-pointer focus:outline-none transition-colors"
              >
                <span className="text-[14px] leading-none">+</span> Add Agent
              </button>
              <div className="w-px h-4 bg-(--line)" />
              <button
                type="button"
                onClick={handleStartAddCondition}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border cursor-pointer focus:outline-none transition-colors ${
                  isPicking
                    ? "border-orange-500 bg-orange-500 text-white"
                    : "border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100"
                }`}
              >
                <span className="text-[14px] leading-none">+</span> {isPicking ? "Click a node…" : "Add condition"}
              </button>
              {isPicking && (
                <button
                  type="button"
                  onClick={resetConditionState}
                  className="px-2 py-1 text-[12px] text-(--ink-2) hover:text-(--ink) cursor-pointer focus:outline-none"
                >
                  Cancel
                </button>
              )}
            </div>
          </Panel>
        </ReactFlow>
      </ReactFlowProvider>

      {/* Condition modal */}
      {conditionModalOpen && (
        <div className="absolute inset-0 bg-black/30 z-20 flex items-center justify-center">
          <div className="bg-(--bg) border border-(--line) rounded-xl p-5 shadow-xl w-[40rem] flex flex-col gap-3">
            <div className="text-[13px] font-semibold text-(--ink)">Add condition</div>

            <textarea
              placeholder="Condition label (e.g. needs revision)"
              value={conditionLabel}
              autoFocus
              rows={4}
              onChange={(e) => setConditionLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") resetConditionState();
              }}
              className="w-full text-[12px] bg-(--bg-elev) border border-(--line) rounded px-2 py-1.5 text-(--ink) focus:outline-none focus:border-primary resize-none"
            />

            {/* Target: existing node or new instance */}
            <select
              value={conditionTargetNodeId}
              onChange={(e) => setConditionTargetNodeId(e.target.value)}
              className="w-full text-[12px] bg-(--bg-elev) border border-(--line) rounded px-2 py-1.5 text-(--ink) focus:outline-none focus:border-primary"
            >
              <option value="">New instance node…</option>
              {rfNodes
                .filter((n) => n.id !== conditionSourceNodeId && n.id !== "main-session")
                .map((n) => {
                  const maestro = n.data.maestroNode as MaestroNodeV3 | undefined;
                  const label =
                    maestro?.type === "skill"
                      ? `/${maestro.skill ?? maestro.id}`
                      : (maestro?.instance ?? maestro?.id ?? n.id);
                  return (
                    <option key={n.id} value={n.id}>
                      {label}
                    </option>
                  );
                })}
            </select>

            {/* When creating a new node: instance picker */}
            {!conditionTargetNodeId && (
              <InstancePicker
                value={conditionPicker}
                onChange={setConditionPicker}
                availableAgents={availableAgentsForNew}
                unavailableAgents={Array.from(placedAgentTypes)}
                availableSkills={availableSkills}
                reusableInstances={availableForReuse}
                existingInstanceNames={existingInstanceNames}
              />
            )}

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={resetConditionState}
                className="px-3 py-1.5 text-[12px] rounded-lg bg-(--bg-elev) border border-(--line) text-(--ink-2) hover:text-(--ink) cursor-pointer focus:outline-none"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmAddCondition}
                className="px-3 py-1.5 text-[12px] rounded-lg bg-primary text-white cursor-pointer focus:outline-none hover:opacity-90"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add step modal */}
      {addStepSourceId && (
        <div className="absolute inset-0 bg-black/30 z-20 flex items-center justify-center">
          <div className="bg-(--bg) border border-(--line) rounded-xl p-5 shadow-xl w-80 flex flex-col gap-3">
            <div className="text-[13px] font-semibold text-(--ink)">Add step</div>

            {/* Type picker */}
            <div className="flex rounded-lg overflow-hidden border border-(--line)">
              <button
                type="button"
                onClick={() => setAddStepType("agent")}
                className={`flex-1 py-1.5 text-[12px] font-medium cursor-pointer focus:outline-none transition-colors ${addStepType === "agent" ? "bg-primary text-white" : "bg-(--bg-elev) text-(--ink-2) hover:bg-(--bg)"}`}
              >
                Agent
              </button>
              <button
                type="button"
                onClick={() => setAddStepType("skill")}
                className={`flex-1 py-1.5 text-[12px] font-medium cursor-pointer focus:outline-none transition-colors ${addStepType === "skill" ? "bg-primary text-white" : "bg-(--bg-elev) text-(--ink-2) hover:bg-(--bg)"}`}
              >
                Skill
              </button>
              <button
                type="button"
                onClick={() => setAddStepType("human_review")}
                className={`flex-1 py-1.5 text-[12px] font-medium cursor-pointer focus:outline-none transition-colors ${addStepType === "human_review" ? "bg-primary text-white" : "bg-(--bg-elev) text-(--ink-2) hover:bg-(--bg)"}`}
              >
                Human Review
              </button>
            </div>

            {/* Instance picker (only for agent type) */}
            {addStepType === "agent" && (
              <InstancePicker
                value={addStepPicker}
                onChange={setAddStepPicker}
                availableAgents={availableAgentsForNew}
                unavailableAgents={Array.from(placedAgentTypes)}
                availableSkills={availableSkills}
                reusableInstances={availableForReuse}
                existingInstanceNames={existingInstanceNames}
                onEnter={confirmAddStep}
                onEscape={resetAddStep}
              />
            )}

            {/* Skill picker (only for skill type) — runs inline in the main session */}
            {addStepType === "skill" && (
              <div className="flex flex-col gap-1.5">
                <div className="text-[10px] text-subtle uppercase tracking-wide">Skill</div>
                {availableSkills.length === 0 ? (
                  <p className="text-[12px] text-subtle m-0">
                    No skills selected in the left panel. Add skills there first.
                  </p>
                ) : (
                  <select
                    value={addStepSkill}
                    onChange={(e) => setAddStepSkill(e.target.value)}
                    className="w-full text-[12px] bg-(--bg-elev) border border-(--line) rounded px-2 py-1.5 text-(--ink) focus:outline-none focus:border-primary"
                  >
                    {availableSkills.map((s) => (
                      <option key={s} value={s}>
                        /{s}
                      </option>
                    ))}
                  </select>
                )}
                <p className="text-[11px] text-subtle m-0">
                  The orchestrator runs this skill inline, between agent steps.
                </p>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={resetAddStep}
                className="px-3 py-1.5 text-[12px] rounded-lg bg-(--bg-elev) border border-(--line) text-(--ink-2) hover:text-(--ink) cursor-pointer focus:outline-none"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmAddStep}
                className="px-3 py-1.5 text-[12px] rounded-lg bg-primary text-white cursor-pointer focus:outline-none hover:opacity-90"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Instance edit panel — right side, opened by clicking an agent node on the canvas.
          Edits apply live via updateSelectedInstance; there's no separate Save/Cancel because
          this is an inspector docked beside the canvas, not a confirmation dialog. */}
      {selectedInstance && (
        <div className="absolute top-0 right-0 h-full w-80 bg-(--bg) border-l border-(--line) shadow-xl z-20 flex flex-col overflow-y-auto">
          <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-3 border-b border-(--line)">
            <div className="flex flex-col min-w-0">
              <span className="font-mono text-[13px] font-semibold text-(--ink) truncate">
                {selectedInstance.name}
              </span>
              <span className="text-[11px] text-subtle">Instance</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => selectedInstanceNodeId && deleteNode(selectedInstanceNodeId)}
                className="w-6 h-6 flex items-center justify-center rounded text-red-500 hover:bg-red-50 cursor-pointer focus:outline-none"
                title="Delete instance"
              >
                🗑
              </button>
              <button
                type="button"
                onClick={() => setSelectedInstanceId(null)}
                className="w-6 h-6 flex items-center justify-center rounded text-(--ink-2) hover:bg-(--bg-elev) hover:text-(--ink) cursor-pointer focus:outline-none"
                title="Close"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3 p-4">
            <div>
              <div className="text-[10px] text-subtle uppercase tracking-wide mb-1">Subagent</div>
              <select
                value={selectedInstance.agent}
                onChange={(e) => updateSelectedInstance({ agent: e.target.value })}
                className="w-full text-[12px] bg-(--bg-elev) border border-(--line) rounded px-2 py-1.5 text-(--ink) focus:outline-none focus:border-primary"
              >
                {panelAvailableAgents.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
                {/* Keep current agent even if not in availableAgents */}
                {selectedInstance.agent && !availableAgents.includes(selectedInstance.agent) && (
                  <option value={selectedInstance.agent}>{selectedInstance.agent} (not in list)</option>
                )}
              </select>
            </div>

            <InstanceSkillPicker
              skills={availableSkills}
              value={{ loaded: selectedInstance.loaded_skills, referenced: selectedInstance.referenced_skills }}
              onChange={(sel) => updateSelectedInstance({ loaded_skills: sel.loaded, referenced_skills: sel.referenced })}
              maxHeight="max-h-none"
              size="md"
              emptyHint="No skills available. Add skills from the left panel first."
            />

            {relatedConditionEdges.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[10px] text-subtle uppercase tracking-wide">Conditions</div>
                  {/* A checklist + single delete button — check one or more conditions, then
                      delete them together. Replaces the old per-row ✕ button, which was too
                      easy to hit by accident while scrolling. */}
                  <button
                    type="button"
                    disabled={checkedConditionIds.size === 0}
                    onClick={deleteCheckedConditions}
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-red-400 text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-50 cursor-pointer focus:outline-none"
                  >
                    Delete{checkedConditionIds.size > 1 ? ` (${checkedConditionIds.size})` : ""}
                  </button>
                </div>
                <div className="flex flex-col gap-1.5">
                  {relatedConditionEdges.map((e, i) => {
                    const direction = e.source === selectedInstanceId ? `→ ${e.target}` : `← ${e.source}`;
                    const checked = checkedConditionIds.has(e.id);
                    return (
                      <div key={e.id} className="flex items-start gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleConditionChecked(e.id)}
                          aria-pressed={checked}
                          title={checked ? "Checked for deletion" : "Check for deletion"}
                          className={`mt-8 shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center cursor-pointer focus:outline-none transition-colors ${
                            checked
                              ? "bg-orange-500 border-orange-500 text-white"
                              : "bg-(--bg) border-orange-300 text-transparent hover:border-orange-500"
                          }`}
                        >
                          <Check size={10} strokeWidth={3} />
                        </button>
                        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                          <span className="text-[10px] font-mono text-subtle truncate pl-[9px]">
                            <span className="font-semibold text-orange-600">{i + 1}.</span> {direction}
                          </span>
                          <textarea
                            value={typeof e.label === "string" ? e.label : ""}
                            onChange={(ev) => updateEdgeLabel(e.id, ev.target.value)}
                            placeholder="Condition label"
                            rows={2}
                            className="w-full text-[12px] bg-(--bg-elev) border border-(--line) rounded px-2 py-1 text-(--ink) focus:outline-none focus:border-primary resize-none"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Condition edit panel — right side, opened by clicking a condition edge directly on the
          canvas (mutually exclusive with the instance panel above). Edits apply live, same as
          the instance panel — there's no separate edit-label modal any more. */}
      {!selectedInstance && selectedEdge && (
        <div className="absolute top-0 right-0 h-full w-80 bg-(--bg) border-l border-(--line) shadow-xl z-20 flex flex-col overflow-y-auto">
          <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-3 border-b border-(--line)">
            <div className="flex flex-col min-w-0">
              <span className="font-mono text-[13px] font-semibold text-(--ink) truncate">
                {selectedEdge.source} → {selectedEdge.target}
              </span>
              <span className="text-[11px] text-subtle">Condition</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => deleteEdge(selectedEdge.id)}
                className="w-6 h-6 flex items-center justify-center rounded text-red-500 hover:bg-red-50 cursor-pointer focus:outline-none"
                title="Delete condition"
              >
                🗑
              </button>
              <button
                type="button"
                onClick={() => setSelectedEdgeId(null)}
                className="w-6 h-6 flex items-center justify-center rounded text-(--ink-2) hover:bg-(--bg-elev) hover:text-(--ink) cursor-pointer focus:outline-none"
                title="Close"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3 p-4">
            <div>
              <div className="text-[10px] text-subtle uppercase tracking-wide mb-1">Label</div>
              <textarea
                value={typeof selectedEdge.label === "string" ? selectedEdge.label : ""}
                onChange={(ev) => updateEdgeLabel(selectedEdge.id, ev.target.value)}
                placeholder="Condition label (e.g. needs revision)"
                rows={4}
                className="w-full text-[12px] bg-(--bg-elev) border border-(--line) rounded px-2 py-1.5 text-(--ink) focus:outline-none focus:border-primary resize-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* Change-skill modal (skill nodes) */}
      {changeSkillNodeId && (
        <div className="absolute inset-0 bg-black/30 z-20 flex items-center justify-center">
          <div className="bg-(--bg) border border-(--line) rounded-xl p-5 shadow-xl w-72 flex flex-col gap-3">
            <div className="text-[13px] font-semibold text-(--ink)">Change skill</div>
            {availableSkills.length === 0 ? (
              <p className="text-[12px] text-subtle m-0">No skills selected in the left panel.</p>
            ) : (
              <select
                value={changeSkillValue}
                autoFocus
                onChange={(e) => setChangeSkillValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setChangeSkillNodeId(null);
                  if (e.key === "Enter") confirmChangeSkill();
                }}
                className="w-full text-[12px] bg-(--bg-elev) border border-(--line) rounded px-2 py-1.5 text-(--ink) focus:outline-none focus:border-primary"
              >
                {availableSkills.map((s) => (
                  <option key={s} value={s}>
                    /{s}
                  </option>
                ))}
              </select>
            )}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setChangeSkillNodeId(null)}
                className="px-3 py-1.5 text-[12px] rounded-lg bg-(--bg-elev) border border-(--line) text-(--ink-2) hover:text-(--ink) cursor-pointer focus:outline-none"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmChangeSkill}
                className="px-3 py-1.5 text-[12px] rounded-lg bg-primary text-white cursor-pointer focus:outline-none hover:opacity-90"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
