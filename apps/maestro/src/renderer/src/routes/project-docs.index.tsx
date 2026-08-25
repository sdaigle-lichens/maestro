// /project-docs — the documentation index: search across every heading, or pick a doc.
//
// help-server had no such page. Its docs were reachable only from a sidebar toggle in the app
// chrome, which works when the app IS the docs; here the reader is one section among several and
// needs a landing page of its own — something the top bar can point at, and something to say when
// the open project has no `docs/` at all.
//
// PROJECT-SCOPED — reads the OPEN PROJECT's own `docs/` directory. This used to live at `/docs`;
// that path now belongs to the global Maestro-app + Claude-Code-concepts reader (see
// routes/docs.index.tsx), and this reader moved here with its behavior otherwise unchanged.

import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, BookOpen, FileText, FolderOpen } from "lucide-react";
import TopNav from "../components/top-nav";
import DocsSearch from "../components/docs-search";
import { callMain } from "../utils/call-main";
import { getDocsData } from "../utils/docs";

export const Route = createFileRoute("/project-docs/")({
  loader: async () => callMain(() => getDocsData()),
  component: DocsIndex,
});

function DocsIndex() {
  const result = Route.useLoaderData();

  return (
    <div className="w-full h-screen bg-(--bg) font-sans text-(--ink) flex flex-col overflow-hidden">
      <TopNav />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 pb-16 pt-10 flex flex-col gap-6">
          <div>
            <span className="section-label mb-3 inline-block">Documentation</span>
            <h1 className="text-2xl font-semibold text-(--ink) m-0 mb-1">Project Docs</h1>
            <p className="text-[13px] text-subtle m-0">
              Everything under <span className="font-mono">docs/</span> in the open project. Search matches headings and
              body text, and opens the doc at the section that matched.
            </p>
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

              {result.value.docs.length === 0 ? (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 text-[12px]">
                  <FolderOpen size={14} className="shrink-0 mt-px text-amber-500" />
                  <span className="text-(--ink-2)">
                    {result.value.projectRoot ? (
                      <>
                        No <span className="font-mono">docs/</span> directory in{" "}
                        <span className="font-mono">{result.value.projectRoot}</span>.
                      </>
                    ) : (
                      <>
                        No project is open, so there are no docs to read.{" "}
                        <Link to="/" className="text-primary underline">
                          Open a project
                        </Link>
                        .
                      </>
                    )}
                  </span>
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {result.value.docs.map((doc) => (
                    <Link
                      key={doc.slug}
                      to="/project-docs/$slug"
                      params={{ slug: doc.slug }}
                      search={{ q: "", at: "" }}
                      className="flex items-start gap-2.5 rounded-lg border border-(--line) bg-(--bg-elev) px-3 py-2.5 hover:border-primary"
                    >
                      <FileText size={14} className="shrink-0 mt-0.5 text-(--ink-3)" />
                      <span className="min-w-0">
                        <span className="block text-[13px] text-(--ink) truncate">{doc.title}</span>
                        <span className="block font-mono text-[11px] text-(--ink-3) truncate">docs/{doc.slug}.md</span>
                      </span>
                    </Link>
                  ))}
                </div>
              )}

              {result.value.docs.length > 0 && (
                <p className="flex items-center gap-1.5 text-[12px] text-subtle m-0">
                  <BookOpen size={12} /> {result.value.docs.length} documents · {result.value.sections.length} sections
                  indexed
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
