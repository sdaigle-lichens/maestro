# Project tags: project ↔ agent mapping

## Context

`/templates` already has a "Project Tags" tab: a global catalog (`project-tags.ts`,
`~/.claude/maestro-project-tags.sqlite`) seeded with `backend`/`frontend`/`mobile`, standalone —
nothing consumes it yet. The user wants to actually put it to work as the mapping between a
**project** and its **agents**:

- A project selects which of the catalog's tags it belongs to (stored in its own `maestro.json`).
- An agent is assigned exactly one of those same tags (or `global`, for agents like
  reviewer/scribe/test/refactor that apply to every project regardless of category) — a second,
  new global store, distinct from the existing Agent Types tab's unrelated
  developer/planner/reviewer/annotator/tester classification.
- On install, the project's tags are auto-detected from repo evidence (reusing `detect.ts`,
  unchanged) and the matching bundled agents (backend/frontend/mobile) get seeded, exactly as
  today — the 4 hardcoded core roles in `seed.ts` are untouched, and project tags never place a
  new kind of node into the seeded graph. Tags stay editable afterward from `/maestro`, and
  editing them afterward only ever **adds** a newly-tag-matched agent to `agents_available` — it
  never rewrites the graph the user has already built.
- The same flow needs a terminal-only equivalent, since `/maestro-install` is a full alternate
  path into a project with no desktop app involved.

Resolved during grilling (in order): tags are shown/editable on `/maestro` only **after** install;
Install now seeds `maestro.json` immediately (bringing the app in line with what the terminal
skill already does today), instead of leaving that to `/workflows`' first Save; the agent-side
field is called **project tag** (not "agent type" — that name is taken); it lives in a new store
but on the *same* `/templates` tab as the catalog; the 4 core roles and the graph topology are
never touched by any of this; `/workflows`' existing no-config fallback (`DetectedChain`) stays as
a safety net and needs no changes.

## Data model

**`apps/maestro/src/core/types.ts`** — add to `MaestroConfigV3`:

```ts
/** Which Project Tags catalog entries this project belongs to. Absent = none recorded yet
 *  (pre-dates this field). Selected once at install (from repo-detection evidence, backend/
 *  frontend/mobile only) and editable afterward from /maestro. */
project_tags?: string[];
```

Add `MaestroProjectTagsSlice { project_tags: string[] }` alongside the existing
`MaestroWorkflowsSlice`/`MaestroRulesSlice`.

**`apps/maestro/src/core/config.ts`** — extend `ConfigSlice` with
`{ sliceType: "project-tags"; slice: MaestroProjectTagsSlice }`; `mergeSlice` sets
`next.project_tags = input.slice.project_tags` only (same "leaves the other slice untouched" rule
the existing two branches follow). Reuses `saveConfig()` unchanged — a project-tags save still
re-renders the orchestrator and re-applies rules, harmlessly (both are no-ops for this slice).

## New store: agent → project tag

**`apps/maestro/src/core/agent-project-tags.ts`** (new file), mirroring `agent-types.ts` almost
exactly: `node:sqlite`, `~/.claude/maestro-agent-project-tags.sqlite`, table
`agent_project_tags(agent_name TEXT PRIMARY KEY, project_tag TEXT NOT NULL)`, seeded-on-first-read
with `backend→backend, frontend→frontend, mobile→mobile, refactor→global, reviewer→global,
scribe→global, test→global`. Unlike `agent-types.ts`, the value isn't a fixed TS union — it's
whatever the live Project Tags catalog contains, plus the literal `"global"` — so validation on
write is just "non-empty string" here; the UI is what constrains the dropdown to real catalog
values.

Exports: `readAllAgentProjectTags(dbPath?)`, `setAgentProjectTag(agentName, tag, dbPath?)`,
`agentsForProjectTags(tags: string[], dbPath?)` (agent names whose stored tag is in `tags` —
used by the post-install "add matching agents" step below), `DEFAULT_AGENT_PROJECT_TAGS_DB_PATH`.

## Install flow

**`apps/maestro/src/core/install.ts`** — `installRuntime()` gains one new step, after the existing
asset/hook/gitignore/runtimeVersion work: **if `readConfig(projectRoot)` is `null`** (no
`maestro.json` yet — first install), seed it right there instead of waiting for `/workflows`:

```ts
const detection = detectImplAgents(projectRoot);
const skills = await discoverSkills(projectRoot);
const skillMap = skillMapFromTags(readAllSkillTags(), skills.map(s => s.id), seededAgentNames(detection.implAgents));
const catalog = readAllProjectTags(projectTagsDbPath);
const projectTags = detection.implAgents.filter(t => catalog.includes(t));
const config = { ...defaultV3Config(detection.implAgents, skillMap), project_tags: projectTags };
writeConfig(projectRoot, config);
```

This is the same computation `main/ipc.ts`'s `workflowsData` handler already does inline for the
`/workflows` bootstrap fallback (kept, per the grilling answer, unchanged, as the safety net for a
project that somehow reaches `/workflows` with literally no config and no install). The two are
intentionally similar, not shared — different signatures (framework-free `install.ts` vs. the
async IPC handler), same "PORTED" duplication convention already used elsewhere (`seed.ts`'s own
header). If `maestro.json` already exists, none of this runs — an existing config, including its
`project_tags`, is the user's own and is never touched by a re-install, exactly like
`runtimeVersion` and every other field `install.ts` already leaves alone.

Add optional `projectTagsDbPath?: string` param (mirrors `reportsDbPath?`'s existing test-isolation
pattern) so tests never touch the real `~/.claude/maestro-project-tags.sqlite`.

**`apps/maestro/src/core/contracts.ts`** — extend `InstallReport` with
`configSeeded: { implAgents: string[]; projectTags: string[] } | null`, so `/maestro`'s report card
can say what got seeded, same idea as the existing `reportsSync` summary.

## New IPC surface

**`shared/ipc.ts`**: add channels

- `data:project-tags` → `projectTagsData(): Promise<{ catalog: string[]; selected: string[] }>` —
  reads the global catalog plus the *current* project's `maestro.json.project_tags ?? []`. Used by
  `/maestro`'s new section (no route loader there today — it fetches imperatively in the
  component, same as its existing `install:status` call).
- `project:tags:set` → `(tags: string[]) => Promise<string[]>` — the write path for toggling a tag
  on `/maestro`. Handler in `main/ipc.ts`:
  1. `saveConfig(root, { sliceType: "project-tags", slice: { project_tags: tags } })`.
  2. Diff against the previous `project_tags` for **newly added** tags only; for those, call
     `agentsForProjectTags(newlyAdded)` and union any not-yet-present agent ids into
     `agents_available` via a second `saveConfig(root, { sliceType: "workflows", slice: {...} })`
     call. Never removes an agent on uncheck — that stays a manual edit on `/workflows`' existing
     checklist, so unchecking a tag can't silently rip an agent out of a graph the user wired up.
  3. Returns the resulting `project_tags`.
- `templates.agentProjectTags.list()` / `.save(agentName, tag)` — same shape as the existing
  `templates.agentTypes.{list,save}` pair, backed by the new store.

Wire through `preload/index.ts` (`templates.agentProjectTags`, `data.projectTags`) and
`main/ipc.ts` the same way every existing pair in this file is wired.

## `/templates` — extend the existing Project Tags tab

**`project-tags-tab.tsx`** gains a second section below the existing chip catalog: one row per
seeded agent name (same "flat list of rows, own dirty state, own Save" pattern as
`agent-types-tab.tsx`), each with a `Select` whose options are `["global", ...catalog]` — sourced
from the tab's own `initial` props (catalog + `readAllAgentProjectTags()`), not a fixed constant
like `AGENT_TYPES`. `templates.tsx`'s loader adds a third parallel call
(`templates.agentProjectTags.list()`) alongside the two it already makes for this tab.

## `/maestro` — the new post-install section

In `InstallPage` (`routes/maestro.tsx`), once `status.installed` is true, render a new card: an
explanatory paragraph (what these tags are, why some are pre-checked, that adding one may add a
matching agent to the project) plus one checkbox per catalog tag, checked against `selected`,
calling `project:tags:set` with the toggled list on each change. Mirrors the existing
`ReportCard`/`RemovalCard` styling already on this page.

## `/workflows` — unchanged

Per the grilling answer, `DetectedChain`/`detectImplAgents`/`workflowsReseed` stay exactly as they
are, as the fallback for a project that reaches `/workflows` with no `maestro.json` at all (now
rare in practice, since Install seeds one immediately, but still a real path — e.g. a hand-deleted
config). No deletions here.

## Terminal skill (`/maestro-install`)

1. **New plugin-entries**, mirroring `maestro-report-defaults.ts`'s shape exactly:
   - `plugin-entries/maestro-project-tags.ts` → re-exports `readAllProjectTags`,
     `DEFAULT_PROJECT_TAGS_DB_PATH` from `../project-tags.js`.
   - `plugin-entries/maestro-agent-project-tags.ts` → re-exports `readAllAgentProjectTags`,
     `agentsForProjectTags`, `DEFAULT_AGENT_PROJECT_TAGS_DB_PATH` from `../agent-project-tags.js`.
   - Add both to the `entries` array in `apps/maestro/scripts/build-plugin-libs.mjs`, run
     `pnpm --filter maestro build:plugin-libs`, and commit the two new generated `.cjs` files
     under `plugins/maestro/scripts/lib/` — an *expected* diff there this time, unlike the prior
     session's Agent Types work (which deliberately stayed app-only).
2. **`plugins/maestro/scripts/maestro-install.js`**: add an optional `--project-tags
   "backend,frontend"` flag, independent of the existing `--impl-agents` (which keeps building the
   graph exactly as today — untouched). When seeding fresh, write the flag's value into the new
   config's `project_tags` field (intersected with the live catalog, same guard as the app).
3. **`plugins/maestro/skills/maestro-install/SKILL.md`**: after step 1 (repo analysis →
   `implAgents`), add a step that reads the catalog via the new lib (same try/catch-degrades
   pattern already used for skill tags), marks which entries the step-1 analysis supports as
   evidence, and confirms with the user via one `AskUserQuestion` (multiSelect if the catalog is
   ≤4 entries; otherwise the existing coarse-consent-plus-freeform-override pattern already used
   for the skill-map question) before passing the result as `--project-tags` in step 3. Step 5's
   summary mentions the recorded tags.

## Verification

- `pnpm --filter maestro typecheck`, `pnpm --filter maestro test` — extend `test/install.test.ts`
  for the new seed-on-first-install behavior and its `configSeeded` report field; new unit tests
  for `agent-project-tags.ts` (seed content, `agentsForProjectTags`, replace-not-append) and
  `config.ts`'s new slice branch.
- `pnpm --filter maestro build:plugin-libs`, then confirm via `git diff
  plugins/maestro/scripts/lib/` that exactly the two new files appear and nothing else changed.
- Live CDP pass (isolated fake `$HOME`, per this session's established discipline): install a
  fresh fixture project, confirm `maestro.json` now has `project_tags` populated from detection
  immediately (no `/workflows` visit needed); toggle a tag on `/maestro` and confirm the matching
  agent joins `agents_available`; confirm the Project Tags tab on `/templates` shows and saves the
  per-agent assignment; confirm the real `~/.claude/*.sqlite` stores are untouched by the test run.
