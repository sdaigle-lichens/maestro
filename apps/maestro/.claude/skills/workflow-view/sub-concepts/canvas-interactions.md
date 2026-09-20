# Canvas interactions

Every interaction below computes the next nodes/edges and calls `pushChange` → `onChange` →
`setConfig`, so the persisted model stays in lockstep with the canvas.

- **Add Agent** (bottom Panel bar) — walks the success path from `main-session` to the terminal node
  (`findSuccessTerminalId`), then opens the Add step modal anchored at the terminal so the new step
  extends the path.
- **Add step** (bottom `+` on every node) — `openAddStep(nodeId)` opens the **Add step modal**: a
  segmented **Agent / Human Review** picker. For Agent it renders the shared `InstancePicker`
  (`src/renderer/src/components/instance-picker.tsx`) — a **Reuse instance / New instance** toggle.
  Reuse lists unplaced instances; New takes a subagent + instance name + an `InstanceSkillPicker`
  (check to select a skill — referenced by default — then a per-row Loaded/Ref toggle). Human Review
  needs no extra input. Confirming calls `confirmAddStep()` → `resolveInstanceFromPicker` to
  get/create the instance, places the node at `y + INSERT_ROW_HEIGHT` below the source, and adds a
  `success` edge `source.bottom → new.top`. State: `addStepSourceId`, `addStepType`,
  `addStepPicker`; reset by `resetAddStep()`.
- **Add condition** — two entry points, both opening the condition modal:
  1. Bottom-bar "Add condition" enters `__picking__` mode (crosshair cursor, source `+` buttons
     pulse); click a node to pick the source.
  2. A node's own left/right `+` button opens the modal for that node directly.

  The modal takes a label and a target — an existing node, or (via the same `InstancePicker`) a
  reused/new instance to seed a node. Confirm creates a `condition` edge from the source's `right`
  handle → target `top`.
- **Edit condition label** — every condition edge renders an inline `✎` beside its label (threaded in
  via `enrichedEdges`, which injects `onEditLabel` into each `conditionEdge`'s `data`). Clicking
  opens the edit-label modal (`openEditLabel` → `confirmEditLabel`, state
  `editLabelEdgeId`/`editLabelValue`); Enter saves, Esc cancels. Saving keeps `e.label` and
  `data.maestroEdge.label` in sync — `rfEdgesToMaestroEdges` reads `e.label` first but falls back to
  `maestro.label`, so **both must be set**, and an emptied label clears both (reverting to the `no
  label` placeholder).
- **Attach skills per instance / Edit instance** — agent node `⋮` → Edit instance opens a modal with
  a subagent `<select>` and an `InstanceSkillPicker` (drawn from `availableSkills`): check a skill to
  attach it (referenced by default), then flip its per-row Loaded/Ref toggle. Saving rewrites that
  `workflow_instances` entry's `loaded_skills` / `referenced_skills` via `onInstancesChange`, so all
  placements update. This is also how you change an instance's agent; the node id stays the instance
  name.
- **Single success edge per node** — `replaceSuccessEdgeFrom` strips any existing outgoing success
  edge before adding a new one (in `onConnect` and `confirmAddStep`).
- **Instance placed once per workflow** — `placedInstanceNames` (memoised from the canvas) gates the
  reuse list and `resolveInstanceFromPicker`.
- **Manual wiring** — `onConnect`: dragging from a `left`/`right` handle makes a condition edge; from
  `bottom` makes a success edge.
- **Delete** — kebab → Delete removes the node and every incident edge (the instance definition stays
  in `workflow_instances`).

## Inserting mid-chain relinks both sides

If the source already had an outgoing success edge, that edge is *displaced*, not dropped:
`confirmAddStep` re-adds it as `new → oldTarget` (via `makeSuccessEdge`) and shifts every node at or
below the insertion row down by `INSERT_ROW_HEIGHT` so the new node doesn't land on the one it
displaced. The mirror case lives in `deleteNode` — removing a node that has both an incoming and an
outgoing success edge re-joins predecessor → successor instead of severing the path.

## Already-placed subagents, and the fork affordance (`041`)

A subagent may appear at most once per workflow (the `SubagentStart` hook keys off `agent_type`), so
`availableAgentsForNew` filters them out — which left the "New instance" dropdown *empty* on the
seeded workflows, where every agent is already placed. `InstancePicker` therefore also takes
`unavailableAgents` and renders those as disabled `… (already in this workflow)` options, plus an
explanatory line when none are free. `resolveInstanceFromPicker` returns `null` rather than falling
back to an already-placed agent.

**That dead end is now also a fork affordance (`041`).** When `noFreeAgents` is true, `InstancePicker`
renders a "Fork an agent as new" block — pick a source, name the fork, call
`window.maestro.agents.fork(source, name)` (the same `forkAgent`/`agent:fork` channel `/agents`'
"Fork into this project" uses — see the `agents-view` / `agent-fork-sync` skills) — gated on an
`onForked` prop, so a picker instantiation with nowhere to route the result simply omits it. The
sources offered are `unavailableAgents` intersected with the `forkableAgents` prop (`workflows.tsx`
derives it as the discovered agents whose `source` is not `"project"`), because `forkAgent` **throws**
on a project-tier agent — there is nothing to copy from. That is the same rule `/agents` applies by
hiding its own fork button on a project card, and it means a fork's own output drops out of the list
once the loader reloads. With nothing forkable the whole block is hidden and the dead-end prose stops
offering it, rather than presenting a dropdown whose every option fails.

On success, `workflows.tsx`'s `handleAgentForked` adds the name to `config.agents_available`
(reactive — `availableAgentsForNew` derives from it, so the fork is selectable with **no restart**)
and calls `router.invalidate()`, which is safe mid-edit because `seedWorkflowStore` keeps the
in-memory config when `projectRoot` is unchanged.
