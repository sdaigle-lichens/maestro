// The docs list, as a slide-out panel on the reader route.
//
// help-server had this as a permanent left sidebar with its own toggle in the app header. Here the
// reader is one route among several and the panel is opened from within it, so a doc gets the full
// width until the reader asks to move.

import { Link } from "@tanstack/react-router";
import SlidePanel from "@repo/ui/slide-panel";
import DocsSearch from "./docs-search";
import type { DocMeta, DocSection } from "../utils/docs";

export default function DocsPanel({
  isOpen,
  onClose,
  docs,
  sections,
}: {
  isOpen: boolean;
  onClose: () => void;
  docs: DocMeta[];
  sections: DocSection[];
}) {
  return (
    <SlidePanel isOpen={isOpen} onClose={onClose} side="left" widthClass="w-80" toggleDataAttr="data-docs-toggle">
      <div className="flex items-center border-b border-(--line) px-4 py-3">
        <span className="section-label">Docs</span>
      </div>

      <div className="px-4 py-3 border-b border-(--line)">
        <DocsSearch sections={sections} onNavigate={onClose} placeholder="Search…" />
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        <ul className="m-0 list-none p-0">
          {docs.map((doc) => (
            <li key={doc.slug}>
              <Link
                to="/project-docs/$slug"
                params={{ slug: doc.slug }}
                search={{ q: "", at: "" }}
                onClick={onClose}
                className="flex items-center gap-2 px-4 py-2 text-[13px] text-(--ink-2) hover:bg-(--bg-elev) hover:text-(--ink)"
                activeProps={{
                  className:
                    "flex items-center gap-2 px-4 py-2 text-[13px] text-primary bg-(--primary-dim) border-l-2 border-primary",
                }}
              >
                {doc.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </SlidePanel>
  );
}
