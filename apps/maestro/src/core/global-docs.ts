// The global Docs page's node side: the app's own end-user docs, read from a directory the app
// SHIPS rather than from anything under a project root.
//
// Why this is a thin aggregator over `docs.ts` rather than a fork of it: `listDocsIn`/
// `docSectionsIn` are the one heading-slugging, one markdown-parsing implementation the per-project
// reader already uses, and a second copy here would be a second slugifier to keep in sync with
// search. This module's whole job is picking the directory and tagging what comes back.

import fs from "node:fs";
import path from "node:path";
import type { DocContent, DocMeta, DocSection, GlobalDocsData } from "./contracts.js";
import { docSectionsIn, isValidDocSlug, listDocsIn, readDocIn } from "./docs.js";

export type { GlobalDocsData };

/** Which global corpus a doc or section belongs to. Only one exists today: the app's own docs. */
export type DocGroup = "app";

/**
 * The directories the app-docs group reads from, merged into one corpus; empty when this build
 * ships none. More than one because the end-user docs live in the plugin (so `maestro-help` can
 * read them from a marketplace install) while app-only pages such as the art credits stay here.
 */
export interface GlobalDocsDirs {
  app: readonly string[];
}

/**
 * The global Docs page's landing data: the app-docs list, plus a group-tagged search index.
 *
 * Never throws. When no directory resolved (see `maestroAppDocsDirs` in
 * `src/main/bundled-assets.ts`) it contributes an empty list rather than failing the page.
 */
export function globalDocsData(dirs: GlobalDocsDirs): GlobalDocsData {
  const app: DocMeta[] = dirs.app
    .flatMap((dir) => listDocsIn(dir))
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((d) => ({ ...d, group: "app" }));

  const sections: DocSection[] = dirs.app
    .flatMap((dir) => docSectionsIn(dir))
    .map((s): DocSection => ({
      ...s,
      group: "app",
    }));

  return { app, sections };
}

/** One doc's body from the global corpus — the first directory holding it. Throws when none does. */
export function readGlobalDoc(group: DocGroup, slug: string, dirs: GlobalDocsDirs): DocContent {
  void group; // kept for call-site symmetry with the per-project reader; only "app" exists.
  if (dirs.app.length === 0) {
    throw new Error("The Maestro app docs are not available in this build.");
  }
  // Validate before probing, so an invalid slug never reaches a path join.
  if (!isValidDocSlug(slug)) throw new Error(`Invalid document name: ${String(slug)}`);
  const dir = dirs.app.find((d) => fs.existsSync(path.join(d, `${slug}.md`))) ?? dirs.app[0];
  return readDocIn(dir, slug);
}
