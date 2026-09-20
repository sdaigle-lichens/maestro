---
name: rule-view
description: "Explains how the /rules view in the Maestro desktop app is built end-to-end: the left rule selectors (on-disk project rules + installable vibe-rules), the center directory tree (rule-tree.tsx), how assignments map to the MaestroConfigV3 `rules` slice in .claude/maestro.json, and how the rule files are moved/installed on save. Use when the user is working inside apps/maestro and asks how the rules view works, how rules get assigned to the project root or directory paths, how rule files get moved or installed, how vibe-rules integrate, why a rule isn't showing up, or why a rule assignment isn't reaching the config."
metadata:
  type: concept-skill
  version: "1.3"
  last-update: 0ebccda448b85ccba2da3e292cc874043a19b431
---

# Rule View

The `/rules` route (`src/renderer/src/routes/rules.tsx`) is a visual editor for assigning a project's **rules** to scopes — the project root and/or specific directory paths. The user picks which rules to work with (left pane), assigns each to a row of the project's directory tree (center). On save it persists the **rules slice** of `.claude/maestro.json` (v3) **and physically moves or installs** each rule file into its assigned directory — one IPC call, no Claude session, no separate follow-up step.

It is the rules half of the desktop app's config editor — the `/workflows` route owns the other half (workflows + instances), and the two share one `maestro.json`. See the `workflow-view` skill for that side.

## Layout

```
┌──────────────────────────── TopNav (top-nav.tsx) ────────────────────────────┐
│ Workflows | Rules        (no workflow selector on this route)              ☀ │
├───────────────┬──────────────────────────────────────────────────────────────┤
│ Left pane     │ Center — RuleTree                                            │
│ (rules.tsx)   │ (rule-tree.tsx)                                              │
│               │                                                              │
│ Available     │   ⊟ (project root)     [chip ×] [chip ×] +                   │
│  rules:       │   ▸ src               [chip ×]           +                   │
│  [chips]      │   ▸ src/backend       [vibe chip ×]      +                   │
│               │   ▸ apps               …                 +                   │
│ Installable   │                                                              │
│ (vibe-rules): │   (rows from getProjectTree)                                 │
│  [chips]      │                                                              │
│  [Save rules] │                                                              │
└───────────────┴──────────────────────────────────────────────────────────────┘
   280px                          1fr
```

The TopNav is shared with `/workflows` but rendered here **without** a `workflowSelector`, so the centered selector is absent.

## Data flow

```
Route loader: getRulesData()                   (src/renderer/src/utils/maestro.ts)
  → window.maestro.data.rules()  = IPC `data:rules`, handled in src/main/ipc.ts
      ONE round trip returning { config, projectRoot, seeded, tree, projectRules,
                                 vibeRules, vibeRulesAvailable }
      (the web app made four server-fn calls here, three of which each re-walked the tree)
      vibeRulesAvailable is false when the vibe-rules CLI isn't installed, so the UI can say so
        │
        ▼
RulesPage holds `config: MaestroConfigV3` (source of truth for the slice)
   + `selectedRuleIds: string[]` — seeded from config.rules.map(r => r.id)
   + derived `ruleSource: Record<id, "project"|"vibe-rules">`
   • the whole editor is remounted with key={projectRoot} (see Things that bite)
        │   left pane edits selectedRuleIds (+ prunes config.rules); tree edits config.rules
        ▼
RuleTree renders the project-root row + one row per tree dir; each row shows the
  assignment for its path and a hover "+" picker to assign a selected rule (one per rule)
        │   onAssign / onUnassign → setConfig (mutates config.rules only)
        ▼ (Save rules)
submitMaestroConfig({ sliceType: "rules", slice: { rules: config.rules } })
  → window.maestro.config.save(...)  = IPC `config:save` → saveConfig() in src/core
      1. merge the rules slice into maestro.json (preserves workflows/instances) and write it
      2. re-render the orchestrator's handoff table
      3. APPLY the placements — move project rule files, `vibe-rules load` installable ones
  ← SaveResult { rule summary } → the toast reports what moved and what was installed
        │
        ▼ router.invalidate()   — a rules save MOVES FILES, so the tree and rule pool it
                                  was rendering now describe a layout that no longer exists
```

Step 3 — what actually moves or installs, and what `placement` changes about it — is
[`sub-concepts/applying-placements.md`](sub-concepts/applying-placements.md).

## File-by-file map

Paths are relative to `apps/maestro/` unless stated otherwise.

| Concern                                                                       | File                                                             |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Route, both rule selectors, save, assign/unassign handlers                    | `src/renderer/src/routes/rules.tsx`                              |
| The directory tree + per-row chips + add-rule picker                          | `src/renderer/src/components/rule-tree.tsx`                      |
| Rule chip multi-select (used by both left-pane sections)                      | `src/renderer/src/components/chip-multi-select.tsx`              |
| Top bar — nav links (no workflow selector here)                               | `src/renderer/src/components/top-nav.tsx`                        |
| Renderer-side loader + save wrappers over the IPC bridge                      | `src/renderer/src/utils/maestro.ts`                              |
| The typed channel contract                                                    | `src/shared/ipc.ts` (`data:rules`, `config:save`)                |
| Main-process handler — the only side that touches `fs` or spawns `vibe-rules` | `src/main/ipc.ts`                                                |
| Directory walk, project-rule scan, `vibe-rules list`                          | `discovery.ts` in `apps/maestro/src/core/`                       |
| **The apply step** (move project files / `vibe-rules load`)                   | `rules.ts` in `apps/maestro/src/core/`, called by `saveConfig()` |
| Terminal-path equivalent of that step                                         | `plugins/maestro/scripts/maestro-apply-rules.js`        |
| Source of project rules                                                       | `<projectRoot>/**/.claude/rules/*.md`                            |

## The data model (the `rules` slice)

The view edits exactly one field of the shared `MaestroConfigV3` (types from `src/core/contracts.ts` — that **module**, never `src/core/index.ts`, which re-exports `fs`):

```ts
MaestroConfigV3 { version: 3, …workflow fields…, rules: MaestroRuleV3[] }   // only `rules` here

MaestroRuleV3 { id, scope?: "project", paths?: string[], source?: "project" | "vibe-rules", placement?: "move" | "scope-only" }
```

An `MaestroRuleV3` is **one assignment of a rule to one location** — not a rule definition, and (post this feature) at most one per rule id:

- **Project-root assignment** → `{ id, scope: "project" }` (no `paths`).
- **Directory assignment** → `{ id, paths: ["<dirPath>/**"] }` (no `scope`).
- **`source`** records where the rule comes from, so the apply step knows what to do:
  - `"project"` — an on-disk `.claude/rules/<file>.md`; the file is **moved** into the assigned directory.
  - `"vibe-rules"` — a rule from the vibe-rules store; **installed** via `vibe-rules load`.
- **`placement`** decides whether the assignment does anything physical at all. Absent means
  `"move"`; `"scope-only"` scopes the rule without moving or installing at the target. Set from
  `rule-tree.tsx`'s add-picker checkbox or its per-chip toggle; full semantics in
  [`sub-concepts/applying-placements.md`](sub-concepts/applying-placements.md).

The rule **definitions** are separate shapes, loaded but never written into `maestro.json`:

```ts
ProjectRule { id, description, body, dir }       // from <projectRoot>/**/.claude/rules/<file>.md; `dir` = current location
TreeNode    { path, name, depth }                // a directory, relative to projectRoot
// vibe-rules: just a string[] of ids from `vibe-rules list`
```

## Left pane — two rule selectors (rules.tsx + chip-multi-select.tsx)

Two `ChipMultiSelect` sections feed one shared `selectedRuleIds` pool:

- **Available rules** — on-disk project rules from `getProjectRules()`. It scans **every** `.claude/rules/` in the tree (not just the root), so a rule already moved into a subdirectory still shows up. Each file is parsed for frontmatter (`id = fm.name || filename`, plus `description`/`body` — currently only `id` is rendered) and tagged `source: "project"`.
- **Installable rules (vibe-rules)** — ids from `getVibeRules()` (`vibe-rules list`). Tagged `source: "vibe-rules"`. These don't exist in the project yet; assigning one installs it on save.

Source bookkeeping:

- `ruleSource: Record<id, "project"|"vibe-rules">` is derived: project ids first, then vibe ids **not already** a project id (a project rule wins a name collision, since it's a real file). The vibe section only lists `vibeOnlyIds` (resolving to `"vibe-rules"`) so a shared name never appears in both sections.
- `setGroupSelection(groupIds, next)` toggles selection within one section while leaving the other's intact, and **prunes `config.rules`** to the still-selected ids.
- `selectedRuleIds` is **seeded** on mount from `config.rules.map(r => r.id)`.

On a successful save the page fires a `toast` (`@repo/ui/toast`) naming what moved and what was installed, then `router.invalidate()`s and **stays put** — the window is long-lived and the user saves repeatedly, so there is no terminal success view.

## Center — directory tree (rule-tree.tsx)

`RuleTree` renders a flat, indented list: a synthetic **`(project root)`** row (`dirPath = ""`, `⊟`), then one `TreeRow` per `TreeNode` from the loader's `tree` (`▸`, indented by `depth * 16 + 8`px). `discoverProjectTree` (`discovery.ts` in `src/core`) walks from `projectRoot`, **maxDepth 4**, skipping `node_modules`/`.git`/`dist`/`build`/`.next`/`.turbo`/`.output`.

Each `TreeRow`:

- **Computes its own assignment** by filtering `ruleAssignments` (= `config.rules`): root matches `scope === "project" && no paths`; a dir matches `paths` containing `"<dirPath>/**"` or the bare `dirPath`.
- Renders one chip per assignment, tinted by source — **project rules** in the primary color, **vibe-rules** in amber with a tiny `vibe` badge (from `a.source ?? ruleSource[a.id]`). The `×` calls `onUnassign(id)`.
- Shows a hover-revealed `+` that opens an inline `<select>` of selected rules not already on this path; **Add** calls `onAssign`.

**One location per rule.** `handleAssign` (in `rules.tsx`) removes **every** prior assignment of that id before appending the new one (and stamps `source` from `ruleSource`). So a rule assigned to the root and then added to a directory **moves** — the root chip disappears and the directory chip appears. `handleUnassign` filters purely by id. The glob convention `"<dirPath>/**"` is written in `rule-tree.tsx`'s `handleAdd` and read back by `pathAssignments`; the two must stay in lockstep.

## Persistence and apply

The save is a single `config:save` carrying only `{ sliceType: "rules", slice: { rules } }`;
`saveConfig()` performs all three steps above in that one call. The apply matrix
(`placement` x `source`), the idempotency guards and the vibe-rules traps are
[`sub-concepts/applying-placements.md`](sub-concepts/applying-placements.md).

## Things that bite

- **Save only touches the rules slice.** Don't widen `submitMaestroConfig`'s rules branch to write `workflows`/instances — that's the `/workflows` route's slice, and a stray write will clobber it.
- **`rules` entries are assignments, not definitions, and now one-per-id.** Code that assumed multiple assignments per id no longer applies.
- **De-selecting a rule deletes its assignment.** `setGroupSelection` prunes `config.rules` to the selected ids. Unchecking a chip to "hide" a rule removes the path it was assigned to.
- **A rules save moves files on disk, which is why the route invalidates after one.** Unlike a workflows save, this one changes the very thing the loader read: the rule pool and the directory tree. Without `router.invalidate()` the tree keeps describing a layout that no longer exists, and the next assignment is computed against stale paths.
- **The project-rule scan walks the whole tree (maxDepth 4).** A rule nested deeper than 4 levels, or under an ignored dir, won't appear in the picker even though its assignment may persist in `maestro.json`. Same depth/ignore list as the tree walk — keep them consistent.
- **A rule assigned in maestro.json but missing from disk is stranded.** `selectedRuleIds` is seeded from `config.rules`, but the chips only render ids the loaders return. If the file was deleted (project) or removed from the store (vibe-rules), the chip can't render, yet the assignment persists until something prunes it — and the apply step reports it under `missing`/`errors`.
- **Name collisions resolve to project.** If the same id exists both on disk and in `vibe-rules list`, `ruleSource` calls it `"project"` and the vibe section hides it. The on-disk file is moved; the vibe-rules version is ignored.
- **Two functions answer "get the rules", and they are not the same set — the other one surfaces on
  `/tools`, not here.** `discoverRuleLibrary` reads `<project>/rules/*.md` — what the project
  *publishes*, shown on `/tools`' Rules tab (local-only, no global tier). `discoverProjectRules`,
  the one this route uses, reads every `.claude/rules/` in the tree — what is *assigned* to a
  directory, shown here, and what a save **moves**. A project can have either without the other, so
  they were deliberately not unified: the names and the return types (`RuleLibraryEntry` with
  `title`/`paths` vs `ProjectRule` with `id`/`dir`) are what keep a reader from assuming one view
  manages the other's files. If a rule shows up on `/tools` but not in this route's pickers (or vice
  versa), this is why — check which function the surface in question actually calls before assuming
  a bug.
