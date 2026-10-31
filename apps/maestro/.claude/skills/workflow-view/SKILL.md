---
name: workflow-view
description: "Explains how the /workflows view in the Maestro desktop app is built end-to-end: the React Flow canvas (workflow-canvas.tsx), the left agents/skills pane and top workflow selector, and how the diagram maps to the MaestroConfigV3 model written to .claude/maestro.json. Use when the user is working inside apps/maestro and asks how the workflow view/canvas works, how nodes and edges map to maestro.json, how the success vs condition paths are built, how workflow instances and per-instance skills work, why a duplicate-agent-type banner is showing and what the instance picker's fork-an-agent affordance does about it (`041`), or why a workflow change isn't reaching the config."
metadata:
  type: concept-skill
  version: "2.1"
  last-update: 1fac55ee297de777db667b61f670fa7e0a08687c
---

# Workflow View

The `/workflows` route (`src/renderer/src/routes/workflows.tsx`) is a visual editor for a project's agent workflows. The user picks which bundled subagents and project skills to make available (left pane), then wires reusable **workflow instances** (agent + skills) into an editable graph (center canvas). On save it persists the workflow slice of `.claude/maestro.json` (v3).

It is the workflow half of the desktop app's config editor — the `/rules` route owns the other half, and the two share one `maestro.json`. Saving is a single IPC call with **no Claude session in the loop**: `config:save` → `saveConfig()` in `src/core` merges the slice, writes the file, re-renders the orchestrator's handoff table, and applies rule placements. See the `maestro-architecture` skill for what then reads that config at runtime.

## Layout

```
┌──────────────────────────── TopNav (top-nav.tsx) ───────────────────────────┐
│ Workflows | Rules        ◀ workflow selector (name + ✎ + ＋ + ✕) ▶         ☀│
├───────────────┬─────────────────────────────────────────────────────────────┤
│ Left pane     │ Center — WorkflowCanvas                                     │
│ (workflows    │ (workflow-canvas.tsx, @xyflow/react)                        │
│  .tsx)        │   ● Claude Main Session  (synthetic)                        │
│  Agents ☑     │        │ success (bottom→top)                              │
│   backend     │   ▭ agent node  + skill chips + ⋮                          │
│   test …      │        ◇ human step (Review)                                │
│  ＋ Agent     │        ⋯ condition edges (orange dashed)                    │
│  Skills ☑     │                                                             │
│  ＋ Skill     │   [ ＋ Add Agent | ＋ Add condition ] panel                 │
│  [Save]       │                                                             │
└───────────────┴─────────────────────────────────────────────────────────────┘
   280px                          1fr
```

The grid is a fixed `280px 1fr` (left pane + center; `workflows.tsx`, `gridTemplateColumns`).

## Data flow

```
Route loader: getMaestroConfig()             (src/renderer/src/utils/maestro.ts)
  → window.maestro.data.workflows()  = IPC `data:workflows`, handled in src/main/ipc.ts
      main reads <projectRoot>/.claude/maestro.json → MaestroConfigV3
      no file yet: detectImplAgents() → defaultV3Config(chain, skillMap, seedSkills), seeded:true + RepoDetection
      corrupt / wrong version: blankConfig()   (also what no open project returns)
      on-disk config: configIssues = duplicateAgentTypes(config)   (see 041 below)
  • returns { config, projectRoot, seeded, detection, agents, skills, configIssues } in one round trip
        │
        ▼
WorkflowsPage seeds the workflow store, KEYED ON projectRoot (see Things that bite)
        │   passes slices down as props (incl. workflow_instances)
        ▼
WorkflowCanvas mirrors the active workflow into React Flow state (rfNodes/rfEdges)
  • workflowToRfNodes / workflowToRfEdges  on the way in
  • rfNodesToMaestroNodes / rfEdgesToMaestroEdges  on the way out → onChange(workflow)
        │   every edit calls onChange → updateWorkflow → store
        │   instance edits go via onInstancesChange
        ▼ (Save workflows)
submitMaestroConfig({ data: { sliceType: "workflows", slice } })
  → window.maestro.config.save(...)  = IPC `config:save` → saveConfig() in src/core
      1. merge the workflow slice into maestro.json (preserves `rules`) and write it
         (2-space indent, NO trailing newline — preserved so existing repos show no diff)
      2. re-render the orchestrator's Maestro:HANDOFFS table from it
      3. apply the rule assignments
  ← SaveResult { success paths, rule summary } → the toast reports what changed on disk
        │
        ▼ router.invalidate()   (a save is neither a navigation nor a project switch)
```

**Outside changes to `maestro.json`** (a hand edit, `/maestro-update`) take a second path in:

```
main: watchConfigFile(projectRoot)  (src/core/config-watch.ts, ~1s poll of the raw text)
  → broadcasts `config:changed` to every window     (preload: config.onChanged(cb))
  → ConfigWatchProvider (utils/config-watch-context.tsx, mounted in __root.tsx) → router.invalidate()
  → /workflows loader re-runs → the seed effect calls seedWorkflowStore(config, projectRoot)
  → same project: reconcileWorkflowSlice(state, diskSlice)   (store/workflow-store.ts)
```

The store keeps `baseline` (the workflow slice as last known to be on disk), `externalChange` and the
flagged `externalSlice`. Only the workflow slice is compared, so a `rules` or `runtimeVersion` change
alone never touches the canvas. Reconcile, in order: disk == baseline → no-op; disk == canvas (our own
save echoing back) → adopt as baseline, clear the flag; canvas clean → take the disk slice; canvas dirty
→ keep the edits and set `externalChange`. A successful Save calls `markSaved(slice, projectRoot)` so its
own echo is recognised. `external-change-banner.tsx` (keyed by `projectRoot`, dismissible) then offers
**Reload from disk** (`reloadFromDisk`, discards edits) or **Keep mine** (`keepMine`, adopts the flagged
slice as baseline; Save then overwrites only the workflow slice). `/agents` refetches because its
`refresh()` effect depends on the loader result; `/rules` adopts new rules only while its editor is clean.

Steps 2 and 3 are pure node, no model: there is no result file, no `aiToolsAction`, and no session between the canvas and the disk.

**First install seeds rather than opening empty** — `defaultV3Config(detectImplAgents())`, two seed profiles, the `DetectedChain` correction chips and the exclusive `infra` category: see `sub-concepts/first-install-seed.md`.

## File-by-file map

Paths are relative to `apps/maestro/`.

| Concern                                                                | File                                                                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Route, left pane, save, workflow CRUD                                  | `src/renderer/src/routes/workflows.tsx`                                                                       |
| Canvas state kept across re-renders, keyed by project                  | `src/renderer/src/store/workflow-store.ts`                                                                    |
| The canvas (React Flow nodes/edges, all interactions)                  | `src/renderer/src/components/workflow-canvas.tsx`                                                             |
| Reuse/create instance picker + skill pickers (shared by canvas modals) | `src/renderer/src/components/instance-picker.tsx`, `.../instance-skill-picker.tsx` (loaded/referenced toggle) |
| Detected-chain banner + correction chips                               | `src/renderer/src/components/detected-chain.tsx`, `.../seeded-banner.tsx`                                     |
| Dangling skill-ref marks + notice (`091`)                              | `src/core/skill-ref-report.ts`, `.../components/skill-ref-mark.tsx`, `.../utils/skill-ref-context.tsx`, `.../utils/group-dangling.ts` |
| Duplicate-agent-type banner (`041`)                                    | `src/renderer/src/components/config-issue-banner.tsx`, validator in `src/core/config-validate.ts`             |
| Top bar — hamburger menu, direct links, workflow selector              | `src/renderer/src/components/top-nav.tsx`, `.../hamburger-menu.tsx`                                            |
| Renderer-side loader + save wrappers over the IPC bridge               | `src/renderer/src/utils/maestro.ts`                                                                           |
| The typed channel contract                                             | `src/shared/ipc.ts` (`data:workflows`, `data:reseed`, `config:save`)                                          |
| Main-process handlers (the only side that touches `fs`)                | `src/main/ipc.ts`                                                                                             |
| Read/merge/write, render, apply — all of it                            | `saveConfig()`, `seed.ts`, `render.ts`, `rules.ts` in `apps/maestro/src/core/`                                |
| Agents list sources (`discoverAgents`)                                 | project `.claude/agents`, `~/.claude/agents`, bundled `plugins/maestro/agents/*.md`, every installed plugin's agents |
| Skills list sources (`discoverSkills`)                                 | every `.claude/skills` in the project tree, `~/.claude/skills`, every installed plugin's skills (non-maestro ids are `plugin:skill`) |

## The data model (MaestroConfigV3)

The whole view edits one object. The **schema itself is owned by the `maestro-config-model` skill** — go there for field-by-field meaning and the slice-merge discipline. The types are re-exported by `src/renderer/src/utils/maestro.ts` from `src/core/contracts.ts` — that **module**, never the `src/core/index.ts` barrel, which re-exports `fs` and `child_process`.

The three shapes the canvas maps onto directly:

```ts
MaestroInstanceV3 { name, agent, loaded_skills: string[], referenced_skills: string[] }  // referenced by name from agent nodes
MaestroWorkflowV3 { name, nodes: MaestroNodeV3[], edges: MaestroEdgeV3[] }               // one per entry in the top selector; success_path is DERIVED, never stored
MaestroNodeV3     { id, type: "agent"|"human_review"|"manager_review"|"skill", instance?, skill?, position? }
MaestroEdgeV3     { from, to, kind: "success"|"condition", label?, sourceHandle?, targetHandle? }
```

`agents_available` / `skills_available` are the left pane's checkbox lists; `rules` is in the same
file but **not edited here** — it is `/rules`' slice.

What the canvas adds on top of that schema:

- **Instances carry the agent + skills, nodes just reference them.** An agent node's `instance` field (and its `id`, which equals the instance name) points at a `workflow_instances` entry. Skills are stored once per instance, not per node — the same instance reused across workflows shares one skill list, and editing an instance updates every placement. Each instance keeps two skill lists: `loaded_skills` (auto-loaded by the `SubagentStart` hook before the agent works) and `referenced_skills` (surfaced as available; the agent loads one only if the task needs it). The canvas chips render loaded skills solid and referenced skills dashed/muted.
- **`main-session` is synthetic.** `workflowToRfNodes` always prepends a non-deletable `main-session` node, and `rfNodesToMaestroNodes` filters it back out — so it never appears in `nodes[]`. But `rfEdgesToMaestroEdges` does **not** filter edges, so edges _from_ it persist with `from: "main-session"`. It is the implicit entry point every workflow starts from; the success path that reaches the terminal node marks the task complete.
- **`success_path` is derived, never stored.** It is computed by the plugin renderer (`successPath` in `maestro-render-orchestrator.cjs`) from the success edges and rendered into the orchestrator's `Maestro:HANDOFFS` table, but it is absent from `maestro.json`.

## Left pane (workflows.tsx)

- **Agents** checkboxes come from `bundledAgents` (a legacy loader-field name: the list is everything `discoverAgents()` in `src/core` finds in the main process — project, user, the bundled Maestro agents and every installed plugin's, each with a `source`). Toggling edits `config.agents_available`. `＋ Agent` `window.prompt`s for a manual id (for agents not discovered).
- **Skills** checkboxes come from `projectSkills` (likewise a legacy name) — `discoverSkills()` in main: project skills from EVERY `.claude/skills` in the tree (`discoverProjectSkillsTree`/`skillSearchDirs` in `src/core`), not just the root's, plus user and installed-plugin skills (maestro's own stay bare, other plugins' are `plugin:skill`). Toggling edits `config.skills_available` (a plain `string[]` of skill ids). `＋ Skill` prompts for a manual id.
- `skills_available` is the menu of skills the canvas can attach to instances — only a skill checked here can be attached.
- **Save workflows** → `handleSubmit` → `submitMaestroConfig` → `router.invalidate()`. On success the page fires a `toast` (`@repo/ui/toast`) naming what changed on disk and **stays on the canvas** — the window is long-lived and the user saves repeatedly, so there is no terminal success view.

## Center canvas (workflow-canvas.tsx)

Built on `@xyflow/react`. The node and edge types, dagre layout, `FitViewEffect` and the
`pushChange` state-sync rules are in `sub-concepts/canvas-nodes-and-edges.md`; adding steps and
conditions, editing labels and instances, the mid-chain relink and the `041` fork affordance are in
`sub-concepts/canvas-interactions.md`.

## Top selector (top-nav.tsx)

The centered control drives `config.workflows` through a custom dropdown (hand-rolled with an outside-click handler, not a native `<select>`):

- The trigger shows the active workflow name; clicking opens the menu.
- Each menu row switches the active workflow (`onSelect` → `activeWorkflowIdx`) and carries a trailing 🗑 button. Delete does **not** fire immediately — it opens a confirmation modal; only its **Delete** button calls `onRemove(i)` (dismissable via Cancel, backdrop, or Escape).
- **+ Add workflow** is pinned at the bottom of the menu (`onAdd` → `confirmCreateWorkflow` pushes a blank `{ name, nodes: [], edges: [] }`).
- The `✎` pencil beside the trigger renames the active workflow (`renameWorkflow`).

`WorkflowSelectorProps` is unchanged — `onRemove(i)` deletes the clicked row (not necessarily the active one). One workflow is edited at a time.

## Persistence (submitMaestroConfig)

Saving sends only the **workflow slice** (`agents_available`, `skills_available`, `workflow_instances`, `workflows`) with `sliceType: "workflows"`, over `config:save` — so `/rules`' `rules` survive the merge.

The route then calls `router.invalidate()` on the success path, after the `!res.ok` bail-out. A save is neither a navigation nor a project switch, so without it the loader data stays pinned at its load-time value and the `seeded` banner keeps telling the user their config is unsaved while it sits on disk. This is safe only because `seedWorkflowStore` bails on an unchanged `projectRoot` — re-running the loader cannot discard in-flight edits.

At runtime the `SubagentStart` hook (`maestro-inject-agent-context.js`) reads that same `.claude/maestro.json` (v3) at each subagent start to inject the instance's skills + condition-edge handoff rules. It reads the file directly, so a save is visible to the next dispatched subagent with nothing in between.

## Duplicate-agent-type banner (`041`)

On load, `workflows.tsx` renders a dismissible `config-issue-banner.tsx` (own component, not an extension of `seeded-banner.tsx` — that banner has no dismiss affordance and covers an unrelated, independently-occurring condition) when `loaderData.configIssues` is non-empty — a hand-edited config with two placed instances on one bare agent, computed in main by `config-validate.ts`'s `duplicateAgentTypes` (see `maestro-config-model`). `key={projectRoot}` so a project switch remounts it with fresh dismissal state. It never blocks editing.

## Dangling skill references (`091`)

A config can name a skill that no longer resolves (plugin not installed / not enabled / skill not in plugin / not found). The report is advisory: it never blocks a save and never removes a reference.

- **Core:** `src/core/skill-ref-report.ts` `skillRefReport(projectRoot)` reads the on-disk `maestro.json` and calls `findStaleSkillRefs` (`skill-availability.ts`, shared with `maestro-stale-refs.cjs`). Never throws: no project or a missing/corrupt config is an empty report. Not in the plugin-entries graph. `UnavailableReason` / `DanglingSkillRef` / `SkillRefReport` live in `core/contracts.ts` (re-exported by `skill-availability.ts` and `shared/ipc.ts`).
- **Disabled skills (`142`):** one decision, `skill-availability.ts` `skillDisabledReason` / `isSkillListed` / `readDisableRules` (fs/os/path only; exported from `core/index.ts`). `discoverSkills(projectRoot, homeDir?)` and `claude-preview.ts` `projectSkillsForTagging` filter every list through `isSkillListed`, and `whyUnavailable` asks the same `skillDisabledReason`, so a list and the dangling report cannot disagree. Settings merge per key, **user < project `settings.json` < project `settings.local.json`** (`readSkillSettings`); a later file wins. Rules: `skillOverrides[<plugin:name> then <name>] === "off"` (first key present decides, so an explicit "on" beats "off" on the other spelling), `enabledPlugins[plugin] === false` (absent is not disabled), `disableBundledSkills`. New reasons: `skill-disabled`, `bundled-skills-disabled` (labels in `SKILL_REF_REASON_LABEL`). The app lists **no built-ins**, so `disableBundledSkills` only affects the dangling report (a reference to a name in `CLAUDE_CODE_BUNDLED_SKILLS`; a real project/user/plugin skill of that name wins); the list is documented-only, with collision protection. A malformed/unreadable settings file or wrong-typed value is skipped, i.e. the skill stays listed. A disabled skill still referenced in `maestro.json` is flagged (the report reads the config, not the list) and shows as a flagged checkbox in the referencing instance's own list. Settings edits show on the next navigation (the list loader re-runs); the report needs "Recheck skills".
- **IPC:** `IPC.skillRefReport` = `data:skill-refs`, `window.maestro.data.skillRefs()`, wrapped by `getSkillRefReport()` in `utils/maestro.ts`.
- **Provider:** `SkillRefProvider` (`utils/skill-ref-context.tsx`, in `__root.tsx` **above** `InstallProvider`, inside `ConfigWatchProvider`) exposes `{ report, find(id), refresh(), checking, recheck() }` via `useSkillRefs()`. Refresh triggers: project switch (clears marks first), every `config:changed`, a debounced (300ms) window `focus`/`visibilitychange` (enable a plugin elsewhere, return to the app), and `refresh()` (the always-visible `SkillRefRecheck` "Recheck skills" control on `/workflows` and `/maestro`, plus the notice's button; `workflows.tsx` and `maestro.tsx` call it after their own save rather than wait for the ~1s poll). A late answer for a project since left is dropped.
- **Marks:** `components/skill-ref-mark.tsx` `SkillRefMark id` (amber reason label, matched **by id**, so one entry marks every occurrence) and `SkillRefNotice` (one dismissible notice with the project-level suggestions plus Recheck; render it `key={projectRoot}`). Marks sit on: instance chips in `workflow-canvas.tsx` (loaded and referenced), the skill-node label there, `instance-skill-picker.tsx` rows, the shared skills list and instance rows in `workflows.tsx`, the start/end skill pickers in `maestro.tsx`, and `agents/agent-card.tsx`. The notice renders in `workflows.tsx` and `maestro.tsx`. `checking`/`recheck()` (a refresh with `checking` held true until it settles) live in the provider, so every Recheck button reads them from `useSkillRefs()` and disables together; never keep local checking state. `SkillRefRecheck` is always visible because the notice disappears when the report is clean, which made a notice-only Recheck unreachable.
- **Collapsed groups:** `CollapsibleGroup` (`source-group.tsx`) takes an optional `closedIndicator`, shown in the header only while closed. `workflows.tsx` passes `GroupDanglingIndicator` (`skill-ref-mark.tsx`), which uses `summarizeGroupDangling(ids, find)` (`utils/group-dangling.ts`: distinct dangling count plus the shared reason, undefined if reasons differ) and renders `data-testid="skill-group-dangling"`.

## Things that bite

- **The skill-ref report reflects the saved file, not the canvas.** Unsaved edits are not in it; a mark clears only after a save (or an outside fix) and the next refresh.
- **Renderer component tests are `.ts`, not `.tsx`.** vitest only includes `test/**/*.test.ts`, so `test/renderer/skill-ref-mark.test.ts` builds elements with `createElement`.
- **The running-window check for `091` is verified:** a CDP probe against the launched app passed 11/11 checks. It needs the Electron sandbox set up (an AppArmor profile or the `chrome-sandbox` setuid bit; see `test-maestro`'s electron-sandbox-setup reference).
- **`main-session` lives in edges but not nodes.** Code that consumes `workflows[].edges` must treat `"main-session"` as a valid `from` that has no matching entry in `nodes[]`. Filtering edges by "node exists" will silently drop the entry edge.
- **Skills live on the instance, not the node.** A node only stores `instance` (+ id + position); the agent and skills come from the `workflow_instances` entry. Editing an instance updates every node that references it across all workflows.
- **`success_path` is derived — never write it to `maestro.json`.** Persisting it would duplicate state that can drift from the edges.
- **Save only touches the workflow slice.** Don't widen `submitMaestroConfig`'s workflow branch to write `rules` — that's the `/rules` route's slice, and a stray write will clobber it.
- **This route is no longer the only writer of the workflow slice.** `/agents` also saves it, to change one instance's `loaded_skills` / `referenced_skills` — it re-reads via `data:workflows` immediately before calling `config:save`, precisely because the merge replaces the whole block. If you change the shape of `workflow_instances`, `routes/agents.tsx` (`saveSkills`) has to move with it. Its chips default a newly ticked skill to **referenced**, matching `instance-skill-picker.tsx`, and it refuses to save skills at all while the config is `seeded` — writing would materialize a starter `maestro.json` as a side effect of visiting `/agents`.
- **An instance can only hold skills that are checked in the left pane.** The `InstanceSkillPicker` lists `availableSkills` (= `skills_available` ids). Unchecking a skill in the left pane after attaching it leaves a dangling id on the instance.
- **Reconcile only runs while `/workflows` is mounted.** The seed effect is the only caller, so on any other
  route the store goes stale; the next visit reconciles against fresh loader data, which is why the banner
  can appear on arrival rather than at the moment of the edit.
- **The watcher also fires for this window's own saves.** Never raise `externalChange` from the event
  itself — only from `reconcileWorkflowSlice`, which recognises the echo (disk == canvas). Any new workflow
  write path must call `markSaved`, or its own save looks like an outside edit once the canvas diverges.
- **Slice comparison is structural (`deepEqual`, key-order and `undefined` insensitive).** Disk-parsed and
  canvas-built objects differ in key order; a `JSON.stringify` compare would raise false banners.
- The React Flow traps (module-level type maps, edge-type registration, handle placement, mid-drag pushes, the base CSS import) live with the mechanism they belong to, in `sub-concepts/canvas-nodes-and-edges.md`.
