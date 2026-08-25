// Docs search — the per-heading one, ported from help-server's header dropdown.
//
// The corpus arrives with the doc list (`data:docs`), so this filters in memory: no round trip per
// keystroke, and no chance of the results describing a different revision of the docs than the
// list beside them. What a hit carries is a SECTION, not a file — the slug plus the heading id —
// which is what lets the reader scroll to the paragraph and highlight the term in place.

import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import HighlightText from "./highlight-text";
import { excerptAround, filterSections, type DocSection } from "../utils/docs";

export default function DocsSearch({
  sections,
  autoFocus = false,
  onNavigate,
  placeholder = "Search the docs…",
}: {
  sections: DocSection[];
  autoFocus?: boolean;
  /** Called after a result is chosen — the slide panel uses it to close itself. */
  onNavigate?: () => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const results = useMemo(() => filterSections(sections, query), [sections, query]);
  const terms = query.trim() ? [query.trim()] : [];

  const open = (section: DocSection) => {
    // `at`, not a URL fragment. The app runs on hash history (a packaged build loads over
    // file://), so the whole route already lives in `location.hash` and a second `#` in it is
    // ambiguous. A search param survives that, and the reader scrolls to it by element id.
    //
    // A section carries `group` only when it came from the GLOBAL reader's combined corpus
    // (`/docs`); a project-scoped section (from `/project-docs`) has none, since its one corpus
    // has no need to disambiguate itself. The two readers therefore live at different routes.
    if (section.group) {
      void navigate({
        to: "/docs/$group/$slug",
        params: { group: section.group, slug: section.slug },
        search: { q: query.trim(), at: section.headingId },
      });
    } else {
      void navigate({
        to: "/project-docs/$slug",
        params: { slug: section.slug },
        search: { q: query.trim(), at: section.headingId },
      });
    }
    onNavigate?.();
  };

  return (
    <div className="flex flex-col gap-3 min-h-0">
      <div
        className={`flex items-center gap-2 rounded-md border bg-(--bg-elev) px-3 py-1.5 transition-colors ${
          query ? "border-primary" : "border-(--line)"
        }`}
      >
        <Search size={12} className="shrink-0 text-subtle" />
        <input
          type="search"
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-transparent text-[13px] text-(--ink) placeholder-subtle outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="shrink-0 text-subtle hover:text-(--ink) cursor-pointer bg-transparent border-0 p-0 focus:outline-none"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {query.trim() && (
        <div className="flex flex-col gap-1 overflow-y-auto min-h-0">
          {results.length === 0 ? (
            <p className="text-[12px] text-subtle px-1 py-2 m-0">No section matches “{query.trim()}”.</p>
          ) : (
            results.map((section) => (
              <button
                key={`${section.slug}#${section.headingId}`}
                type="button"
                onClick={() => open(section)}
                className="text-left rounded-lg border border-(--line) bg-(--bg-elev) px-3 py-2 cursor-pointer hover:border-primary focus:outline-none"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] text-(--ink) truncate">
                    <HighlightText text={section.headingText} terms={terms} />
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {section.group && (
                      <span className="rounded-md border border-(--line) bg-(--bg-elev) px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-subtle">
                        {section.group === "app" ? "Maestro" : "Claude Code"}
                      </span>
                    )}
                    <span className="font-mono text-[10px] text-(--ink-3)">{section.docTitle}</span>
                  </span>
                </div>
                <p className="text-[12px] text-(--ink-2) m-0 mt-0.5 line-clamp-2">
                  <HighlightText text={excerptAround(section.bodyText, query)} terms={terms} />
                </p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
