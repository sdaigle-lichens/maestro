---
name: docs-view
description: "Explains the two markdown documentation readers in the Maestro desktop app — /docs/$group/$slug over the corpus the app SHIPS (not gated on an open project) and /project-docs/$slug over the open project's own docs/ — and what they share: the one parsing/slugging implementation in src/core/docs.ts (the *In primitives, slugifyHeading, isValidDocSlug), the react-markdown + remark-gfm + rehypeHighlightTerms stack, why a heading travels as the `at` SEARCH param instead of a URL fragment under hash history, and why in-page #anchor links must be intercepted. Use when adding a doc corpus or a route param to either reader, changing heading anchors or search highlighting, touching src/core/docs.ts or global-docs.ts, or debugging a search hit that scrolls nowhere or highlights nothing."
metadata:
  type: concept-skill
  version: "1.0"
  last-update: e583e25c831728794f633d2a502f67e60dcf1f0d
---

# Docs view

Two readers, one rendering stack.

| Route | Corpus | Channels | Gated on a project? |
| --- | --- | --- | --- |
| `/docs/$group/$slug` | The app's own end-user docs, from a directory the app **ships** (`maestroAppDocsDir` in `src/main/bundled-assets.ts`) | `data:global-docs` / `data:global-doc` | No |
| `/project-docs/$slug` | The open project's `docs/` | `data:docs` / `data:doc` | Yes |

`$group` is a route param with exactly one value today (`"app"`), kept so a second global corpus can
arrive without reshaping the route. `/project-docs/$slug` was `/docs/$slug` before the global reader
took that path — anything still naming `/docs/$slug` as the project reader is stale.

**The parsing lives once.** `src/core/global-docs.ts` is a thin aggregator that picks a directory and
tags what comes back; the heading-slugging and markdown-splitting are `docs.ts`'s `listDocsIn` /
`docSectionsIn` / `readDocIn`. A second slugifier here would be a second thing to keep in sync with
the search index, which is the whole point of the `*In` split.

## Things that bite

- **A heading is addressed by the `at` SEARCH param, never by a URL fragment.** The renderer runs on
  hash history (a packaged build loads over `file://` — see `electron-shell-invariants`), so the
  route itself already lives in `location.hash`, and a second `#` inside it is not something the
  router or `querySelector` can be trusted to split. Both readers carry the heading id as `at` and
  scroll by `document.getElementById(at)`. The help-server original this was ported from read
  `window.location.hash` directly; that does not survive the port.
- **For the same reason, in-page `#anchor` links in rendered markdown must be intercepted.** Each
  reader's `components.a` checks `href?.startsWith("#")`, calls `preventDefault()` and scrolls by id.
  Left alone, one would rewrite the route and throw the reader out of the app.
- **`components={{ text: … }}` in react-markdown highlights nothing.** `components` is keyed by
  ELEMENT name, and `text` is the **SVG** `<text>` element, not a markdown text node. It type-checks
  (it's a real JSX intrinsic) and renders, but the body highlight silently never happens — caught
  only by a window probe counting zero `<mark>` elements in an article opened from a search hit. Text
  nodes are reachable from a rehype plugin instead, so `utils/highlight.ts` marks the hast tree —
  which also lights up a term inside a link, list item or table cell, unlike the per-element
  approach. `rehypeHighlightTerms` walks hast and must reset `pattern.lastIndex = 0` between nodes,
  since the pattern is global.
- **A doc slug is renderer input, and the reader treats it as such.** `isValidDocSlug` in
  `src/core/docs.ts` rejects anything containing `/`, `\` or `.` _before_ the path is joined, since
  the slug arrives as a route param and `../../../etc/passwd` is a file `readDocIn` would otherwise
  open and render. Keep the check before the `path.join`, not after. Both corpora go through it.
- **The anchor id and the search index must agree.** Each route defines a local `slugifyHeading` that
  is deliberately the same transform as `src/core/docs.ts` uses when building the section index.
  Change one and a search hit scrolls nowhere — nothing errors, the page just sits at the top.
- **`data:doc` and `data:global-doc` REJECT** on a bad slug, a missing file or an unreadable one,
  rather than returning `""`. That is deliberate: the page has to be able to say which doc failed and
  why instead of rendering an empty article. Both loaders go through `callMain`. The *list* channels
  never reject — a project with no `docs/` is an empty list, not an error.

## Files

| File | Role |
| --- | --- |
| `src/core/docs.ts` | The `*In` primitives, `slugifyHeading`, `isValidDocSlug`. The single parsing implementation. |
| `src/core/global-docs.ts` | Directory picking + group tagging over the above. Never throws on an unresolved directory. |
| `src/main/bundled-assets.ts` | Resolves the shipped app-docs directory; `null` when this build doesn't ship it. |
| `src/renderer/src/routes/docs.$group.$slug.tsx` | The global reader. |
| `src/renderer/src/routes/project-docs.$slug.tsx` | The project reader; its header carries the `at`-not-fragment rationale. |
| `src/renderer/src/utils/highlight.ts` | `termPattern`, `MARK_CLASS`, `rehypeHighlightTerms` — and its header documents the SVG-`<text>` trap. |

## Relationships

- [`electron-shell-invariants`](../electron-shell-invariants/SKILL.md) — why the renderer is on hash
  history at all, and the code-splitting measurement that counts this route's react-markdown chunk.
- [`test-maestro`](../test-maestro/SKILL.md) — the packaged-window harness a highlight or scroll
  claim has to be verified in; neither is observable from `test/`.
- `/maestro-tasks` renders task files with the same react-markdown + remark-gfm stack and shares the
  chunk — see `task-queue` (repo root `.claude/skills`).
