// Small pure string helpers, shared by the node side and the renderer.
//
// THE ONE HOME. These existed twice — `apps/ai-tools-manager/src/utils/text.ts` for the web app's
// create-* forms and a trimmed copy in `apps/maestro/src/renderer/src/utils/text.ts` for the
// session log's origin labels — and the two were about to diverge, because the description a
// create form PREVIEWS and the description the scaffold WRITES have to be the same string. A
// preview that renders one `buildDesc` and a scaffold that writes another is a lie the user only
// finds after the file is on disk.
//
// It lives beside the node-side modules rather than in the renderer so both processes can reach
// it, and it is one of the two modules under src/core the renderer is allowed to import — this
// file has no imports at all. Not `./index.js`, which re-exports fs and child_process and must
// never cross into the renderer; test/isolation.test.ts holds the line.

export function firstSentence(s: string): string {
  const m = s.match(/^[^.!?]+[.!?]/);
  return m ? m[0].trim() : s.trim();
}

/** Drop a plugin/marketplace namespace prefix: "maestro:frontend" -> "frontend". */
export function stripNamespace(name: string): string {
  const i = name.lastIndexOf(":");
  return i === -1 ? name : name.slice(i + 1);
}

export function titleFromName(name: string, fallback = "my-thing"): string {
  return (name || fallback)
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function joinOxford(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return items.slice(0, -1).join(", ") + " or " + items.slice(-1)[0];
}

/**
 * The `description:` frontmatter value, from what the form collected.
 *
 * Auto mode summarises the idea and appends the triggers as a "Use when …" clause — the shape
 * Claude Code matches a skill/agent against. Manual mode takes the user's own sentence verbatim.
 */
export function buildDesc(
  mode: "auto" | "manual",
  idea: string,
  triggers: string[],
  opts: { manualFallback?: string; whatFallback?: string } = {}
): string {
  const { manualFallback = "<short description of what this does>", whatFallback = "<what this does>" } = opts;
  if (mode === "manual") return idea.trim() || manualFallback;
  const what = firstSentence(idea) || whatFallback;
  if (!triggers.length) return `${what} Use when <add triggers on the left>.`;
  return `${what} Use when ${joinOxford(triggers)}.`;
}

export function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/**
 * A kebab-case artifact name derived from free text, for a form that left the name blank.
 *
 * Deliberately dull: the first word, lowercased. The alternative — asking a model to name the
 * artifact — would put the directory name on the far side of a confirmation the user has not
 * given yet, and the scaffold has to write the file before any of that happens.
 */
export function deriveName(idea: string, fallback: string): string {
  const first = titleFromName(idea.trim()).split(" ")[0]?.toLowerCase() ?? "";
  const cleaned = first.replace(/[^a-z0-9-]/g, "");
  return /^[a-z]/.test(cleaned) ? cleaned : fallback;
}
