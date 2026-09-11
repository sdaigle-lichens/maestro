---
name: to-maestro-tasks
description: "Turn a plan or idea into a queue of ready-to-run Maestro task prompts saved under .claude/maestro-tasks/. Runs the confidence-check and use-code-architecture-design-check gates to sharpen intent and flag a needed code-architecture-design pass, sizes the work into as few tasks as it genuinely needs — often one — then writes a numbered, workflow-agnostic prompt file for each, for the Maestro orchestrator to classify and execute. Use when the user wants to break work into Maestro tasks, queue up prompts for the /maestro skill, or asks to convert a plan/spec/idea into runnable task files."
---

# To Maestro Tasks

Convert a plan, spec, or rough idea into **ready-to-run prompt files** under `<cwd>/.claude/maestro-tasks/`. Each file is a self-contained, workflow-agnostic prompt that the `/maestro` skill can classify and execute end-to-end.

## Process

### 1. Confidence check

Run the `confidence-check` skill to self-assess readiness to decompose the plan into task files.
If you get a **Score >= 0.9:** proceed straight to Step 2. Otherwise, let the `confidence-check` go through refining the idea with the user until it gets a score of above 0.9.

### 2. Design check

Run the `use-code-architecture-design-check` skill to decide whether the work needs a `code-architecture-design` pass before any task can be written. If it says RUN, invoke the `code-architecture-design` skill and carry its Design Brief into the tasks below.

### 3. Size the work

Once you are confident about the intent, and if necessary went through the design phase with the user, decide **how many tasks this needs — starting from one.**

**A task file is not free.** Each one is a full orchestrator run: classification, the Step 1 gates, and a cold-spawned subagent per success-path step. The forward path always spawns cold by design, so every extra task re-derives the same project context from scratch, then re-runs review and documentation over it. Two tasks where one would do roughly doubles the tokens and adds a handoff that can lose intent.

**Default to a single task.** Split only when a boundary meets one of these:

- **Different workflows.** The orchestrator selects one workflow per run — work needing two genuinely cannot share a run.
- **A hard wait in the middle** — an external dependency, a deploy, a human decision that must land before the rest is designable.
- **Parallelism you actually want** — two independent branches the user intends to run at once.
- **Too big for one context** to hold end-to-end.
- **A learning dependency** — the later part's design depends on *observing* the earlier part in use, not merely on its code existing.

**Not reasons to split:** layers or tiers (module, then CLI, then docs — that's the horizontal split, wearing a disguise); "tests/docs are their own concern"; a chain where each part only blocks the next; or task count as a proxy for thoroughness.

**If the dependency graph is a straight line, that is a signal to merge, not a valid plan.** No parallelism is gained and each boundary costs a full run.

When it genuinely is more than one, each must still be a **tracer bullet**: a thin vertical cut through ALL integration layers end-to-end, NOT a horizontal slice of one layer.

<vertical-slice-rules>

- Each task delivers a narrow but COMPLETE path through every layer (e.g. schema, API, UI, tests)
- A completed task is demoable or verifiable on its own
- Prefactoring belongs at the *start of the task that needs it*, not in a task of its own unless it stands alone

</vertical-slice-rules>

### 4. Quiz the user

If you landed on a single task, say so and show the title and acceptance criteria — don't manufacture a breakdown to have something to present.

For more than one, present the proposed breakdown as a numbered list. For each task, show:

- **Title**: short descriptive name
- **Blocked by**: which other tasks (if any) must complete first
- **User stories covered**: which user stories this addresses (if the source material has them)

**Name the split criterion each boundary meets** (from Step 3). A boundary you can't justify is one to merge. Then ask:

- Is any boundary here not worth a separate run?
- Are the dependency relationships correct?
- Is anything genuinely too large for one run?

Iterate until the user approves the breakdown.

### 5. Write the task files and sync the tracker

Once approved, prepare one object per approved task — **do not write the markdown files or `status.json` by hand.** Order tasks in the array exactly as the topological order from Step 4 (blockers before dependents; the script rejects a forward reference). **Do not name agents or workflows** in `whatToBuild` — choosing the workflow is the orchestrator's job (`maestro.md` Step 1), not the prompt's.

```json
[
  {
    "title": "Add login form",
    "whatToBuild": "A concise description of this task — the end-to-end behavior, not a layer-by-layer implementation plan. Use the project's domain vocabulary. Avoid specific file paths or code snippets; they go stale fast. Exception: if a precise artifact (state machine, reducer, schema, type shape) encodes a decision better than prose, inline just the decision-rich part.",
    "acceptanceCriteria": ["Criterion 1", "Criterion 2", "Criterion 3"],
    "blockedBy": []
  },
  {
    "title": "Wire login to session store",
    "whatToBuild": "...",
    "acceptanceCriteria": ["Criterion 1"],
    "blockedBy": [0]
  }
]
```

(A single-task array is the common case; the second entry above only exists to show how `blockedBy` is spelled.)

`blockedBy` is a list of **indices into this same array** (not filenames — the script hasn't assigned any yet). Write the array to a scratch file and run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-write-tasks.cjs" <path-to-json>
```

### 6. Report

Tell the user what was written — a single file, or the count and numeric range (e.g. `003–007`) — and that each is ready to paste into (or run from) a session where the `/maestro` skill is invoked.

## Notes

- These files are designed to be classified by the Maestro orchestrator (`.claude/skills/maestro/SKILL.md`). Keeping each prompt workflow-agnostic is what lets the orchestrator pick the right workflow per task and stay correct as `maestro.json` evolves.
- This skill never publishes to GitHub. If the user also wants tracked issues, that's a separate, explicit `/to-issues` invocation.
