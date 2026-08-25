// /project-docs/$slug — the documentation reader, over the OPEN PROJECT's own `docs/`.
//
// Moved from `/docs/$slug` — that path now belongs to the global reader (routes/docs.$group.$slug.tsx)
// — with no other behavior change. PORTED FROM apps/help-server/src/routes/docs/$slug.tsx. The
// rendering stack is unchanged and
// deliberately so: `react-markdown` + `remark-gfm` + `prose prose-neutral` is exactly what
// /maestro-tasks already renders task files with, so there was nothing to reconcile.
//
// What did change is how a section is addressed. help-server put the heading in the URL fragment
// and read `window.location.hash`; this app runs on hash history (a packaged build loads over
// `file://`), so the route itself already lives in `location.hash` and a second `#` inside it is
// not something either the router or `querySelector` can be trusted to split. The heading travels
// as the `at` search param instead, and the scroll is done by element id.

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, PanelLeft } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import TopNav from "../components/top-nav";
import DocsPanel from "../components/docs-panel";
import { callMain } from "../utils/call-main";
import { getDoc, getDocsData } from "../utils/docs";
import { rehypeHighlightTerms } from "../utils/highlight";

export const Route = createFileRoute("/project-docs/$slug")({
  validateSearch: (search: Record<string, unknown>) => ({
    /** The term to highlight, carried from search so a hit is visible in the body it matched. */
    q: typeof search.q === "string" ? search.q : "",
    /** Heading id to scroll to. See the note above on why this is not a URL fragment. */
    at: typeof search.at === "string" ? search.at : "",
  }),
  // Both through `callMain`. `data:doc` REJECTS on a missing or unreadable file — that is the
  // whole reason it rejects rather than returning "" — so the page has to be able to say which
  // doc failed and why, instead of rendering an empty article.
  loader: async ({ params }) => ({
    doc: await callMain(() => getDoc(params.slug)),
    list: await callMain(() => getDocsData()),
  }),
  component: DocPage,
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

function DocPage() {
  const { doc, list } = Route.useLoaderData();
  const { q, at } = Route.useSearch();
  const { slug } = Route.useParams();
  const [panelOpen, setPanelOpen] = useState(false);
  const navigate = useNavigate();
  const terms = q.trim() ? [q.trim()] : [];

  // Scroll to the section a search hit named. Runs after the markdown has rendered its headings,
  // and re-runs when `at` changes so a second hit in the SAME doc still moves the page.
  useEffect(() => {
    if (!at || !doc.ok) return;
    const el = document.getElementById(at);
    if (!el) return;
    const timer = setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    return () => clearTimeout(timer);
  }, [at, doc.ok, slug]);

  // The anchor a search hit scrolls to, derived from the heading's own text — the same slugify
  // `src/core/docs.ts` used when it built the section index. `children` may already carry <mark>
  // elements by the time this runs (the highlighter is a rehype pass), so the id comes from the
  // FLATTENED text rather than from the node, or a highlighted heading would get a different id
  // than the unhighlighted one and every deep link into it would scroll nowhere.
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
    // Links, three kinds. In-page anchors scroll instead of navigating — under hash history an
    // `href="#x"` would rewrite the route itself and throw the reader out of the app. Sibling
    // `*.md` links become route navigations, which is what makes cross-referencing docs work.
    // Everything else opens in the OS browser via the window-open handler in src/main/index.ts;
    // a same-frame navigation would replace the whole application with a web page.
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
          <Link to="/project-docs/$slug" params={{ slug: sibling[1] }} search={{ q: "", at: "" }}>
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
          <PanelLeft size={13} /> All docs
        </button>
        <Link
          to="/project-docs"
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] text-(--ink-2) hover:text-(--ink)"
        >
          <ArrowLeft size={13} /> Search
        </Link>
        <div className="flex-1" />
        <span className="font-mono text-[11px] text-(--ink-3) truncate">docs/{slug}.md</span>
        {q.trim() && (
          <button
            type="button"
            onClick={() => void navigate({ to: "/project-docs/$slug", params: { slug }, search: { q: "", at: "" } })}
            className="px-2 py-0.5 rounded-md text-[11px] text-primary bg-(--primary-dim) border border-ring cursor-pointer focus:outline-none"
          >
            highlighting “{q.trim()}” — clear
          </button>
        )}
      </div>

      {list.ok && (
        <DocsPanel
          isOpen={panelOpen}
          onClose={() => setPanelOpen(false)}
          docs={list.value.docs}
          sections={list.value.sections}
        />
      )}

      <div className="flex-1 overflow-y-auto">
        {!doc.ok ? (
          <div className="mx-auto max-w-3xl px-6 py-10">
            <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-red-500/10">
              <AlertTriangle size={16} className="shrink-0 mt-px text-red-500" />
              <div>
                <p className="text-[13px] text-(--ink) m-0 mb-1">
                  Could not open <span className="font-mono">docs/{slug}.md</span>.
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
