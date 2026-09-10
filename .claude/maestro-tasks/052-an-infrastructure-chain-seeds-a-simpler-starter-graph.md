# An infrastructure chain seeds a simpler starter graph

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Make the seeded starter graph depend on what was detected, so an infrastructure repository does not open onto a canvas of workflows it will never run.

Today the first-install seed is unconditional: whatever the implementation chain, a project opens with the same six ready-made workflows and the same set of non-implementation instances. For an infrastructure repository most of that is dead weight — a test-first workflow, a dedicated testing workflow and a refactor-audit workflow do not mean much for declarative infrastructure, and an empty canvas of workflows nobody will run is worse than a small one.

**The shape.** A chain that is exactly the infrastructure agent and nothing else seeds:

- a `default` workflow whose success path is main session → the infrastructure agent → human review → review → documentation, with the reviewer's code-issue route and the human-review correction route both leading back to the infrastructure agent;
- the two single-step workflows that still apply, for a review-only and a documentation-only request;
- instances for only the agents those workflows actually reference.

No testing node and no refactor node anywhere in that set. Verification lives in the infrastructure agent's own definition (slice 1); the human review step before the reviewer is what gates anything that would touch a real environment.

Any other chain — including a chain the user has corrected on the canvas to hold the infrastructure agent *and* an application agent — keeps today's six workflows and today's instances, with the infrastructure agent treated as an ordinary implementation step. A mixed repository is an application repository that happens to have infrastructure, and it wants the full set.

**The design decided in the design pass, which this slice implements.** The two public seeding entry points keep their exact signatures — the workflow set and the agent-name list are both *derived from the chain they are already given*. Both must read a single private profile decision, so they cannot disagree about which agents exist: the agent-name list is what three separate callers use to build the install-time skill map, and a skill mapped to an instance the graph never created is a silent inconsistency. Do not widen either signature, do not add a second exported config builder, and do not push the choice out to the callers — one of those callers is a separately-shipped copy that would drift the first time either side changed.

The existing multi-step workflow builder is not the place for this. Its body is mostly testing, refactor-audit and multi-implementation-agent splitting, all of which the simple path skips; a third mode there would guard off most of the function and put the profile decision in two places.

## Skills to use

Load these before you start — they carry what this task needs, and reading them beats
rediscovering the same thing from source:

- `installing-maestro` — what a first install seeds, and that it seeds only when the config is absent
- `maestro-config-model` — the `workflow_instances` and `workflows` slices this writes, and the slice-merge discipline
- `workflow-view` — the canvas, the chain chips, and the reseed round trip that rebuilds the graph
- `react-flow-canvas-geometry` — condition-edge label placement, which every seeded graph is asserted on

## When you're done

Run the project's `default` workflow to completion — its success path is implementation → human
review → **@test** → **@reviewer** → **@scribe**. Do not treat the documentation step as a shortcut
past the two before it. When you reach **@scribe**, load the `scribe` skill: it is the routing rule
for what belongs in a concept skill versus in `docs/`, and it has to be in context before anything
is written. This slice changes behaviour that the concept skills already describe, so updating them
is part of the change rather than a follow-up.

## Acceptance criteria

- [ ] A chain of exactly the infrastructure agent seeds three workflows — the simple default plus the review-only and documentation-only ones — and instances for only the agents those workflows reference
- [ ] The simple default's success path is main session → infrastructure → human review → review → documentation, and neither a testing nor a refactor node appears anywhere in the seeded set
- [ ] The reviewer's code-issue condition route and the human-review correction route both lead back to the infrastructure agent
- [ ] A mixed chain holding the infrastructure agent alongside an application agent seeds the existing six workflows, with the infrastructure agent as an ordinary implementation step
- [ ] Both public seeding entry points keep their existing signatures, and the agent-name list agrees with the instances the config actually contains for every chain
- [ ] Condition-edge labels in the seeded infrastructure graph are placed clear of nodes, as the existing layout assertion requires of every seeded graph
- [ ] Every existing seeding assertion for application chains passes unchanged
- [ ] Correcting the chain on the canvas to add an application agent swaps the seeded set from three workflows to six, and correcting it back swaps it in return
- [ ] Handed off to the @scribe agent with the `scribe` skill loaded, and the concept skills this change affects are updated

## Blocked by

- `051-detect-an-infrastructure-repository-and-say-what-it-suppressed.md`
