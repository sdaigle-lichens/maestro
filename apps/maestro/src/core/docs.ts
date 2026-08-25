// The documentation reader's node side: what docs exist, one doc's body, and the per-heading
// sections search matches against.
//
// PORTED FROM apps/help-server/src/utils/docs.ts. The directory is `<project>/docs` rather than a
// Docker-mounted `/docs`, and `readDoc` throws instead of returning a sentinel so the route can
// say WHY a doc did not open — a reader that silently rendered an empty page for both "no such
// file" and "unreadable file" is the failure `callMain` exists to prevent.
//
// `listDocsIn`/`readDocIn`/`docSectionsIn` take a directory directly, so the SAME parsing/slugging
// implementation backs both the per-project docs reader (`listDocs`/`readDoc`/`docSections`,
// adapters over `docsDir(projectRoot)`) and the global docs aggregator (`global-docs.ts`), which
// reads the app's own bundled doc trees. A second implementation for the global case would be a
// second heading-slugifier to keep in sync with the search index.

import fs from "node:fs";
import path from "node:path";
import type { DocContent, DocMeta, DocSection } from "./contracts.js";

export type { DocContent, DocMeta, DocSection };

export function docsDir(projectRoot: string): string {
  return path.join(projectRoot, "docs");
}

/**
 * The id a heading gets, and the id a search hit links to. One implementation, because the two
 * are the same anchor seen from either end — a second slugifier would silently stop matching.
 */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

function extractTitle(content: string, fallback: string): string {
  return content.match(/^#\s+(.+)/m)?.[1].trim() ?? fallback;
}

function markdownFilesIn(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort();
  } catch {
    return [];
  }
}

/**
 * A slug names ONE file directly inside the docs directory, so anything that could steer the read
 * elsewhere is refused rather than normalised: no separators, no dots (which rules out `..` and
 * extensions), nothing empty. The slug arrives from a route param, and a route param is renderer
 * input.
 */
export function isValidDocSlug(slug: unknown): slug is string {
  return typeof slug === "string" && slug.length > 0 && !/[/\\.]/.test(slug);
}

/** Every `.md` file directly inside `dir`, title-sorted. Empty when `dir` doesn't exist. */
export function listDocsIn(dir: string): DocMeta[] {
  return markdownFilesIn(dir)
    .map((file) => {
      const slug = file.replace(/\.md$/, "");
      let content = "";
      try {
        content = fs.readFileSync(path.join(dir, file), "utf8");
      } catch {
        // A doc we cannot read still exists; list it under its filename rather than dropping it.
      }
      return { slug, title: extractTitle(content, slug) };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

/** One doc's body under `dir`. Throws — for an invalid slug, a missing file, or an unreadable one. */
export function readDocIn(dir: string, slug: string): DocContent {
  if (!isValidDocSlug(slug)) throw new Error(`Invalid document name: ${String(slug)}`);
  const file = path.join(dir, `${slug}.md`);
  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    throw new Error(`Could not read ${path.basename(dir)}/${slug}.md`);
  }
  return { slug, title: extractTitle(content, slug), content };
}

/**
 * Every doc under `dir` split at its headings — the corpus docs search filters.
 *
 * Split per heading rather than per file because a hit has to deep-link: the reader navigates to
 * `#headingId` and highlights the term there. Matching whole files could only ever name the file
 * and drop the user at the top of it.
 */
export function docSectionsIn(dir: string): DocSection[] {
  const sections: DocSection[] = [];

  for (const file of markdownFilesIn(dir)) {
    const slug = file.replace(/\.md$/, "");
    let content: string;
    try {
      content = fs.readFileSync(path.join(dir, file), "utf8");
    } catch {
      continue;
    }
    const docTitle = extractTitle(content, slug);

    let heading = { id: "", text: docTitle };
    let bodyLines: string[] = [];

    const flush = () => {
      if (bodyLines.length > 0) {
        sections.push({
          slug,
          docTitle,
          headingId: heading.id,
          headingText: heading.text,
          bodyText: bodyLines.join("\n").trim(),
        });
      }
      bodyLines = [];
    };

    for (const line of content.split("\n")) {
      const match = line.match(/^(#{1,6})\s+(.+)/);
      if (match) {
        flush();
        const text = match[2].trim();
        heading = { id: slugifyHeading(text), text };
      } else {
        bodyLines.push(line);
      }
    }
    flush();
  }

  return sections;
}

/** Every doc under `<project>/docs`, title-sorted. Empty when the project has no docs directory. */
export function listDocs(projectRoot: string): DocMeta[] {
  if (!projectRoot) return [];
  return listDocsIn(docsDir(projectRoot));
}

/** One doc's body. Throws — for an invalid slug, a missing file, or an unreadable one. */
export function readDoc(projectRoot: string, slug: string): DocContent {
  if (!projectRoot) throw new Error("No project is open.");
  return readDocIn(docsDir(projectRoot), slug);
}

/**
 * Every doc split at its headings — the corpus docs search filters.
 *
 * Split per heading rather than per file because a hit has to deep-link: the reader navigates to
 * `#headingId` and highlights the term there. Matching whole files could only ever name the file
 * and drop the user at the top of it.
 */
export function docSections(projectRoot: string): DocSection[] {
  if (!projectRoot) return [];
  return docSectionsIn(docsDir(projectRoot));
}
