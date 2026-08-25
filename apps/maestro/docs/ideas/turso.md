# Idea: Turso (`@libsql/client`) instead of `node:sqlite` for skill tags

`skill-tags.ts` is currently the app's one database — a global, per-machine
`~/.claude/maestro-skill-tags.sqlite` store, backed by `node:sqlite` (a Node built-in, no native
module, no Electron rebuild step). This idea was raised while discussing whether to vectorize skill
descriptions for semantic lookup. Not pursued for now; recorded here in case the trade-offs shift.

## Why it came up

Turso's local/embedded mode (`@libsql/client` pointed at a `file:` URL, no cloud account) has a
native vector extension — `F32_BLOB` columns, `vector_distance_cos`, an ANN index — which
`node:sqlite`/plain SQLite doesn't. If skill descriptions get embedded so Claude Code can be handed
semantically-relevant skills rather than the full list, that's a real capability gap.

## Pros

- **Native vector search** if the embedded-skill corpus ever grows large enough that brute-force
  cosine similarity in JS stops being fast enough.
- Modern, actively developed client with a nicer async API than `node:sqlite`'s still-experimental
  one.
- Same SQL surface as SQLite, so the schema (`skill_tags(skill_id, tag)`) ports unchanged.

## Cons

- **Breaks the "no installed scripts, no native module" property `skill-tags.ts` exists to
  preserve.** `@libsql/client`'s local mode ships a compiled native addon (one per platform+arch —
  darwin-arm64, darwin-x64, linux-x64-gnu, etc.), the same shape as `better-sqlite3` — which is
  exactly what `node:sqlite` was chosen over, per that file's own header comment.
- **Can't be externalized into the plugin bundle the way `node:sqlite` is.** `build-plugin-libs.mjs`
  marks `node:sqlite` `external` in esbuild specifically so `maestro-skill-tags.cjs` — copied out of
  this repo into a project with no `node_modules` alongside it — can `require('node:sqlite')` and
  degrade gracefully via try/catch on an older Node that lacks it. `require('@libsql/client')` in
  that same context would fail unconditionally, on every environment, since there's no
  `node_modules` for it to resolve from. Shipping it would mean vendoring per-platform native
  binaries alongside the `.cjs`, or shipping a `node_modules` install step — both reintroduce the
  native-module-plus-rebuild problem this design deliberately avoided.
- **Sync → async ripples through every call site.** `DatabaseSync` is synchronous;
  `readAllSkillTags`/`setSkillTags` are called synchronously inline from `claude-preview.ts`,
  `claude-session.ts`, and `applySkillTagsBlock`. `@libsql/client` is promise-based, so adopting it
  means threading `async`/`await` through all of those, including `claude-preview.ts`, which has its
  own invariant (must never import `node:child_process`, transitively) that a new dependency would
  need re-auditing against.
- **No capability gap at the actual data scale.** The store holds tags/descriptions for the skills
  in a single project's `.claude/skills/` — dozens, maybe low hundreds of rows. Nowhere near where an
  ANN index earns its cost. Brute-force cosine similarity over embeddings stored as a JSON array or
  raw blob in a `node:sqlite` column, computed in a plain TypeScript loop at query time, gets the
  same outcome with zero new dependencies.
- **Not actually solving cloud sync**, which is the other half of Turso's value proposition and
  explicitly out of scope here (no cloud installation wanted).

## Recommendation

Don't switch. If skill-description embeddings are wanted, add an embedding column to the existing
`node:sqlite` table and do the similarity search in JS — it stays inside the current zero-dependency,
externalizable design, and the data volume here will not reach the point where that stops being fast
enough. Revisit only if the row count genuinely grows into ANN-index territory, which nothing about
this feature's shape suggests it will.
