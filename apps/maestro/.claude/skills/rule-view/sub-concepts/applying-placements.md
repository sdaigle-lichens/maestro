# Applying placements (`rules.ts`)

The physical half of a rules save: `applyRules` (`apps/maestro/src/core/rules.ts`) runs inside
`saveConfig()`, right after `maestro.json` is written. It reads the `rules` slice and, per
assignment, branches first on `placement`, then on `source`.

This used to be a separate host-side `maestro-apply-rules.js` run, driven by a `SKILL.md` after the
container wrote its result file. `rules.ts` is that same logic called in-process: the app can reach
the project's paths directly and can shell out to `vibe-rules` itself, neither of which a container
could do.

## The matrix

| `placement` | `source: "project"` | `source: "vibe-rules"` |
| --- | --- | --- |
| absent or `"move"` (default) | Find the rule's `.claude/rules/<file>.md` by scanning the tree (matching frontmatter `name`/basename to the id) and **move** it into `<assignedDir>/.claude/rules/`. Already there (e.g. assigned to the root where it lives) → no-op, `unchanged`. | `vibe-rules load <id> claude-code -t <assignedDir>/.claude/rules/<id>.md`, creating the parent dir first. |
| `"scope-only"` | File is left exactly where it is on disk; reported `unchanged`, never touched. | Installs into the **project root's** `.claude/rules/` instead of the assigned directory's — `vibe-rules load` still runs, but no `.claude/` is created under the scoped directory. |

`"scope-only"` exists so an assignment can scope a rule to its `paths`/`scope` without forcing a
`.claude/` to exist somewhere a project's own convention forbids it. It is set from
`rule-tree.tsx`'s add-picker checkbox or its per-chip toggle. This repo's own `.claude/maestro.json`
assigns `plugin-publishing` to `plugins/maestro/**` with `placement: "scope-only"`, and the real
apply step (`maestro-apply-rules.js`) has been run against it for real — no hand-edited workaround
left behind, no `plugins/maestro/.claude/` on disk.

**Removed / unassigned rules are left untouched.** The step **never deletes** rule files; cleanup is
the user's choice.

It is idempotent and returns `{ moved, installed, unchanged, skipped, missing, errors }`, which
rides back on the `SaveResult` and becomes the toast text.

## Things that bite

- **vibe-rules `load` appends, so installs must be guarded.** It appends a `<id>…</id>` block, so the
  step first checks for that tag and **skips** if already present — re-runs don't duplicate. Change
  the target filename or the tag format and re-runs start duplicating blocks; re-confirm against
  `vibe-rules`' actual output if you touch this.
- **The editor token is `claude-code`, not `claude`.** `vibe-rules load <id> claude` errors with
  "Unsupported rule type: claude". And `-t` takes a **file** path whose parent dir must exist — the
  step `mkdir -p`s it.
- **Re-assigning a vibe-rule leaves the old install behind.** Project rules are _moved_ (a single
  file follows the assignment); vibe-rules are _installed_ at the assigned path. The config holds one
  location per rule, but since the step never deletes, moving a vibe-rule to a new directory installs
  a fresh copy there and leaves the previous `.claude/rules/<id>.md` in place — by design.
- **A rule assigned in `maestro.json` but missing from disk is stranded** and surfaces here under
  `missing`/`errors` (see the SKILL.md bite entry for the UI half).

## Terminal parity

`plugins/maestro/scripts/maestro-apply-rules.js` is the same algorithm as a standalone script, for a
terminal-only project with no desktop app. Keep the two in step — a change to one that isn't
mirrored means a project's rules land differently depending on which path saved them.
