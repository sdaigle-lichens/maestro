// Pure resolution: which handoff protocol is "in effect" for one `(sender, receiver)` pair, and
// where it came from.
//
// Mirrors report-resolution.ts exactly — no `fs`, no `node:sqlite` — for the same reason: the
// SubagentStart hook and the app's editing surface must never be able to disagree about what an
// agent will actually be told to emit. The caller has already done the reading (the project file's
// content, and the global tier's row) and hands both in.
//
// Order, and the one place it differs from a report:
//
//   project file (.claude/handoffs/<sender>/<receiver>.md)   the user's own
//     -> global row (~/.claude/maestro-handoff-defaults.sqlite)   this machine's default
//       -> SEED constant                                          what Maestro ships
//
// A report degrades to "none" when the global store can't be opened, and that is tolerable — the
// agent just gets no output-format block. A handoff degrading to "none" would leave the receiving
// agent with an unspecified payload shape on a route the graph explicitly wires, so the seed is a
// real tier here rather than a synonym for the global one: it is what answers when `node:sqlite`
// is missing entirely. On a healthy machine the global row IS the seed (the store self-seeds), and
// this tier never fires.

import { SEED_HANDOFFS } from "./handoff-seeds.js";

export type HandoffSource = "project" | "global" | "seed" | "none";

export interface HandoffResolution {
  source: HandoffSource;
  content: string | null;
  handoffId: string;
}

export interface GlobalHandoffInput {
  content: string;
  version: number;
}

/**
 * `projectContent` is what was read from `.claude/handoffs/<sender>/<receiver>.md` — null when the
 * file is absent or empty. `globalDefault` is the pair's row in the global store, or null when it
 * has none OR when the store could not be opened at all; the seed tier below covers both, which is
 * why the caller does not need to tell them apart.
 */
export function resolveHandoff(
  id: string,
  projectContent: string | null,
  globalDefault: GlobalHandoffInput | null
): HandoffResolution {
  if (projectContent) return { source: "project", content: projectContent, handoffId: id };
  if (globalDefault) return { source: "global", content: globalDefault.content, handoffId: id };
  const seed = SEED_HANDOFFS[id];
  if (seed) return { source: "seed", content: seed, handoffId: id };
  return { source: "none", content: null, handoffId: id };
}
