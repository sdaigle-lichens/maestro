// Matching a search term, and marking it up inside rendered markdown.
//
// The second half of this file exists because of a bug the port inherited. help-server highlighted
// the doc body by passing react-markdown a `text` entry in its `components` map — but `components`
// is keyed by ELEMENT NAME, and `text` is the SVG `<text>` element, not a text node. It type-checks
// (the key is a real JSX intrinsic), it renders, and it silently highlights nothing: a search hit
// opened the right doc at the right heading with the term nowhere marked in the paragraph that
// matched. Verified in a window before the fix — zero `<mark>` elements in the article — and after.
//
// Text nodes are reachable from a rehype plugin, so that is where the marking happens now.

/** Every term is a LITERAL — a doc search for `a.b(c)` must not compile to a pattern. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * One case-insensitive alternation over the non-blank terms, with a capturing group so
 * `String.prototype.split` keeps the matches at the odd indices. Null when nothing is searched.
 */
export function termPattern(terms: string[]): RegExp | null {
  const parts = terms.map((t) => t.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  return new RegExp(`(${parts.map(escapeRegExp).join("|")})`, "gi");
}

export const MARK_CLASS = "bg-(--primary-dim-2) text-primary rounded-sm px-0.5";

/** The subset of hast this walk needs. Kept local: `hast` is not a dependency of this app. */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/**
 * A rehype plugin that wraps every occurrence of `terms` in a `<mark>`.
 *
 * Works on the tree rather than on the rendered output, so a term is highlighted wherever it
 * appears — inside a paragraph, a list item, a table cell, a link, emphasis — without this having
 * to know which elements can contain prose.
 */
export function rehypeHighlightTerms(terms: string[]) {
  const pattern = termPattern(terms);
  return () => (tree: HastNode) => {
    if (!pattern) return tree;

    const walk = (node: HastNode): void => {
      if (!node.children) return;
      const out: HastNode[] = [];
      for (const child of node.children) {
        if (child.type !== "text" || typeof child.value !== "string") {
          out.push(child);
          walk(child);
          continue;
        }
        // `split` on a capturing group keeps the delimiters; odd indices are the matches. The
        // pattern is global, so reset lastIndex — a stale one silently skips the next node.
        pattern.lastIndex = 0;
        const pieces = child.value.split(pattern);
        if (pieces.length === 1) {
          out.push(child);
          continue;
        }
        pieces.forEach((piece, i) => {
          if (!piece) return;
          out.push(
            i % 2 === 1
              ? {
                  type: "element",
                  tagName: "mark",
                  properties: { className: MARK_CLASS },
                  children: [{ type: "text", value: piece }],
                }
              : { type: "text", value: piece }
          );
        });
      }
      node.children = out;
    };

    walk(tree);
    return tree;
  };
}
