// Search-term highlighting for a plain string — the result rows in the docs search.
//
// The doc BODY is highlighted by `rehypeHighlightTerms` instead (see ../utils/highlight.ts): the
// markdown is a tree, not a string, and marking it up at the tree is what makes a term inside a
// link or a list item light up too.
//
// help-server used `react-highlight-words` for both. It is not carried across: the whole of what
// this app asks of it is "wrap every case-insensitive occurrence of one literal in a <mark>", and
// the renderer bundle is the thing the merge plan asked us to watch (it was 2.34 MB unsplit).

import { useMemo } from "react";
import { MARK_CLASS, termPattern } from "../utils/highlight";

export interface HighlightTextProps {
  text: string;
  /** Blank/empty terms are ignored, so callers can pass a search box's value straight through. */
  terms: string[];
  className?: string;
}

export default function HighlightText({ text, terms, className }: HighlightTextProps) {
  const pattern = useMemo(() => termPattern(terms), [terms]);

  if (!pattern) return <>{text}</>;

  // split() on a capturing group keeps the delimiters, so odd indices are the matches.
  const pieces = text.split(pattern);
  return (
    <>
      {pieces.map((piece, i) =>
        i % 2 === 1 ? (
          <mark key={i} className={className ?? MARK_CLASS}>
            {piece}
          </mark>
        ) : (
          <span key={i}>{piece}</span>
        )
      )}
    </>
  );
}
