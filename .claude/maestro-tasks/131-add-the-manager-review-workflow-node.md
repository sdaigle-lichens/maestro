# Add the manager_review workflow node

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Add a new workflow step type, manager_review, beside human_review, so a workflow can include a 'manager review' stop. human_review stays human-only and unchanged. The node type exists in the workflow graph model and its step-id parsing (like human_review-N), gets the success-path label `manager review`, and success edges resolve through it the way they resolve through human_review. Add a new condition edge, 'manager requested direction change', from manager_review back to the agent that produced the work, distinct from the 'human requested ... corrections' edges. The desktop app's canvas offers it as a third 'Add step' option with its own node style and its condition '+' buttons. The task-validation hook and the task-status plan commands accept the `manager review` label. This step only models and routes the node; what the orchestrator does when it reaches it is a later task, so until then the orchestrator treats it as a human review. Includes the app code, the canvas UI, the plugin's validation and status scripts, the regenerated plugin libs and tracked mirrors, tests, and a plugin version bump.

## Acceptance criteria

- [ ] A manager_review node can be added on the canvas, saved to maestro.json, reloaded, and rendered distinctly from human_review
- [ ] The success path lists `manager review` at the node's position, and success edges resolve through it like human_review
- [ ] A `manager requested direction change` condition edge from manager_review to an agent can be drawn and is routed to that agent
- [ ] maestro-validate-tasks and maestro-task-status plan accept the `manager review` label
- [ ] The orchestrator template treats a `manager review` step as a human review until the manager protocol exists
- [ ] Plugin libs are rebuilt, mirrors refreshed, the parity test passes, the plugin version is bumped, and pnpm verify passes

## Blocked by

None — can start immediately
