---
name: update-workflow
description: "Changes an existing workflow in this project's .claude/maestro.json from a compact declarative spec, instead of hand-editing graph JSON. Reads the workflow's CURRENT spec first so the user's request reads as a diff — e.g. 'remove the testing step', 'add a human review before the reviewer', 'route reviewer failures to refactor instead'. Handles a concrete request by editing the spec directly, and a vague need ('a workflow for when no testing steps are needed') by grounding the change in the project's actual concept skills and agents before proposing it. Use when the user asks to change, edit, add a step to, remove a step from, or rewire an existing Maestro workflow."
---

# Update Workflow

Change an existing workflow in `.claude/maestro.json` by editing its spec — `{ name, steps, conditions? }` — rather than hand-editing the graph's nodes and edges. Node placement, handle sides, and condition-label layout are handled entirely by `maestro-workflow-spec.cjs`; existing nodes keep their canvas positions (including one moved by hand in the desktop app), and only genuinely new nodes get laid out.

See `create-workflow`'s SKILL.md for the step-token vocabulary (`"human_review-1"`, `"skill:<id>"`, or an agent instance name) and what a condition naming a step off the success path does (creates it in a side column, same as the seeded `refactor` agent).

## Workflow

1. **Identify the workflow.** If the user didn't name it, ask, or infer it from context (e.g. "the default workflow").

2. **Read its CURRENT spec** — this is what makes the user's request read as a diff instead of a re-derivation from scratch:

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-workflow-spec.cjs" to-spec --name "<workflow name>" "${CLAUDE_PROJECT_DIR:-.}"
   ```

   Prints the workflow's spec as one line of JSON, or an error naming the workflows that DO exist if the name doesn't match (in which case: did they mean `/create-workflow` instead?). Also read `.claude/maestro.json`'s `agents_available`/`workflow_instances` directly, the same as `/create-workflow` does — an edit still has to be built against what the project actually offers.

3. **Decide whether the request is concrete or a need to reason about**, same distinction as `/create-workflow`:

   - **Concrete** — the user named the change directly: "remove the testing step," "add a human review before the reviewer," "route reviewer failures to `@refactor` instead of `@backend`." Go to step 4.
   - **Vague** — the user described a situation the workflow should now handle differently, e.g. "a workflow for when no testing steps are needed" applied to an existing one. Go to step 5.

4. **Concrete path — edit the spec directly.** Start from the current spec (step 2) and apply the requested change: add/remove/reorder a `steps` entry, or add/remove/relabel a `conditions` entry. Show the user the resulting spec (or just the diff against the current one — steps added/removed, conditions changed) as a brief confirmation before writing. On their go-ahead, skip to step 6.

5. **Vague path — ground the change first.** Invoke the `explore-concept-skills` skill (via the `Skill` tool) to find which of the project's concept skills and agents bear on the described situation, then propose the resulting spec change against the CURRENT spec from step 2 — e.g. "no testing steps" removes `@test` from `steps` and re-points any condition that routed to it. **Present the new spec and wait for the user's explicit confirmation before writing anything.**

6. **Write the new spec to a scratch file**, then run the CLI in update mode:

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-workflow-spec.cjs" update --spec-file <path-to-spec.json> "${CLAUDE_PROJECT_DIR:-.}"
   ```

   It re-reads `.claude/maestro.json` itself immediately before writing, applies the new spec over the existing workflow (keeping every unmoved node's stored position), and — on success — writes the config and re-renders the orchestrator's handoff table.

7. **On failure**, nothing was written. Same causes and fixes as `/create-workflow`'s step 6 (no such workflow to update — the message names what DOES exist; an unavailable agent — never substitute one yourself; two steps resolving to the same agent). Fix the spec and retry from step 6.

8. **On success**, the script prints `{ ok, mode, workflow, createdInstances, issues, render }`. Report what changed (compare against the spec read in step 2: which steps or conditions were added/removed), any newly created instances, and any config-hygiene `issues`/`render.issues` (reported, not blocking).

## Notes

- This skill never invents an agent, same as `/create-workflow`.
- Removing a step from `steps` does not delete its `workflow_instances` entry — an instance not placed anywhere costs nothing and stays available for reuse. If the user wants the instance itself gone too, that's a hand-edit or a desktop-app canvas change, not something this spec format expresses.
- The desktop app's canvas (`apps/maestro` → `/workflows`) edits the identical shape — a change made there and one made here are indistinguishable in `maestro.json`.
- See `create-workflow`'s Notes for the shared cross-references (`maestro-config-model`, `workflow-view`, `maestro-architecture`).
