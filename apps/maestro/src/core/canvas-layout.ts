// Pure placement maths for the workflow canvas. No imports: this module is renderer-safe (see the
// RENDERER_SAFE list in test/isolation.test.ts), so keep it that way.

/** Dagre `ranksep` — vertical gap between two ranks. */
export const DAGRE_RANK_SEP = 80;
/** Height dagre is given for a node with no skill chips. */
export const DAGRE_NODE_BASE_HEIGHT = 60;
/**
 * Distance from a step to the `main-session` node one rank above it. Derived from the dagre
 * settings so changing the rank spacing moves this too: one rank = the base node height plus the
 * gap between ranks (the main-session node is laid out at the base height).
 */
export const MAIN_SESSION_RANK_OFFSET = DAGRE_NODE_BASE_HEIGHT + DAGRE_RANK_SEP;

/**
 * Whether a workflow's persisted nodes all carry a saved `position`. A workflow with no nodes
 * counts as unplaced. The canvas runs dagre over every node when this is false, and only calls
 * `alignMainSession` when it is true.
 */
export function hasSavedPositions(nodes: ReadonlyArray<{ position?: unknown }>): boolean {
  return nodes.length > 0 && nodes.every((n) => n.position != null);
}

interface PlacedNode {
  id: string;
  position: { x: number; y: number };
}
interface EntryEdge {
  source: string;
  target: string;
  type?: string;
}

/**
 * `main-session` is synthetic and never persisted, so with saved positions it would sit at (0,0)
 * while dagre had put it above the first step. Re-derive the same relation: same x as the first
 * step, one rank above it. Returns `nodes` unchanged (same array) when there is no success entry
 * edge or its target is not in `nodes`.
 *
 * Only meant for the saved-positions path. When a workflow has no saved positions the canvas runs
 * dagre over every node instead and never calls this, so for that case the contract is "not
 * called"; calling it anyway on unplaced nodes would just offset from the first step's (0,0).
 */
export function alignMainSession<N extends PlacedNode>(nodes: N[], edges: EntryEdge[]): N[] {
  const entry = edges.find((e) => e.source === "main-session" && e.type === "successEdge");
  const target = entry && nodes.find((n) => n.id === entry.target);
  if (!target) return nodes;
  return nodes.map((n) =>
    n.id === "main-session"
      ? { ...n, position: { x: target.position.x, y: target.position.y - MAIN_SESSION_RANK_OFFSET } }
      : n
  );
}
