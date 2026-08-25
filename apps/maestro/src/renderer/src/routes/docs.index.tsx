// /docs — the GLOBAL documentation landing page: the Maestro app's own docs.
//
// NOT gated on an open project — `window.maestro.data.globalDocs()` reads a fixed directory the app
// ships (`apps/maestro/docs/app/`), never the open project's own `docs/`. That reader lives at
// `/project-docs` now (see routes/project-docs.index.tsx) — this route took over `/docs` per the
// hamburger menu's "Docs = the global page" decision. Claude Code / Anthropic-ecosystem questions
// aren't a local corpus here — `maestro-help` answers those by fetching the official docs instead.

import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, BookOpen, FileText, MessagesSquare } from "lucide-react";
import TopNav from "../components/top-nav";
import DocsSearch from "../components/docs-search";
import { callMain } from "../utils/call-main";
import { getGlobalDocsData } from "../utils/docs";
import { useSession } from "../utils/session-context";
import type { DocMeta } from "../../../shared/ipc";

export const Route = createFileRoute("/docs/")({
  loader: async () => callMain(() => getGlobalDocsData()),
  component: GlobalDocsIndex,
});

function DocList({ group, docs }: { group: "app"; docs: DocMeta[] }) {
  if (docs.length === 0) return <p className="text-[13px] text-subtle m-0">Nothing here yet.</p>;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {docs.map((doc) => (
        <Link
          key={doc.slug}
          to="/docs/$group/$slug"
          params={{ group, slug: doc.slug }}
          search={{ q: "", at: "" }}
          className="flex items-start gap-2.5 rounded-lg border border-(--line) bg-(--bg-elev) px-3 py-2.5 hover:border-primary"
        >
          <FileText size={14} className="shrink-0 mt-0.5 text-(--ink-3)" />
          <span className="min-w-0">
            <span className="block text-[13px] text-(--ink) truncate">{doc.title}</span>
            <span className="block font-mono text-[11px] text-(--ink-3) truncate">{doc.slug}.md</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

function GlobalDocsIndex() {
  const result = Route.useLoaderData();
  const session = useSession();

  return (
    <div className="w-full h-screen bg-(--bg) font-sans text-(--ink) flex flex-col overflow-hidden">
      <TopNav />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 pb-16 pt-10 flex flex-col gap-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="section-label mb-3 inline-block">Documentation</span>
              <h1 className="text-2xl font-semibold text-(--ink) m-0 mb-1">Docs</h1>
              <p className="text-[13px] text-subtle m-0">
                Maestro the app — available with no project open. Search matches headings and body text, and opens
                the doc at the section that matched.
              </p>
            </div>
            <button
              type="button"
              onClick={() => session.setOpen(true)}
              className="shrink-0 flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] border bg-(--bg-elev) border-(--line) text-(--ink-2) hover:text-(--ink) cursor-pointer focus:outline-none"
              title="Ask about these docs in the session pane"
            >
              <MessagesSquare size={13} /> Discuss with Claude
            </button>
          </div>

          {!result.ok ? (
            <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-red-500/10">
              <AlertTriangle size={16} className="shrink-0 mt-px text-red-500" />
              <div>
                <p className="text-[13px] text-(--ink) m-0 mb-1">The docs could not be listed.</p>
                <p className="text-[12px] text-(--ink-2) m-0">{result.error}</p>
              </div>
            </div>
          ) : (
            <>
              <DocsSearch sections={result.value.sections} autoFocus />

              <section>
                <div className="mb-3 flex items-center gap-3">
                  <span className="section-label">Maestro</span>
                  <span className="text-[10px] text-subtle">{result.value.app.length}</span>
                </div>
                <DocList group="app" docs={result.value.app} />
              </section>

              <p className="flex items-center gap-1.5 text-[12px] text-subtle m-0">
                <BookOpen size={12} /> {result.value.app.length} documents · {result.value.sections.length} sections
                indexed
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
