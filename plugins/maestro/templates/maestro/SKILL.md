---
name: maestro
description: "Orchestrates Maestro workflows: classifies the user's request, runs confidence and design gates, matches it to a workflow's success path, and manages the task graph. Invoke manually to drive a multi-agent workflow."
---

# Maestro Orchestrator

You are the Maestro orchestrator for this project. Your role is to classify incoming work, validate it through confidence and design gates, and then execute it by wiring up the configured subagents along the appropriate workflow path.

> The regions between the `<!-- Maestro:... -->` markers below are **generated** — the workflow table from `.claude/maestro.json`, the steps and principles from the plugin's template. Don't edit them by hand; `/maestro-update` — and any save from the Maestro desktop app — overwrites them. Everything *outside* those markers is yours to customise and is never touched.

<!-- Maestro:STEPS:START -->
## How to orchestrate

### Step 0 — Readiness check

**First, check that this project can orchestrate at all** — the hook scripts, `.claude/settings.json` registrations, the handoff table below and this skill's own managed regions are all a project-local COPY of, or a render from, something else, and any of them can be behind:

```bash
node "$CLAUDE_PROJECT_DIR/.claude/scripts/maestro-check-runtime.cjs"
```

One line of JSON. **Do exactly what its `instruction` field says**, then continue.

### Step 1 — Custom Checks

Run the `/confidence-check` and `/use-design-check` skills, whichever of them this project has. If confidence is low, gather more information; if the design check raises issues, address them. Both are gates on the same thing — that the request is understood well enough to commit a workflow to it — so clear them before choosing and executing one (Steps 2 and 3).

### Step 2 — Match to workflow

1. Read the workflow table from this step to understand the available workflows and their success paths.
2. Match the user's request to the most appropriate workflow based on the success path and the agents involved. If no workflow clearly matches, ask the user to clarify before proceeding.
3. Record the workflow that matches the user's request so the `SubagentStart` hook can inject the correct skills and handoff rules into each subagent. **If this run was invoked to complete a specific maestro-task queue file** (the request named a `.claude/maestro-tasks/NNN-*.md` file), pass that filename too so it's recorded now — while you still have it in front of you — rather than re-derived at the end:

```bash
node "$CLAUDE_PROJECT_DIR/.claude/scripts/maestro-set-session-workflow.cjs" "<workflow name>" # record workflow only
node "$CLAUDE_PROJECT_DIR/.claude/scripts/maestro-set-session-workflow.cjs" "<workflow name>" --task "<NNN-filename.md>" # record workflow and task
```

<!-- Maestro:HANDOFFS:START -->
# No workflows configured yet. Run /maestro-install to set up.
<!-- Maestro:HANDOFFS:END -->

### Step 3 — Execute the workflow

Create tasks for each step in the success path using `TaskCreate`. Wire dependencies with `TaskUpdate addBlockedBy`. Add human-review checkpoints at any `human review` step in the success path. Tag every task with `metadata: { maestro_step: "<label>" }` using the exact success-path label (`@<instance>`, `/<skill>`, or `human review`) so the validation hook can verify coverage.

**If `active_task` is set** (Step 2 recorded a task-queue file), also create a final **mark-task-done** task as the last node — `subject: "Mark <active_task> done"`, `metadata: { maestro_step: "mark-task-done" }`, blocked by the last real success-path step via `TaskUpdate addBlockedBy`. Because it depends on every prior step (including any `human review` approval), it only becomes runnable once the work is genuinely finished. When that task comes up, execute Step 4 and complete it. Making it a real node — rather than a thing you remember to do afterwards — is what stops it being dropped.

The success path mixes three kinds of step:
- `@<instance>` — an **agent step** (see below): dispatch a subagent with `Task`.
- `/<skill>` — a **skill step**: run that skill **yourself, inline, in your own context** via the `Skill` tool (just as you ran the gate skills in Step 1). Do **not** dispatch a subagent for it. The previous step's `handoff_details` payload is already in your context — pass it to / use it for the skill where relevant, then continue along the success path to the next step.
- `human review` — a hard stop: surface the work to the user (see Principles). If the user **approves**, continue along the success path. If the user **requests corrections**, do **not** implement them yourself — a human-review step may have `condition` edges pointing at the agent that produced the work under review (e.g. `human requested code corrections` → `@backend`). Dispatch the requested changes as a `Task` to that agent (matching the condition label to the user's intent — for fullstack, pick `@frontend` vs `@backend` by the nature of the change), then resume the success path from this step once the agent reports back. Only fall back to fixing it inline if no such condition edge exists.

For each agent step, use `Task` to invoke the corresponding subagent. The `SubagentStart` hook will automatically inject that instance's skills (the `loaded_skills` it auto-loads up front, plus any `referenced_skills` it loads only when the task calls for them), its `HANDOFF:` routing options, and the `handoff_details` payload shape for each route at the start of each invocation.

Each subagent ends its final message with a `HANDOFF:` line. Read it to decide routing:
- `HANDOFF: success` → continue along the workflow's success path to the next node.
- `HANDOFF: <label>` matching one of that agent's condition-edge labels (e.g. `HANDOFF: needs revision`) → route back to the node that condition edge points to, rather than continuing the success path.

If the line is missing or the label doesn't match any known condition, treat it as `success` but note the ambiguity to the user.

**Forward the handoff payload.** The subagent's final JSON includes a `handoff_details` object describing what the next agent needs (issues, failing tests, scribe notes, etc.). When you invoke the routed-to subagent, pass that `handoff_details` payload verbatim in its `Task` prompt — it is the structured input the receiving agent expects.

**Route `conceptSkillGaps` to the scribe.** A subagent's report may carry a non-empty `conceptSkillGaps` array — a concept skill it loaded that failed to tell it something it then had to work out from the code. Collect them across the run and hand them to `@scribe` (in the `handoff_details` of the scribe step if the workflow has one, otherwise as a dispatch of its own once the success path completes), naming each skill and what was missing, so it can run `/update-single-concept-skill` on them. An agent paid for that gap once; nobody should pay for it twice. An empty array means nothing to route — do not invent a follow-up.

### Step 4 — Mark the task done (the mark-task-done node)

This step runs when you reach the **mark-task-done** task created in Step 3 — i.e. only if `active_task` was set and every prior success-path step (including any `human review` approval) is complete. Do not run it after a partial run, a condition-edge loop that hasn't resolved, or while a review is still pending; the task's dependencies enforce that ordering for you.

Run the script with no filename — it reads `active_task` from the session state recorded in Step 2, so you don't re-derive it from the original prompt:

```bash
node "$CLAUDE_PROJECT_DIR/.claude/scripts/maestro-task-status.cjs" done
```

(You can still pass an explicit filename — `done 002-add-login.md` — to override.) The script flips that file to `done` and recomputes the queue's `status.json` so any dependents whose blockers are now all done become `ready` — you don't compute the cascade yourself. Then mark the mark-task-done task complete. If `active_task` is empty (the run wasn't invoked from a task file), there is no mark-task-done task and you skip this step.
<!-- Maestro:STEPS:END -->

<!-- Maestro:PRINCIPLES:START -->
## Principles

- **One workflow at a time.** Set the active workflow via `maestro-set-session-workflow.cjs` before invoking any subagents.
- **Trust the success path.** The path from `main-session` through the configured nodes is the authoritative sequence for this type of work.
- **Human reviews are hard stops.** Never bypass a `human review` step. Stop and surface the work to the user. When the user asks for changes, route them to the responsible agent via the human-review node's condition edges (see Step 3) instead of editing code in your own context.
- **Skill steps run inline.** A `/<skill>` step in the success path is run by you in your own context via the `Skill` tool — never dispatched as a subagent. Feed it the prior step's handoff payload where relevant, then continue.
- **Condition edges are feedback loops.** When a subagent signals a condition via its `HANDOFF:` line, honour it — route back to the indicated node rather than continuing.
- **Let the hooks do the injection.** Do not manually load skills into subagents; the `SubagentStart` hook handles that from `maestro.json`.
<!-- Maestro:PRINCIPLES:END -->
