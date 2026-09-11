---
name: create-workflow
description: "Adds a new workflow to this project's .claude/maestro.json from a compact declarative spec, instead of hand-authoring graph JSON. Handles a concrete request ('a workflow using only the backend and review agents', 'a workflow that goes backend then human review then reviewer') by building the spec directly, and a vague need ('a workflow for when no testing steps are needed', 'a workflow for small doc-only changes') by grounding the choice of steps in the project's actual concept skills and agents before proposing a spec. Use when the user asks to add, create, or design a new Maestro workflow, wants a workflow for a specific kind of task the existing ones don't cover, or the orchestrator itself offers this when no workflow clearly matches a request."
---

# Create Workflow

Add a new workflow to this project's `.claude/maestro.json` from a short spec — which steps, in what order, plus any condition routes — instead of drawing the graph by hand or hand-editing JSON. The mechanics (node placement, handle sides, condition-label layout) are handled entirely by `maestro-workflow-spec.cjs`; your job is deciding the spec, not the geometry.

A **spec** is `{ name, steps, conditions? }`:

- `steps` — the success path, in order, as an array of tokens. `"human_review-1"` is a human-review checkpoint; `"skill:<id>"` runs that skill inline (no subagent); anything else is the name of a `workflow_instances` entry — an existing one is reused, a new name creates a fresh instance for that agent (only when the project actually offers that agent — nothing is invented).
- `conditions` — optional `{ from, to, label }` routes. `from`/`to` name step tokens the same way. A condition naming a step already in `steps` wires onto that node; naming anything else creates that node OFF the success path, in a side column (this is how the seeded `refactor` agent exists in the default workflows).

## Workflow

1. **Read the project's current config** — `.claude/maestro.json`'s `agents_available` (which agents this project offers at all), `skills_available`, and `workflow_instances` (agent instances already placed in other workflows, reusable by name). This is what a spec's steps have to be built against; don't guess at agent names.

2. **Decide whether the request is concrete or a need to reason about.**

   - **Concrete** — the user already named the agents, skills, or human-review steps and (usually) their order, e.g. "a workflow using only the backend and review agents" or "backend, then human review, then reviewer, with the reviewer routing failures back to backend." Go to step 3.
   - **Vague** — the user described a *situation* rather than a step list, e.g. "a workflow for when no testing steps are needed" or "a workflow for small documentation-only changes." Go to step 4.

3. **Concrete path — build the spec directly.** Map what the user asked for onto step tokens and conditions using the vocabulary above. Show the user the resulting spec before writing — the steps in order, and any off-path condition targets — as a brief confirmation (the request was already concrete, so this is a sanity check, not a design review). On their go-ahead, skip to step 5.

4. **Vague path — ground the choice of steps first.** Invoke the `explore-concept-skills` skill (via the `Skill` tool — it is not user-invocable, so this is the only way to reach it) to find which of the project's concept skills and agents bear on the situation described. Use what it reports to propose a concrete spec: which agents/skills/human-review steps, in what order, and any condition routes that follow from the concepts loaded (e.g. "no testing steps" → a step list that omits `@test` entirely, with the reviewer's FAIL routes pointed at the implementation agent instead). **Present the spec and wait for the user's explicit confirmation before writing anything** — this path does not get the "brief" treatment step 3 does, because the steps were inferred, not stated.

5. **Write the spec to a scratch file** (a JSON blob on the command line isn't reliably shell-quotable), then run the CLI:

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-workflow-spec.cjs" create --spec-file <path-to-spec.json> "${CLAUDE_PROJECT_DIR:-.}"
   ```

   It re-reads `.claude/maestro.json` itself immediately before writing (never trust an earlier read), applies the spec, and — on success — writes the config and re-renders the orchestrator's handoff table in one step.

6. **On failure** (non-zero exit, messages on stderr): nothing was written. Common causes and the fix:
   - *A workflow with this name already exists* — use `/update-workflow` instead, or pick a different name.
   - *An agent step names no existing instance and no such agent is available* — the message lists what IS available. Never substitute a different agent on your own judgment; ask the user, or point them at `/create-subagent`.
   - *Two steps resolve to the same agent* — rename one of the instances in the spec (an agent can be placed at most once per workflow) or drop the duplicate step.

   Fix the spec and retry from step 5.

7. **On success**, the script prints one line of JSON: `{ ok, mode, workflow, createdInstances, issues, render }`. Report to the user: the workflow was created, which instances (if any) were newly created for it, and — if `issues` or `render.issues` is non-empty — the config-hygiene warnings it found (these are reports, not blockers; the workflow was written regardless). If `render.ok` is false, say the orchestrator's handoff table couldn't be re-rendered (usually because the orchestrator skill isn't installed yet) and suggest `/maestro-install`.

## Notes

- This skill never invents an agent. A step naming an agent this project doesn't offer is always rejected — the fix is either to name a different agent or to create one first (`/create-subagent`).
- To see or change an EXISTING workflow's spec, use `/update-workflow` — it can print the current spec via the same CLI's `to-spec` subcommand before proposing a change.
- Editing the graph visually is still available — open the project in the Maestro desktop app (`apps/maestro`) → `/workflows`. Anything this skill writes round-trips through that canvas exactly, since it produces the same `MaestroWorkflowV3` shape the app itself writes.
- See the `maestro-config-model` and `workflow-view` skills (in `apps/maestro/.claude/skills`) for the underlying config shape this CLI edits, and `maestro-architecture` (at the repo root) for how a new workflow is picked up by the orchestrator.
