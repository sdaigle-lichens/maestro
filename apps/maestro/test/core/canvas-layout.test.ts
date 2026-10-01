import { describe, it, expect } from "vitest";
import {
  alignMainSession,
  DAGRE_NODE_BASE_HEIGHT,
  DAGRE_RANK_SEP,
  hasSavedPositions,
  MAIN_SESSION_RANK_OFFSET,
} from "../../src/core/canvas-layout.js";

const node = (id: string, x: number, y: number) => ({ id, position: { x, y } });

describe("alignMainSession", () => {
  it("places main-session at the first step's x, one rank above it", () => {
    const nodes = [node("main-session", 0, 0), node("a", 300, 500), node("b", 10, 900)];
    const out = alignMainSession(nodes, [{ source: "main-session", target: "a", type: "successEdge" }]);
    expect(out.find((n) => n.id === "main-session")!.position).toEqual({ x: 300, y: 500 - MAIN_SESSION_RANK_OFFSET });
    expect(out.find((n) => n.id === "a")).toBe(nodes[1]);
  });

  it("returns nodes unchanged when there is no success entry edge", () => {
    const nodes = [node("main-session", 0, 0), node("a", 300, 500)];
    expect(alignMainSession(nodes, [])).toBe(nodes);
    expect(alignMainSession(nodes, [{ source: "main-session", target: "a", type: "conditionEdge" }])).toBe(nodes);
  });

  it("returns nodes unchanged when the entry target is missing", () => {
    const nodes = [node("main-session", 0, 0)];
    expect(alignMainSession(nodes, [{ source: "main-session", target: "ghost", type: "successEdge" }])).toBe(nodes);
  });

  it("derives the offset from the dagre rank spacing", () => {
    expect(MAIN_SESSION_RANK_OFFSET).toBe(DAGRE_NODE_BASE_HEIGHT + DAGRE_RANK_SEP);
    expect(MAIN_SESSION_RANK_OFFSET).toBe(140);
  });
});

describe("hasSavedPositions", () => {
  const pos = { x: 1, y: 2 };

  it("is false when no node has a saved position (canvas runs dagre)", () => {
    expect(hasSavedPositions([{ id: "a" }, { id: "b", position: undefined }, { id: "c", position: null }])).toBe(false);
  });

  it("is false for an empty workflow", () => {
    expect(hasSavedPositions([])).toBe(false);
  });

  it("is true when every node has a saved position, including the origin", () => {
    expect(hasSavedPositions([{ position: pos }, { position: { x: 0, y: 0 } }])).toBe(true);
  });

  it("is false when only some nodes have a saved position (partial)", () => {
    expect(hasSavedPositions([{ position: pos }, { id: "b" }])).toBe(false);
  });
});
