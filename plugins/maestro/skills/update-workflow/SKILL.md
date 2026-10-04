---
name: update-workflow
description: "Changes an existing workflow in this project's .claude/maestro.json from a compact declarative spec, instead of hand-editing graph JSON. Reads the workflow's CURRENT spec first so the user's request reads as a diff — e.g. 'remove the testing step', 'add a human review before the reviewer', 'route reviewer failures to refactor instead'. Handles a concrete request by editing the spec directly, and a vague need ('a workflow for when no testing steps are needed') by grounding the change in the project's actual concept skills and agents before proposing it. Use when the user asks to change, edit, add a step to, remove a step from, or rewire an existing Maestro workflow."
---

# Update Workflow

Edit the workflow's spec, `{ name, steps, conditions? }`; `maestro-workflow-spec.cjs` handles the
geometry. Existing nodes keep their canvas positions (including ones moved by hand in the desktop
app); only new nodes get laid out.

Step tokens: `"human_review-1"`, `"skill:<id>"`, or a `workflow_instances` name. A condition
`{ from, to, label }` whose target isn't in `steps` creates that node off the success path, in a
side column.

## Workflow

1. **Identify the workflow.** If the user didn't name it, ask, or infer it from context.

2. **Read its CURRENT spec**, so the request reads as a diff:

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-workflow-spec.cjs" to-spec --name "<workflow name>" "${CLAUDE_PROJECT_DIR:-.}"
   ```

   On a name mismatch it lists the workflows that DO exist — maybe they meant `/create-workflow`.
   Also read `.claude/maestro.json`'s `agents_available` and `workflow_instances`; the edit must be
   built against what the project offers.

3. **Concrete or vague?**
   - **Concrete** — the user named the change ("remove the testing step", "route reviewer failures
     to `@refactor` instead of `@backend`"). Apply it to the current spec, show the diff as a brief
     sanity check, and on their go-ahead go to step 4.
   - **Vague** — the user described a situation ("no testing steps needed"). Invoke
     `explore-concept-skills` via the `Skill` tool to find which concept skills and agents bear on
     it, then propose the change against the current spec — e.g. remove `@test` and re-point any
     condition that routed to it. **Wait for explicit confirmation before writing.**

4. **Write the new spec to a scratch file** and run:

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-workflow-spec.cjs" update --spec-file <path-to-spec.json> "${CLAUDE_PROJECT_DIR:-.}"
   ```

   It re-reads `maestro.json` immediately before writing, then writes the config and re-renders the
   orchestrator's handoff table.

5. **On failure** (non-zero exit, stderr), nothing was written. Fix the spec and retry step 4:
   - *No such workflow* — the message names what does exist.
   - *Agent step names no existing instance and no available agent* — never substitute an agent on
     your own judgment; ask the user, or point them at `/create-subagent`.
   - *Two steps resolve to the same agent* — an agent is placed at most once per workflow.

6. **On success** the script prints `{ ok, mode, workflow, createdInstances, issues, render }`.
   Report which steps and conditions were added or removed (against step 2's spec), any newly
   created instances, and any `issues` / `render.issues` as non-blocking warnings.

## Notes

- Removing a step does not delete its `workflow_instances` entry — an unplaced instance costs
  nothing and stays reusable. Deleting the instance itself is a hand-edit or a desktop-app change;
  this spec format can't express it.
