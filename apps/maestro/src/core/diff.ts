// A line diff, pure and dependency-free.
//
// `031` needs the SAME diff on two surfaces that share no code: the `/agents` review card renders
// it as coloured rows, and the `maestro`/`maestro-update` skills print it to a terminal. Rather
// than a renderer-side differ plus a second one in the CJS lib the skills call — two chances to
// disagree about what "this fork diverged" looks like — main computes `DiffLine[]` once and both
// sides render the same array. `unifiedDiffText` is the terminal's renderer of it.
//
// Nothing here is a general-purpose diff library: the inputs are two versions of one agent
// definition, a few hundred lines at most, so a plain LCS table is both fast enough and much
// easier to be sure of than a Myers implementation nobody will re-derive. `MAX_LINES` bounds the
// table anyway, and a file past it degrades to "replaced wholesale" rather than to a hung window.

import type { DiffLine } from "./contracts.js";

export type { DiffLine };

/** Past this many lines on either side, the O(n·m) table is abandoned for a whole-file replace. */
const MAX_LINES = 4000;

function splitLines(s: string): string[] {
  // A trailing newline would otherwise produce a phantom empty last line on both sides.
  const lines = s.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Every line of both sides, in order, tagged with what happened to it. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);

  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return [
      ...a.map((text): DiffLine => ({ kind: "del", text })),
      ...b.map((text): DiffLine => ({ kind: "add", text })),
    ];
  }

  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "ctx", text: a[i] });
      i++;
      j++;
      // Deletions first, so a changed line reads as `-old` then `+new` rather than the reverse.
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: "del", text: a[i++] });
    } else {
      out.push({ kind: "add", text: b[j++] });
    }
  }
  while (i < a.length) out.push({ kind: "del", text: a[i++] });
  while (j < b.length) out.push({ kind: "add", text: b[j++] });
  return out;
}

export function hasChanges(lines: DiffLine[]): boolean {
  return lines.some((l) => l.kind !== "ctx");
}

/**
 * The terminal rendering: `+`/`-`/` ` prefixes, with unchanged runs longer than `context * 2 + 1`
 * elided to a `@@ … @@`-style marker. Full context on a 300-line agent definition is a wall of
 * unchanged prose the reader has to scroll past to find the three lines that moved.
 */
export function unifiedDiffText(lines: DiffLine[], context = 3): string {
  const keep = new Array<boolean>(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].kind === "ctx") continue;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  }

  const out: string[] = [];
  let skipped = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!keep[i]) {
      skipped++;
      continue;
    }
    if (skipped > 0) {
      out.push(`@@ ${skipped} unchanged line${skipped === 1 ? "" : "s"} @@`);
      skipped = 0;
    }
    const l = lines[i];
    out.push(`${l.kind === "add" ? "+" : l.kind === "del" ? "-" : " "}${l.text}`);
  }
  if (skipped > 0) out.push(`@@ ${skipped} unchanged line${skipped === 1 ? "" : "s"} @@`);
  return out.join("\n");
}
