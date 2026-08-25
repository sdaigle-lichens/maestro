// Client-side data access for the documentation reader, plus the search that runs over it.
//
// The filtering is here rather than in the main process on purpose: the corpus already crossed
// the wire with the doc list (`data:docs`), so matching it is a pure function of data the renderer
// holds, and a round trip per keystroke would buy nothing but latency.

import type { DocContent, DocSection, DocsData, GlobalDocsData } from "../../../shared/ipc";

export type { DocContent, DocMeta, DocSection, DocsData, GlobalDocsData } from "../../../shared/ipc";

export function getDocsData(): Promise<DocsData> {
  return window.maestro.data.docs();
}

/** Rejects on a bad slug or an unreadable file — call it through `callMain`. */
export function getDoc(slug: string): Promise<DocContent> {
  return window.maestro.data.doc(slug);
}

/** The global Docs page's landing data — NOT gated on an open project. */
export function getGlobalDocsData(): Promise<GlobalDocsData> {
  return window.maestro.data.globalDocs();
}

/** Rejects on a bad slug/group or an unreadable file — call it through `callMain`. */
export function getGlobalDoc(group: "app", slug: string): Promise<DocContent> {
  return window.maestro.data.globalDoc(group, slug);
}

/** How many hits the dropdown shows before it stops. Ported from help-server's search store. */
export const MAX_SEARCH_RESULTS = 10;

/**
 * Sections matching `query`, heading and body alike.
 *
 * Matching the BODY is what makes this useful — most of what a reader is looking for is a phrase
 * in a paragraph, not a heading — while the hit is reported at its heading, which is the anchor
 * the reader can be scrolled to.
 */
export function filterSections(sections: DocSection[], query: string): DocSection[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return sections
    .filter(
      (s) =>
        s.headingText.toLowerCase().includes(needle) ||
        s.bodyText.toLowerCase().includes(needle) ||
        s.docTitle.toLowerCase().includes(needle)
    )
    .slice(0, MAX_SEARCH_RESULTS);
}

/** A few words of context around the first hit, so a result row shows why it matched. */
export function excerptAround(text: string, query: string, radius = 60): string {
  const idx = text.toLowerCase().indexOf(query.trim().toLowerCase());
  if (idx === -1) return text.slice(0, radius * 2).trim();
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}
