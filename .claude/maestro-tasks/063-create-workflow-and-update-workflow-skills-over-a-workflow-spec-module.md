# create-workflow and update-workflow skills over a workflow-spec module

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Two published skills that add or change a workflow in a project's Maestro config, driven by a compact declarative spec rather than by hand-authored graph JSON. Each can be invoked with a concrete request ("a workflow using only the backend and review agents") or with a need to reason about ("a workflow for when no testing steps are needed"); the reasoning half calls the concept-skill exploration skill to ground the choice of steps in what the project actually is, proposes the resulting spec to the user, and only writes once confirmed.

The mechanics sit in a new PURE module in the app's core, bundled to the plugin the same way the other runtime libs are, and exposed through a thin CLI the skills invoke. Two entry points, both pure — they return a new config and write nothing:

  applyWorkflowSpec(cfg, spec, mode: "create" | "update")
    -> { config, workflow, createdInstances, issues, errors }
  workflowToSpec(wf, instances) -> WorkflowSpec

  WorkflowSpec = { name, steps: string[], conditions?: { from, to, label }[] }

A step string REUSES the existing seed vocabulary rather than inventing a second one: "human_review" is a human-review node, "skill:<id>" is a skill node the orchestrator runs inline, anything else is the instance name of an agent node.

Invariants the module owns, which are the reason it exists at all:
- The session's entry node is implicit; the success chain is exactly `steps`, in order.
- A condition endpoint NOT in `steps` introduces an OFF-PATH node in a side column — this is how the seeded refactor agent already exists, and the spec must keep being able to express it.
- On create the name must not already exist; on update it must.
- An agent step naming an instance that does not exist creates one, but ONLY for an agent already offered to the canvas; otherwise it errors and lists what is available. It never invents an agent.
- Two agent steps resolving to the same bare agent name is an error, not a repair — that collision breaks route dedup, skill injection and channel lanes at runtime.
- On update, a node id already present KEEPS its stored position, so a layout arranged by hand in the desktop app survives; only genuinely new nodes are laid out. Condition-label offsets are always recomputed.
- Config validation issues are REPORTED alongside the result, never silently repaired.
- It must run under bare node with no node_modules: no filesystem access, no sqlite, no node built-ins of any kind. Agent discovery therefore stays outside this module.

Node placement, handle sides, the vertical rhythm, condition-edge exit sides and label offsets are all DELEGATED to the existing layout code — retyping any of that in the module or in skill prose is the specific failure this design exists to avoid.

The CLI is the only part that touches the filesystem: re-read the config immediately before writing (it is a third writer of that slice, and another writer may have moved it), apply the spec, write, then re-render the orchestrator's generated handoff table so the project is not left stale.

Finally, wire the three callers: the orchestrator template's workflow-matching step should offer to create a workflow when nothing matches instead of only asking the user to clarify; the post-mortem's remediation levers should include both skills; and the update skill's asset list should learn the new script. Update the affected concept skills and the repo's own guidance to match.

## Acceptance criteria

- [ ] Round-trip is exact: for every workflow in every seeded profile, reading a workflow back to a spec and re-applying it in update mode reproduces that graph exactly — same nodes, same edges, same positions.
- [ ] A workflow created from a spec renders correctly on the desktop app's canvas: no overlapping nodes, and every condition label placed clear of the nodes and of the other labels.
- [ ] Updating a workflow preserves the stored position of every node that already existed, including one moved by hand since it was created.
- [ ] A condition route naming a step that is not on the success path creates that node off the success path rather than erroring or silently dropping the route.
- [ ] A spec naming an agent the project does not offer is rejected with a message listing what IS available; no agent is invented and nothing is written.
- [ ] A spec placing two agent steps that resolve to the same bare agent name is rejected before anything is written.
- [ ] Creating with a name that already exists, and updating a name that does not, are each rejected with a clear message.
- [ ] Writing re-reads the config immediately beforehand and leaves every other part of the config byte-identical — rules, gates, reports, handoffs and task-routing are untouched.
- [ ] After a write, the orchestrator skill's generated handoff table contains a row for the new or changed workflow, and the runtime readiness check does not report the project stale.
- [ ] Invoked with a vague need rather than a concrete request, the skill grounds its proposal in the project's concept skills and presents the spec for confirmation before writing anything.
- [ ] The pure module contains no filesystem, sqlite or other node built-in usage, and its generated bundle is regenerated and committed — verified by reading the bundle diff, not by a green test suite.
- [ ] The orchestrator template's workflow-matching step offers workflow creation when no workflow matches, and the post-mortem lists both skills among its remediation levers.
- [ ] The plugin manifest version is bumped by a minor component, since the published surface gains new skills.

## Blocked by

None — can start immediately
