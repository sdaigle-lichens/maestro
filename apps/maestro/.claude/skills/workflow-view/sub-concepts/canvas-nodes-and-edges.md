# Canvas nodes, edges and state sync

`src/renderer/src/components/workflow-canvas.tsx`, built on `@xyflow/react` (React Flow). Four node
types and two edge types are registered as **module-level constants** (`NODE_TYPES`/`EDGE_TYPES`) so
React Flow never remounts nodes.

## Nodes

- `mainSession` — green rounded card (`w-48 rounded-2xl border-2 border-green-400`),
  `deletable: false`. A bottom-center `+` button (`onAddNext`) opens the "Add step" modal. Handles
  (`left`, `right`, `bottom`) are fragment siblings of the card div — **not inside it** — so they
  anchor to the node bounding box, not to the card's flex flow.
- `agentNode` — card showing the instance name (primary) and `@agent` (secondary), skill chips from
  the referenced instance, side `+` buttons (left/right) for conditions, a bottom-center `+`
  (`onAddNext`), and a `⋮` kebab menu (Edit instance / Delete). Orange normally; **green when it is
  the success-path terminal** (`findSuccessTerminalId`).
- `humanStep` — amber diamond rendering "Review" (`human_review`). Wrapped in a `relative` div so the
  bottom-center `+` and the `⋮` kebab (**Delete**) can be absolutely positioned around the diamond —
  both are **siblings** of the clipped diamond div, since the `clipPath` would cut off anything
  rendered inside it. Like `agentNode` it carries left/right `source` handles plus side `+` condition
  buttons (`onAddConditionEdge`), so a human-review step can **source** condition edges — used to
  route a correction back to the agent that produced the work under review (e.g. `human requested
  code corrections` → `@backend`). The orchestrator (not a subagent — a human-review node has no
  agent) reads the user's feedback and dispatches it to that node; the seeded default/tdd workflows
  wire this edge automatically (`buildWorkflow` in `maestro.ts`).
- `skillNode` — violet card rendering `/<skill>` for a standalone **skill step** (`type: "skill"`,
  carries a `skill` id, no instance). A `⋮` kebab offers **Change skill** / **Delete**, plus the
  bottom-center `+`. Like `human_review` it is a non-agent node: no instance, excluded from
  `placedInstanceNames`, rendered in the success path as `/<skill>`, and at runtime the orchestrator
  runs it inline via the `Skill` tool (no subagent dispatch — see the `maestro-architecture` skill).

## Edges

- `successEdge` — the solid straight path (`#94a3b8`), `bottom → top`. Following it on success is the
  happy path; reaching the terminal node = task complete.
- `conditionEdge` — orange dashed + animated, drawn from a `left`/`right` handle → `top`, with a
  label. Used to branch back to an earlier step or off to a secondary path. The label box always
  renders an inline `✎` edit button — showing the label text, or a dashed `no label` placeholder when
  empty — so a missing label can still be filled in.

## Layout and viewport

**`applyDagreLayout`** (dagre, `rankdir: "TB"`) runs whenever the workflow's nodes have no saved
`position`, including brand-new empty workflows with only the synthetic main-session node. Once
positions exist in `maestro.json` they're honored, and any drag persists back into each node's
`position`.

**`FitViewEffect`** — a small module-level component rendered inside `ReactFlowProvider` that calls
`useReactFlow().fitView()` imperatively (50 ms debounce) whenever `workflow.name` changes. This
handles viewport re-centering when switching workflows, since `fitView` as a ReactFlow prop only
fires on mount.

## State sync pattern

`handleNodesChange` and `handleEdgesChange` read latest state via `rfNodesRef`/`rfEdgesRef` (updated
each render) instead of using functional updater form. `pushChange` (→ `onChange` → parent
`setConfig`) is guarded by three rules:

- **Skip `dimensions` and `select`** — React Flow internal events; pushing them triggers "setState
  during render" on the parent.
- **Push `position` only on drag-end** (`c.dragging === false`) — pushing on every mousemove would
  cause `setConfig` → new `workflow` prop → sync effect rebuilds RF state mid-drag → blink.
  `handleEdgesChange` still pushes on every change (no drag).
- **Echo guard** — `pushChange` stores the emitted `MaestroWorkflowV3` object in `lastEmittedRef`.
  The sync `useEffect` skips re-building RF state when `workflow === lastEmittedRef.current`,
  preventing the parent's echoed update from resetting the canvas.

## Things that bite

- **`NODE_TYPES`/`EDGE_TYPES` must stay module-level.** Moving them inside the component recreates
  the maps each render and React Flow remounts every node (loses selection, flickers).
- **Register every edge `type` string in `EDGE_TYPES`.** Creating an edge with `type: "successEdge"`
  while omitting it from `EDGE_TYPES` makes React Flow warn on every render and fall back to the
  default edge.
- **Layout auto-runs for any workflow without saved positions** — including empty ones (only
  main-session). The old guard `nodes.length > 1` was removed; dagre handles single-node graphs
  correctly.
- **Don't call `pushChange` inside a state updater.** React Flow emits `dimensions` changes during
  its commit phase (node measurement). Inside `setRfNodes(nds => { pushChange(...); return nds })` it
  triggers `setConfig` on the parent during render and React warns. Always call `pushChange` outside
  the setter, and skip it for `dimensions`/`select`.
- **Don't push position changes mid-drag.** Guard with `c.dragging === false` so positions only
  propagate on drop.
- **Handles must be siblings of the content div, not children.** Placing handles inside a flex/grid
  container makes React Flow position them relative to the container's height, landing them between
  elements instead of at the node's edge. Render handles in a `<>` fragment alongside the content
  `<div>`, as in `AgentNodeComponent` and the current `MainSessionNode`.
- **`@xyflow/react` base CSS must be explicitly imported.** React Flow v12 does not auto-inject
  styles. Without `import "@xyflow/react/dist/style.css"` nodes collapse to zero size
  (`.react-flow__node { position: absolute }` is missing). This import lives at the top of
  `workflow-canvas.tsx`.

For edge-label anchors, bezier control points and node bounds arithmetic, see the
`react-flow-canvas-geometry` skill.
