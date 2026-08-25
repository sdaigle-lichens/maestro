---
name: react-flow-canvas-geometry
description: "Compute React Flow (@xyflow) canvas geometry correctly — edge label anchors, bezier control points, handle coordinates, node bounds — so labels and edges land where you intend instead of on top of a node. Use when placing or offsetting edge labels, reimplementing getBezierPath maths outside the renderer (e.g. in a seed or layout package), bending an edge through a moved label, deciding where a node ends, or debugging an element that renders in the wrong place on the canvas."
---

# React Flow canvas geometry

Getting something to appear at the right place on an `@xyflow/react` canvas means answering three
questions: *where is the handle*, *where does the curve put the label*, and *how big is the node*.
Each has a non-obvious answer, and the first two have an answer that is **wrong in a way that looks
right**.

This skill is the arithmetic and the traps. For driving a window to check the result, use
`test-maestro-desktop`.

## The rule: import the maths, don't retype it

`@xyflow/react` re-exports the geometry helpers. Inside a renderer there is no reason to
reimplement any of this:

```ts
import { getBezierPath, getBezierEdgeCenter, getSmoothStepPath, getStraightPath,
         getEdgeCenter, getNodesBounds } from "@xyflow/react";
```

Reimplement **only** when the code cannot depend on React Flow — a framework-free package that
decides geometry ahead of render, like `apps/maestro/src/core` computing seeded `label_offset`
values. If you are in that position, go to *Checking a reimplementation* below before you trust it.

## Where the label goes

`getBezierPath` returns `[path, labelX, labelY, offsetX, offsetY]`. `labelX`/`labelY` are **the
cubic bezier evaluated at t = 0.5, not the midpoint of the drawn curve** — the library says so in
a comment, and calls it "not the actual mid point, but easy to calculate":

```
labelX = 0.125·sourceX + 0.375·sourceControlX + 0.375·targetControlX + 0.125·targetX
labelY = 0.125·sourceY + 0.375·sourceControlY + 0.375·targetControlY + 0.125·targetY
```

That is `(P0 + 3·C1 + 3·C2 + P3) / 8`. Which means you cannot get the label position without the
control points — and the control points are where the trap lives.

### Control points

```ts
function calculateControlOffset(distance, curvature) {
  if (distance >= 0) return 0.5 * distance;      // target is that way
  return curvature * 25 * Math.sqrt(-distance);  // target is behind the handle
}
```

The handle side picks the axis and the sign. **The distance is always measured from the endpoint
that owns the handle, toward the other endpoint** — React Flow calls its helper with `x1/y1` = the
own endpoint and `x2/y2` = the other one, for *both* control points:

| handle side | control point |
|---|---|
| `Left`   | `[x1 - offset(x1 - x2), y1]` |
| `Right`  | `[x1 + offset(x2 - x1), y1]` |
| `Top`    | `[x1, y1 - offset(y1 - y2)]` |
| `Bottom` | `[x1, y1 + offset(y2 - y1)]` |

For the **target** control point, `x1,y1` is the *target* and `x2,y2` is the *source*. Getting that
backwards is the single easiest mistake to make here, because it swaps which branch of
`calculateControlOffset` runs — and the two branches are numerically close over exactly the range
of distances a normal graph uses.

`0.5·d` and `6.25·√d` cross at **d = 156.25**, and stay within a few px of each other for a wide
band around it. Measured over a 4,624-case grid, a sign-flipped model still lands **within 3px of
the library in 51.6% of cases**. In the real graph that produced this skill, a back-route spanning
165px agreed with the wrong formula to under 1px — while the same model was **34px out** on a 445px
span, enough to put a label inside a node.

**This is why spot-checking two labels in a rendered window proves nothing.** It is a real bug that
cost a debugging cycle in `apps/maestro/src/core/label-layout.ts`.

### Checking a reimplementation

```bash
node .claude/skills/react-flow-canvas-geometry/scripts/check-bezier-model.mjs
```

It loads the real `getBezierPath` out of the pnpm store, runs a grid of every handle-side pair ×
17² source/target offsets, and requires agreement to 0.001px — a reimplementation should be
*exact*, not close. It also reports how many cases a deliberately wrong model would still pass, so
you can see what your manual check was actually worth. Point `model()` at your own function to
check it.

### The other path types

| helper | label anchor | notes |
|---|---|---|
| `getBezierPath` | cubic at t=0.5, needs control points | the one with the trap |
| `getStraightPath` | `getEdgeCenter` — plain midpoint | trivial |
| `getSmoothStepPath` | falls out of `getPoints`, from the routed elbow | there is **no closed formula**: it depends on `offset`, `stepPosition`, an explicit `center`, and which elbow the router chose |

If you need a smooth-step label anchor outside the renderer, don't derive it — call the helper.

## Where the handle is

Edge endpoints are **handle** coordinates, not node origins. For a node box `{x, y, w, h}` with
handles at the default positions:

```
left   → (x,         y + h/2)
right  → (x + w,     y + h/2)
top    → (x + w/2,   y      )
bottom → (x + w/2,   y + h  )
```

A custom `<Handle style={{ top: "50%" }}>` keeps the mid-edge default; if you move a handle with
CSS, this table stops being true and only the DOM knows the answer.

## How big is the node

```ts
width  = node.measured?.width  ?? node.width  ?? node.initialWidth  ?? 0
height = node.measured?.height ?? node.height ?? node.initialHeight ?? 0
```

That is `getNodeDimensions` verbatim. Two consequences:

- **`measured` is undefined until React Flow has measured the DOM.** Anything reading it on first
  render gets 0. Subscribe (`useNodes()`, `useInternalNode(id)`) so you re-render when it arrives,
  and never assert a layout is correct on frame 1.
- **Outside the renderer, height is not knowable.** Card *widths* are usually fixed by a class
  (`w-44` → 176px) and positions are yours, so **x is exact**. Height depends on content that
  wraps: in Maestro, five nodes carrying 1–4 skill chips measured 78/78/103/129/129px against a
  "50 + 30 per skill" model's 80/110/110/170/170, because chips wrap by text width and often share
  a row.

### The design that follows from that

If you must place something clear of the nodes from outside the renderer, **place it by x**. Find
the vertical corridors that no node occupies at any height — the gaps between node columns, plus
the open space past the last one — and centre the element in one. Clearance then depends only on
the exact quantity, never on the guessed one. Let the height model decide only *which* free slot
in the lane, where being 20px out is cosmetic.

`apps/maestro/src/core/label-layout.ts` is the worked example; its test runs every case against
four different height models precisely because the placement's claim is that height cannot matter.

## Moving a label, and bending the edge to follow

`EdgeLabelRenderer` children are absolutely positioned in flow space. The standard transform

```tsx
transform: `translate(-50%, -50%) translate(${labelX + offset.x}px, ${labelY + offset.y}px)`
```

means **the div's centre sits exactly on the anchor** — so a label's box is
`(anchorX ± w/2, anchorY ± h/2)`, which is what you test node overlap against.

To redraw the edge so it passes through a label the user dragged, a quadratic through the label at
t = 0.5 is the cheap answer. `B(0.5) = (P0 + 2·CP + P2)/4`, so:

```
CP = 2·L − (P0 + P2)/2
```

That is the `hasOffset` branch in `workflow-canvas.tsx`. Note it replaces the cubic with a
quadratic, so the curve's *shape* changes as soon as an offset is non-zero — if you seed offsets,
you are also changing how every seeded edge is drawn. Decide whether you want that; if not, keep
the original `edgePath` and move only the label.

## Persisting positions

A stored offset should be the exception, not the rule: emit one only for elements that actually
needed moving, and round it (multiples of 10 read as chosen values rather than measurements). A
seeded offset must stay a *starting* position — the drag handler writes over it, so anything that
recomputes offsets on load will fight the user. Compute at seed time, persist, then leave it alone.

## Traps, short list

- `labelX/labelY` is t=0.5, **not** the curve's midpoint, and **not** the midpoint of source and
  target.
- The target control point measures distance **target → source**, not source → target.
- The two `calculateControlOffset` branches agree closely near d ≈ 156, so a wrong formula passes
  casual inspection ~half the time. Use the grid.
- `measured` is undefined on first render; a geometry assertion on frame 1 is vacuous.
- Node **x** is exact and node **height** is not. Build placement on the exact one.
- A non-zero `label_offset` changes the drawn curve, not just the label, if your edge component
  reroutes through the label.
- Reading a rect after `scrollIntoView` inside the flow pane gives coordinates that hit-testing
  does not honour — see `test-maestro-desktop`.

## Verifying

Arithmetic agreeing with itself is not evidence. The grid script settles "does my model match the
library"; a rendered window settles "does the result look right". Both, in that order — a unit test
that shares the box model under test will happily confirm a wrong one.
