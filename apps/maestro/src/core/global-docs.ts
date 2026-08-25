// The global Docs page's node side: the app's own end-user docs, read from a directory the app
// SHIPS rather than from anything under a project root.
//
// Why this is a thin aggregator over `docs.ts` rather than a fork of it: `listDocsIn`/
// `docSectionsIn` are the one heading-slugging, one markdown-parsing implementation the per-project
// reader already uses, and a second copy here would be a second slugifier to keep in sync with
// search. This module's whole job is picking the directory and tagging what comes back.

import type { DocContent, DocMeta, DocSection, GlobalDocsData } from "./contracts.js";
import { docSectionsIn, listDocsIn, readDocIn } from "./docs.js";

export type { GlobalDocsData };

/** Which global corpus a doc or section belongs to. Only one exists today: the app's own docs. */
export type DocGroup = "app";

/** Resolves the directory the app-docs group reads from, or null when this build doesn't ship it. */
export interface GlobalDocsDirs {
  app: string | null;
}

/**
 * The global Docs page's landing data: the app-docs list, plus a group-tagged search index.
 *
 * Never throws. When the directory hasn't resolved (see `maestroAppDocsDir` in
 * `src/main/bundled-assets.ts`) it contributes an empty list rather than failing the page.
 */
export function globalDocsData(dirs: GlobalDocsDirs): GlobalDocsData {
  const app: DocMeta[] = (dirs.app ? listDocsIn(dirs.app) : []).map((d) => ({ ...d, group: "app" }));

  const sections: DocSection[] = (dirs.app ? docSectionsIn(dirs.app) : []).map(
    (s): DocSection => ({ ...s, group: "app" })
  );

  return { app, sections };
}

/** One doc's body from the global corpus. Throws when the app-docs directory hasn't resolved. */
export function readGlobalDoc(group: DocGroup, slug: string, dirs: GlobalDocsDirs): DocContent {
  void group; // kept for call-site symmetry with the per-project reader; only "app" exists.
  if (!dirs.app) {
    throw new Error("The Maestro app docs are not available in this build.");
  }
  return readDocIn(dirs.app, slug);
}
