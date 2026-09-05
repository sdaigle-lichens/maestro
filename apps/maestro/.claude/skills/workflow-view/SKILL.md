---
name: workflow-view
description: "Explains how the /workflows view in the Maestro desktop app is built end-to-end: the React Flow canvas (workflow-canvas.tsx), the left agents/skills pane and top workflow selector, and how the diagram maps to the MaestroConfigV3 model written to .claude/maestro.json. Use when the user is working inside apps/maestro and asks how the workflow view/canvas works, how nodes and edges map to maestro.json, how the success vs condition paths are built, how workflow instances and per-instance skills work, why a duplicate-agent-type banner is showing and what the instance picker's fork-an-agent affordance does about it (`041`), or why a workflow change isn't reaching the config."
metadata:
  type: concept-skill
  version: "1.2"
  last-update: 8b963451ba488d3466bfc845e44b2c23e274b61c
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
│  .tsx)        │                                                             │
│               │   ● Claude Main Session  (synthetic)                        │
│  Agents ☑     │        │ success (bottom→top)                              │
│   backend     │   ▭ agent node  + skill chips + ⋮                          │
│   test …      │        ◇ human step (Review)                                │
│  ＋ Agent     │        ⋯ condition edges (orange dashed)                    │
│               │                                                             │
│  Skills ☑     │   [ ＋ Add Agent | ＋ Add condition ] panel                 │
│  ＋ Skill     │                                                             │
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
      no file yet: detectImplAgents() → defaultV3Config(chain), returned with seeded:true
                   and the RepoDetection evidence on the SAME payload
      corrupt / wrong version: blankV3Config()
  • returns { config, projectRoot, seeded, detection, agents, skills } in one round trip
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
submitMaestroConfig({ sliceType: "workflows", slice })
  → window.maestro.config.save(...)  = IPC `config:save` → saveConfig() in src/core
      1. merge the workflow slice into maestro.json (preserves `rules`) and write it
         (2-space indent, NO trailing newline — preserved so existing repos show no diff)
      2. re-render the orchestrator's Maestro:HANDOFFS table from it
      3. apply the rule assignments
  ← SaveResult { success paths, rule summary } → the toast reports what changed on disk
        │
        ▼ router.invalidate()   (a save is neither a navigation nor a project switch)
```

Steps 2 and 3 are the ones that used to be Steps 3 and 4 of a `SKILL.md`: pure node, no model, but stranded on the host because the editor was in a container. There is no result file, no `aiToolsAction`, and no session between the canvas and the disk.

**First-install seed.** When no `maestro.json` exists yet, the canvas does **not** open empty — main returns `defaultV3Config(implAgents)`, which seeds the bundled agents as `workflow_instances` plus six ready-made workflows (`default`, `tdd`, `Refactor`, `Documentation`, `Review`, `Tests`) with positioned nodes. `implAgents` is the **repo-detected** implementation chain (`detectImplAgents()` in `src/core`) — `["backend"]`, `["frontend"]`, `["backend","frontend"]`, and so on. It sets the happy-path implementation step and, for fullstack, splits the reviewer/refactor code-FAIL conditions per agent. The evidence behind the detection rides on the same payload and renders as `DetectedChain`, with chips to correct it (`data:reseed` rebuilds the seed around the corrected chain, in main, using the same `defaultV3Config`). `DetectedChain` renders **only while `seeded`** — once `maestro.json` exists, the chain is the user's saved answer and re-proposing one would be offering to overwrite their graph. A corrupt or wrong-version file falls back to the empty `blankV3Config()`.

The terminal path (`/maestro-install`) seeds the identical config from the identical function, via the generated `lib/maestro-seed.cjs` bundle — so a project seeded in a session and one seeded in the app are byte-for-byte the same.

## File-by-file map

Paths are relative to `apps/maestro/`.

| Concern                                                                | File                                                                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Route, left pane, save, workflow CRUD                                  | `src/renderer/src/routes/workflows.tsx`                                                                       |
| Canvas state kept across re-renders, keyed by project                  | `src/renderer/src/store/workflow-store.ts`                                                                    |
| The canvas (React Flow nodes/edges, all interactions)                  | `src/renderer/src/components/workflow-canvas.tsx`                                                             |
| Reuse/create instance picker + skill pickers (shared by canvas modals) | `src/renderer/src/components/instance-picker.tsx`, `.../instance-skill-picker.tsx` (loaded/referenced toggle) |
| Detected-chain banner + correction chips                               | `src/renderer/src/components/detected-chain.tsx`, `.../seeded-banner.tsx`                                     |
| Duplicate-agent-type banner (`041`)                                    | `src/renderer/src/components/config-issue-banner.tsx`, validator in `src/core/config-validate.ts`             |
| Top bar — hamburger menu, direct links, workflow selector              | `src/renderer/src/components/top-nav.tsx`, `.../hamburger-menu.tsx`                                            |
| Renderer-side loader + save wrappers over the IPC bridge               | `src/renderer/src/utils/maestro.ts`                                                                           |
| The typed channel contract                                             | `src/shared/ipc.ts` (`data:workflows`, `data:reseed`, `config:save`)                                          |
| Main-process handlers (the only side that touches `fs`)                | `src/main/ipc.ts`                                                                                             |
| Read/merge/write, render, apply — all of it                            | `saveConfig()`, `seed.ts`, `render.ts`, `rules.ts` in `apps/maestro/src/core/`                                |
| Bundled subagents (source of the Agents list)                          | `plugins/maestro/agents/*.md`                                                                        |
| Project skills (source of the Skills list)                             | `<projectRoot>/.claude/skills/*/SKILL.md`                                                                     |

## The data model (MaestroConfigV3)

The whole view edits one object. The types are re-exported by `src/renderer/src/utils/maestro.ts` from `src/core/contracts.ts` — that **module**, never the `src/core/index.ts` barrel, which re-exports `fs` and `child_process`:

```ts
MaestroConfigV3 {
  version: 3
  agents_available: string[]                  // left pane "Agents" checkboxes
  skills_available: string[]                  // left pane "Skills" checkboxes (plain ids)
  workflow_instances: MaestroInstanceV3[]         // project-scoped reusable nodes (agent + skills)
  workflows: MaestroWorkflowV3[]                   // one per entry in the top selector
  rules: MaestroRuleV3[]                           // NOT edited here — owned by /rules
}

MaestroInstanceV3 { name, agent, loaded_skills: string[], referenced_skills: string[] }   // referenced by name from agent nodes; loaded = auto-load at start, referenced = load only if relevant
MaestroWorkflowV3 { name, nodes: MaestroNodeV3[], edges: MaestroEdgeV3[] }   // success_path is DERIVED, never stored
MaestroNodeV3     { id, type: "agent"|"human_review"|"skill", instance?, skill?, position? }
MaestroEdgeV3     { from, to, kind: "success"|"condition", label?, sourceHandle?, targetHandle? }
```

Key points:

- **Instances carry the agent + skills, nodes just reference them.** An agent node's `instance` field (and its `id`, which equals the instance name) points at a `workflow_instances` entry. Skills are stored once per instance, not per node — so the same instance reused across workflows shares one skill list. Editing an instance updates every placement. Each instance keeps two skill lists: `loaded_skills` (auto-loaded by the `SubagentStart` hook before the agent works) and `referenced_skills` (surfaced as available; the agent loads one only if the task needs it). The canvas chips render loaded skills solid and referenced skills dashed/muted.
- **`main-session` is synthetic.** `workflowToRfNodes` always prepends a non-deletable `main-session` node, and `rfNodesToMaestroNodes` filters it back out — so it never appears in `nodes[]`. But `rfEdgesToMaestroEdges` does **not** filter edges, so edges _from_ it persist with `from: "main-session"`. It is the implicit entry point every workflow starts from; the success path that reaches the terminal node marks the task complete.
- **`success_path` is derived, never stored.** It is computed by the plugin renderer (`successPath` in `maestro-render-orchestrator.cjs`) from the success edges and rendered into the orchestrator's `Maestro:HANDOFFS` table, but it is absent from `maestro.json`.

## Left pane (workflows.tsx)

- **Agents** checkboxes come from `bundledAgents` — read from `plugins/maestro/agents/*.md` frontmatter by `discoverAgents()` in `src/core`, in the main process. Toggling edits `config.agents_available`. `＋ Agent` `window.prompt`s for a manual id (for agents not bundled).
- **Skills** checkboxes come from `projectSkills` — read from `<projectRoot>/.claude/skills/*/SKILL.md` by `discoverSkills()`, likewise in main. Toggling edits `config.skills_available` (a plain `string[]` of skill ids). `＋ Skill` prompts for a manual id.
- `skills_available` is the menu of skills the canvas can attach to instances — only a skill checked here can be attached.
- **Save workflows** → `handleSubmit` → `submitMaestroConfig` → `router.invalidate()`. On success the page fires a `toast` (`@repo/ui/toast`) naming what changed on disk and **stays on the canvas** — the window is long-lived and the user saves repeatedly, so there is no terminal success view.

## Center canvas (workflow-canvas.tsx)

Built on `@xyflow/react` (React Flow). Four node types and two edge types are registered as **module-level constants** (`NODE_TYPES`/`EDGE_TYPES`) so React Flow never remounts nodes.

**Nodes**

- `mainSession` — green rounded card (`w-48 rounded-2xl border-2 border-green-400`), `deletable: false`. A bottom-center `+` button (`onAddNext`) opens the "Add step" modal. Handles (`left`, `right`, `bottom`) are fragment siblings of the card div — **not inside it** — so they anchor to the node bounding box, not to the card's flex flow.
- `agentNode` — card showing the instance name (primary) and `@agent` (secondary), skill chips from the referenced instance, side `+` buttons (left/right) for conditions, a bottom-center `+` button (`onAddNext`) for adding the next step, and a `⋮` kebab menu (Edit instance / Delete). Orange normally; **green when it is the success-path terminal** (see `findSuccessTerminalId`).
- `humanStep` — amber diamond rendering "Review" (`human_review`). Wrapped in a `relative` div so the bottom-center `+` button (`onAddNext`) and the `⋮` kebab (**Delete**) can be absolutely positioned around the diamond — both are **siblings** of the clipped diamond div, since the `clipPath` would cut off anything rendered inside it. Like `agentNode` it carries left/right `source` handles plus side `+` condition buttons (`onAddConditionEdge`), so a human-review step can **source** condition edges — used to route a correction back to the agent that produced the work under review (e.g. `human requested code corrections` → `@backend`). The orchestrator (not a subagent — a human-review node has no agent) reads the user's feedback and dispatches it to that node; the seeded default/tdd workflows wire this edge automatically (`buildWorkflow` in `maestro.ts`).
- `skillNode` — violet card rendering `/<skill>` for a standalone **skill step** (`type: "skill"`, carries a `skill` id, no instance). A `⋮` kebab offers **Change skill** / **Delete**, plus the bottom-center `+` (`onAddNext`). Like `human_review` it is a non-agent node: it carries no instance, is excluded from `placedInstanceNames`, renders in the success path as `/<skill>`, and at runtime the orchestrator runs it inline via the `Skill` tool (no subagent dispatch — see the `maestro-architecture` skill).

**Edges**

- `successEdge` — the solid straight path, `bottom → top`. Following it on success is the happy path; reaching the terminal node = task complete.
- `conditionEdge` — orange dashed + animated, drawn from a `left`/`right` handle → `top`, with a label. Used to branch back to an earlier step or off to a secondary path. The label box is always rendered with an inline `✎` edit button — it shows the label text, or a dashed `no label` placeholder when empty — so a missing label can still be filled in (see **Edit condition label**).

**Layout** — `applyDagreLayout` (dagre, `rankdir: "TB"`) runs whenever the workflow's nodes have no saved `position` (including brand-new empty workflows with only the synthetic main-session node). Once positions exist in `maestro.json` they're honored, and any drag persists back into each node's `position`.

**`FitViewEffect`** — a small module-level component rendered inside `ReactFlowProvider` that calls `useReactFlow().fitView()` imperatively (50 ms debounce) whenever `workflow.name` changes. This handles viewport re-centering when switching between workflows, since `fitView` as a ReactFlow prop only fires on mount.

**State sync pattern** — `handleNodesChange` and `handleEdgesChange` read latest state via `rfNodesRef`/`rfEdgesRef` (updated each render) instead of using functional updater form. `pushChange` (→ `onChange` → parent `setConfig`) is guarded by two rules:

- **Skip `dimensions` and `select`** — React Flow internal events; pushing them triggers "setState during render" on the parent.
- **Push `position` only on drag-end** (`c.dragging === false`) — pushing on every mousemove would cause `setConfig` → new `workflow` prop → sync effect rebuilds RF state mid-drag → blink. `handleEdgesChange` still pushes on every change (no drag).
- **Echo guard** — `pushChange` stores the emitted `MaestroWorkflowV3` object in `lastEmittedRef`. The sync `useEffect` skips re-building RF state when `workflow === lastEmittedRef.current`, preventing the parent's echoed update from resetting the canvas.

### Interactions

- **Add Agent** (bottom Panel bar) — walks the success path from `main-session` to the terminal node (`findSuccessTerminalId`), then opens the Add step modal anchored at the terminal so the new step extends the path.
- **Add step** (bottom `+` on every node) — every node has a bottom-center `+` button that calls `openAddStep(nodeId)`. This opens the **Add step modal**: a segmented **Agent / Human Review** picker. For Agent it renders the shared `InstancePicker` (`src/renderer/src/components/instance-picker.tsx`) — a **Reuse instance / New instance** toggle. Reuse lists unplaced instances; New takes a subagent + instance name + an `InstanceSkillPicker` (check to select a skill — referenced by default — then a per-row Loaded/Ref toggle). Human Review needs no extra input. Confirming calls `confirmAddStep()` → `resolveInstanceFromPicker` to get/create the instance, places the node at `y + INSERT_ROW_HEIGHT` below the source, and adds a `success` edge `source.bottom → new.top`. State: `addStepSourceId`, `addStepType`, `addStepPicker`; reset by `resetAddStep()`.
  - **Inserting mid-chain relinks both sides.** If the source already had an outgoing success edge, that edge is _displaced_, not dropped: `confirmAddStep` re-adds it as `new → oldTarget` (via `makeSuccessEdge`) and shifts every node at or below the insertion row down by `INSERT_ROW_HEIGHT` so the new node doesn't land on the one it displaced. The mirror case lives in `deleteNode` — removing a node that has both an incoming and an outgoing success edge re-joins predecessor → successor instead of severing the path.
  - **Already-placed subagents stay listed but disabled.** A subagent may appear at most once per workflow (the `SubagentStart` hook keys off `agent_type`), so `availableAgentsForNew` filters them out — which left the "New instance" dropdown _empty_ on the seeded workflows, where every agent is already placed. `InstancePicker` therefore also takes `unavailableAgents` and renders those as disabled `… (already in this workflow)` options, plus an explanatory line when none are free. `resolveInstanceFromPicker` returns `null` rather than falling back to an already-placed agent.
  - **The all-placed dead end is now also a fork affordance (`041`).** When `noFreeAgents` is true, `InstancePicker` renders a "Fork an agent as new" block — pick a source, name the fork, call `window.maestro.agents.fork(source, name)` (the same `forkAgent`/`agent:fork` channel `/agents`' "Fork into this project" uses — see `agents-view`/`agent-fork-sync`) — gated on an `onForked` prop so a picker instantiation with nowhere to route the result simply omits it. The sources offered are `unavailableAgents` intersected with the `forkableAgents` prop (`workflows.tsx` derives it as the discovered agents whose `source` is not `"project"`), because `forkAgent` **throws** on a project-tier agent — there is nothing to copy from. That is the same rule `/agents` applies by hiding its own fork button on a project card, and it means a fork's own output drops out of the list once the loader reloads. With nothing forkable the whole block is hidden and the dead-end prose stops offering it, rather than presenting a dropdown whose every option fails. On success, `workflows.tsx`'s `handleAgentForked` adds the name to `config.agents_available` (reactive — `availableAgentsForNew` derives from it, so the fork is selectable with **no restart**) and calls `router.invalidate()`, which is safe mid-edit because `seedWorkflowStore` keeps the in-memory config when `projectRoot` is unchanged.
- **Add condition** — two entry points, both opening the condition modal:
  1. Bottom-bar "Add condition" enters `__picking__` mode (crosshair cursor, source `+` buttons pulse); click a node to pick the source.
  2. A node's own left/right `+` button opens the modal for that node directly.
     The modal takes a label and a target — an existing node, or (via the same `InstancePicker`) a reused/new instance to seed a node. Confirm creates a `condition` edge from the source's `right` handle → target `top`.
- **Edit condition label** — every condition edge renders an inline `✎` button beside its label (threaded in via `enrichedEdges`, which injects `onEditLabel` into each `conditionEdge`'s `data`). Clicking opens the edit-label modal (`openEditLabel` → `confirmEditLabel`, state `editLabelEdgeId`/`editLabelValue`); Enter saves, Esc cancels. Saving keeps `e.label` and `data.maestroEdge.label` in sync — `rfEdgesToMaestroEdges` reads `e.label` first but falls back to `maestro.label`, so both must be set, and an emptied label clears both (reverting to the `no label` placeholder).
- **Attach skills per instance** — agent node `⋮` → Edit instance opens a modal with a subagent `<select>` and an `InstanceSkillPicker` (drawn from `availableSkills`): check a skill to attach it (referenced by default), then flip its per-row Loaded/Ref toggle. Saving rewrites that `workflow_instances` entry's `loaded_skills` / `referenced_skills` via `onInstancesChange`, so all placements update.
- **Edit instance** — agent node `⋮` → Edit instance (see above) is how you change an instance's agent or skills; the node id stays the instance name.
- **Single success edge per node** — `replaceSuccessEdgeFrom` strips any existing outgoing success edge before adding a new one (in `onConnect` and `confirmAddStep`), enforcing one success successor per node.
- **Instance placed once per workflow** — `placedInstanceNames` (memoised from the canvas) gates the reuse list and `resolveInstanceFromPicker`, so an instance can't appear twice in the same diagram.
- **Manual wiring** — `onConnect`: dragging from a `left`/`right` handle makes a condition edge; from `bottom` makes a success edge.
- **Delete** — kebab → Delete removes the node and every incident edge (the instance definition stays in `workflow_instances`).

Each of these computes the next nodes/edges and calls `pushChange` → `onChange` → `setConfig`, so the persisted model stays in lockstep with the canvas.

## Top selector (top-nav.tsx)

The centered control drives `config.workflows` through a custom dropdown (hand-rolled with an outside-click handler, not a native `<select>`):

- The trigger shows the active workflow name; clicking opens the menu.
- Each menu row switches the active workflow (`onSelect` → `activeWorkflowIdx`) and carries a trailing 🗑 button. Delete does **not** fire immediately — it opens a confirmation modal; only its **Delete** button calls `onRemove(i)` (dismissable via Cancel, backdrop, or Escape).
- **+ Add workflow** is pinned at the bottom of the menu (`onAdd` → `confirmCreateWorkflow` pushes a blank `{ name, nodes: [], edges: [] }`).
- The `✎` pencil beside the trigger renames the active workflow (`renameWorkflow`).

`WorkflowSelectorProps` is unchanged — `onRemove(i)` deletes the clicked row (not necessarily the active one). One workflow is edited at a time.

## Persistence (submitMaestroConfig)

Saving sends only the **workflow slice** (`agents_available`, `skills_available`, `workflow_instances`, `workflows`) with `sliceType: "workflows"`, over `config:save`. Main hands it to `saveConfig()` in `src/core`, which reads the existing `maestro.json`, overwrites just those fields (so `/rules`' `rules` survive), writes `<projectRoot>/.claude/maestro.json`, re-renders the orchestrator's `Maestro:HANDOFFS` table, and applies the rule placements. The `SaveResult` comes back with the rendered success paths and the rule summary, which is what the toast reports.

The route then calls `router.invalidate()` on the success path, after the `!res.ok` bail-out. A save is neither a navigation nor a project switch, so without it the loader data stays pinned at its load-time value and the `seeded` banner keeps telling the user their config is unsaved while it sits on disk. This is safe only because `seedWorkflowStore` bails on an unchanged `projectRoot` — re-running the loader cannot discard in-flight edits.

At runtime the `SubagentStart` hook (`maestro-inject-agent-context.js`) reads that same `.claude/maestro.json` (v3) at each subagent start to inject the instance's skills + condition-edge handoff rules. It reads the file directly, so a save is visible to the next dispatched subagent with nothing in between.

## Duplicate-agent-type banner (`041`)

On load, `workflows.tsx` renders a dismissible `config-issue-banner.tsx` (own component, not an
extension of `seeded-banner.tsx` — that banner has no dismiss affordance and covers an unrelated,
independently-occurring condition) when `loaderData.configIssues` is non-empty — a hand-edited
config with two placed instances on one bare agent, computed in main by
`config-validate.ts`'s `duplicateAgentTypes` (see `maestro-config-model`). `key={projectRoot}` so a
project switch remounts it with fresh dismissal state. It never blocks editing.

## Things that bite

- **`main-session` lives in edges but not nodes.** Code that consumes `workflows[].edges` must treat `"main-session"` as a valid `from` that has no matching entry in `nodes[]`. Filtering edges by "node exists" will silently drop the entry edge.
- **Skills live on the instance, not the node.** A node only stores `instance` (+ id + position); the agent and skills come from the `workflow_instances` entry. Editing an instance updates every node that references it across all workflows.
- **`success_path` is derived — never write it to `maestro.json`.** The plugin renderer (`successPath` in `maestro-render-orchestrator.cjs`) computes it from the edges and emits it into the orchestrator's `Maestro:HANDOFFS` table. Persisting it would duplicate state that can drift from the edges.
- **Save only touches the workflow slice.** Don't widen `submitMaestroConfig`'s workflow branch to write `rules` — that's the `/rules` route's slice, and a stray write will clobber it.
- **This route is no longer the only writer of the workflow slice.** `/agents` also saves it, to change one instance's `loaded_skills` / `referenced_skills` — it re-reads via `data:workflows` immediately before calling `config:save`, precisely because the merge replaces the whole block. If you change the shape of `workflow_instances`, `routes/agents.tsx` (`saveSkills`) has to move with it. Its chips default a newly ticked skill to **referenced**, matching `instance-skill-picker.tsx`, and it refuses to save skills at all while the config is `seeded` — writing would materialize a starter `maestro.json` as a side effect of visiting `/agents`.
- **An instance can only hold skills that are checked in the left pane.** The `InstanceSkillPicker` lists `availableSkills` (= `skills_available` ids). Unchecking a skill in the left pane after attaching it leaves a dangling id on the instance.
- **`NODE_TYPES`/`EDGE_TYPES` must stay module-level.** Moving them inside the component recreates the maps each render and React Flow remounts every node (loses selection, flickers).
- **Layout auto-runs for any workflow without saved positions** — including empty ones (only main-session). The old guard `nodes.length > 1` was removed; dagre handles single-node graphs correctly.
- **Don't call `pushChange` inside a state updater.** React Flow emits `dimensions` changes during its commit phase (node measurement). If `pushChange` runs inside `setRfNodes(nds => { pushChange(...); return nds })`, it triggers `setConfig` on the parent during render and React warns. Always call `pushChange` outside the setter and skip it for `dimensions`/`select` change types.
- **Register every edge `type` string in `EDGE_TYPES`.** If you create an edge with `type: "successEdge"` but omit it from `EDGE_TYPES`, React Flow warns on every render and falls back to the default edge. Both `successEdge` (solid, `#94a3b8`) and `conditionEdge` (orange dashed) are registered at module level.
- **Don't push position changes mid-drag.** Calling `pushChange` on every `position` change (every mousemove) causes `setConfig` → new `workflow` prop → sync effect rebuilds RF state → canvas blinks. Guard with `c.dragging === false` so positions only propagate on drop.
- **Handles must be siblings of the content div, not children.** Placing handles inside a flex/grid container makes React Flow position them relative to the container's height, causing them to land between elements instead of at the node's edge. Render handles in a `<>` fragment alongside the content `<div>`, as in `AgentNodeComponent` and the current `MainSessionNode`.
- **`@xyflow/react` base CSS must be explicitly imported.** React Flow v12 does not auto-inject styles. Without `import "@xyflow/react/dist/style.css"` nodes collapse to zero size (`.react-flow__node { position: absolute }` is missing). This import lives at the top of `workflow-canvas.tsx`.
