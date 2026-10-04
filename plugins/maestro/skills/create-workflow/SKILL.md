---
name: create-workflow
description: "Adds a new workflow to this project's .claude/maestro.json from a compact declarative spec, instead of hand-authoring graph JSON. Handles a concrete request ('a workflow using only the backend and review agents', 'a workflow that goes backend then human review then reviewer') by building the spec directly, and a vague need ('a workflow for when no testing steps are needed', 'a workflow for small doc-only changes') by grounding the choice of steps in the project's actual concept skills and agents before proposing a spec. Use when the user asks to add, create, or design a new Maestro workflow, wants a workflow for a specific kind of task the existing ones don't cover, or the orchestrator itself offers this when no workflow clearly matches a request."
---

# Create Workflow

Your job is deciding the spec; `maestro-workflow-spec.cjs` handles all the geometry (node placement,
handles, label layout). The result round-trips exactly through the desktop app's `/workflows`
canvas.

A **spec** is `{ name, steps, conditions? }`:

- `steps` — the success path, in order. `"human_review-1"` is a human-review checkpoint;
  `"skill:<id>"` runs that skill inline (no subagent); anything else names a `workflow_instances`
  entry — an existing one is reused, a new name creates a fresh instance for that agent (only when
  the project offers that agent — nothing is invented).
- `conditions` — optional `{ from, to, label }` routes, naming step tokens the same way. A target
  already in `steps` wires onto that node; anything else creates the node OFF the success path, in a
  side column (this is how the seeded `refactor` agent exists in the default workflows).

## Workflow

1. **Read `.claude/maestro.json`**: `agents_available`, `skills_available`, and `workflow_instances`
   (reusable by name). Build the spec against these; don't guess agent names.

2. **Concrete or vague?**
   - **Concrete** — the user named the agents/skills/human-review steps and (usually) their order
     ("backend, then human review, then reviewer, with reviewer failures back to backend"). Map it
     onto tokens and conditions, show the spec as a brief sanity check, and on their go-ahead go to
     step 3.
   - **Vague** — the user described a situation ("a workflow for when no testing steps are
     needed"). Invoke `explore-concept-skills` via the `Skill` tool (it isn't user-invocable) to find
     which concept skills and agents bear on it, then propose a spec grounded in what it reports —
     e.g. "no testing" → omit `@test` and point the reviewer's FAIL routes at the implementation
     agent. **Wait for explicit confirmation before writing** — these steps were inferred, not
     stated.

3. **Write the spec to a scratch file** (JSON on the command line isn't reliably shell-quotable) and
   run:

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-workflow-spec.cjs" create --spec-file <path-to-spec.json> "${CLAUDE_PROJECT_DIR:-.}"
   ```

   It re-reads `maestro.json` immediately before writing, then writes the config and re-renders the
   orchestrator's handoff table in one step.

4. **On failure** (non-zero exit, stderr), nothing was written. Fix the spec and retry step 3:
   - *Workflow name already exists* — pick another name, or use `/update-workflow` to change it.
   - *Agent step names no existing instance and no available agent* — the message lists what is
     available. Never substitute an agent on your own judgment; ask the user, or point them at
     `/create-subagent`.
   - *Two steps resolve to the same agent* — an agent is placed at most once per workflow; rename
     one instance or drop the duplicate.

5. **On success** the script prints `{ ok, mode, workflow, createdInstances, issues, render }`.
   Report the workflow created and any newly created instances. If `issues` or `render.issues` is
   non-empty, relay them as warnings — the workflow was written regardless. If `render.ok` is false,
   the handoff table couldn't be re-rendered (usually the orchestrator isn't installed yet) — suggest
   the user run `/maestro-install`.
