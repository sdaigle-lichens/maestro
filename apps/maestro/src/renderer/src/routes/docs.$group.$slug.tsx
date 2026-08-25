// /docs/$group/$slug — the GLOBAL documentation reader, over the fixed corpus
// `window.maestro.data.globalDocs()`/`.globalDoc()` serve (the Maestro app's own docs). NOT gated
// on an open project. `$group` stays a route param (always "app" today) so a second global corpus
// could be added later without a route shape change.
//
// Same rendering stack as `/project-docs/$slug` — react-markdown + remark-gfm + heading anchors +
// term highlighting — this is a sibling reader over a different pair of corpora, not a fork of
// the parsing logic (that lives once, in `src/core/docs.ts`'s `*In` primitives).

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, PanelLeft } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import TopNav from "../components/top-nav";
import SlidePanel from "@repo/ui/slide-panel";
import { callMain } from "../utils/call-main";
import { getGlobalDoc, getGlobalDocsData } from "../utils/docs";
import { rehypeHighlightTerms } from "../utils/highlight";
import type { DocMeta } from "../../../shared/ipc";

export const Route = createFileRoute("/docs/$group/$slug")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : "",
    at: typeof search.at === "string" ? search.at : "",
  }),
  loader: async ({ params }) => {
    const group = "app" as const;
    void params.group; // only "app" exists today; kept as a route param, see file header.
    return {
      group,
      doc: await callMain(() => getGlobalDoc(group, params.slug)),
      list: await callMain(() => getGlobalDocsData()),
    };
  },
  component: GlobalDocPage,
});

/** Same slugify as `src/core/docs.ts` uses to build the search index — the two are one anchor. */
function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

/** react-markdown hands heading children as nodes; the anchor id needs the flat text. */
function flatten(children: React.ReactNode): string {
  if (children === null || children === undefined || typeof children === "boolean") return "";
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(flatten).join("");
  if (typeof children === "object" && "props" in children)
    return flatten((children as { props: { children?: React.ReactNode } }).props.children);
  return "";
}

/** The doc list for the group this reader is currently in — used by the "all docs" side panel. */
function GroupDocsPanel({
  isOpen,
  onClose,
  group,
  docs,
}: {
  isOpen: boolean;
  onClose: () => void;
  group: "app";
  docs: DocMeta[];
}) {
  return (
    <SlidePanel isOpen={isOpen} onClose={onClose} side="left" widthClass="w-80" toggleDataAttr="data-docs-toggle">
      <div className="flex items-center border-b border-(--line) px-4 py-3">
        <span className="section-label">Maestro</span>
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        <ul className="m-0 list-none p-0">
          {docs.map((doc) => (
            <li key={doc.slug}>
              <Link
                to="/docs/$group/$slug"
                params={{ group, slug: doc.slug }}
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

function GlobalDocPage() {
  const { doc, list, group } = Route.useLoaderData();
  const { q, at } = Route.useSearch();
  const { slug } = Route.useParams();
  const [panelOpen, setPanelOpen] = useState(false);
  const navigate = useNavigate();
  const terms = q.trim() ? [q.trim()] : [];

  useEffect(() => {
    if (!at || !doc.ok) return;
    const el = document.getElementById(at);
    if (!el) return;
    const timer = setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    return () => clearTimeout(timer);
  }, [at, doc.ok, slug]);

  const heading = (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") =>
    function Heading({ children }: { children?: React.ReactNode }) {
      return <Tag id={slugifyHeading(flatten(children))}>{children}</Tag>;
    };

  const components = {
    h1: heading("h1"),
    h2: heading("h2"),
    h3: heading("h3"),
    h4: heading("h4"),
    h5: heading("h5"),
    h6: heading("h6"),
    a({ href, children }: { href?: string; children?: React.ReactNode }) {
      if (href?.startsWith("#")) {
        return (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            {children}
          </a>
        );
      }
      const sibling = href?.match(/^\.?\/?([\w-]+)\.md$/);
      if (sibling) {
        return (
          <Link to="/docs/$group/$slug" params={{ group, slug: sibling[1] }} search={{ q: "", at: "" }}>
            {children}
          </Link>
        );
      }
      return (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      );
    },
  };

  const groupDocs = list.ok ? list.value.app : [];

  return (
    <div className="w-full h-screen bg-(--bg) font-sans text-(--ink) flex flex-col overflow-hidden">
      <TopNav />

      <div className="flex items-center gap-2 px-4 py-2 border-b border-(--line) shrink-0">
        <button
          type="button"
          data-docs-toggle
          onClick={() => setPanelOpen((v) => !v)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] text-(--ink-2) hover:text-(--ink) bg-transparent border-0 cursor-pointer focus:outline-none"
        >
          <PanelLeft size={13} /> Maestro docs
        </button>
        <Link
          to="/docs"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] text-(--ink-2) hover:text-(--ink)"
        >
          <ArrowLeft size={13} /> Search
        </Link>
        <div className="flex-1" />
        <span className="font-mono text-[11px] text-(--ink-3) truncate">
          {group}/{slug}.md
        </span>
        {q.trim() && (
          <button
            type="button"
            onClick={() =>
              void navigate({ to: "/docs/$group/$slug", params: { group, slug }, search: { q: "", at: "" } })
            }
            className="px-2 py-0.5 rounded-md text-[11px] text-primary bg-(--primary-dim) border border-ring cursor-pointer focus:outline-none"
          >
            highlighting “{q.trim()}” — clear
          </button>
        )}
      </div>

      <GroupDocsPanel isOpen={panelOpen} onClose={() => setPanelOpen(false)} group={group} docs={groupDocs} />

      <div className="flex-1 overflow-y-auto">
        {!doc.ok ? (
          <div className="mx-auto max-w-3xl px-6 py-10">
            <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-red-500/10">
              <AlertTriangle size={16} className="shrink-0 mt-px text-red-500" />
              <div>
                <p className="text-[13px] text-(--ink) m-0 mb-1">
                  Could not open{" "}
                  <span className="font-mono">
                    {group}/{slug}.md
                  </span>
                  .
                </p>
                <p className="text-[12px] text-(--ink-2) m-0">{doc.error}</p>
              </div>
            </div>
          </div>
        ) : (
          <article className="mx-auto max-w-3xl px-6 py-10">
            <div className="prose prose-neutral max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlightTerms(terms)]}
                components={components}
              >
                {doc.value.content}
              </ReactMarkdown>
            </div>
          </article>
        )}
      </div>
    </div>
  );
}
