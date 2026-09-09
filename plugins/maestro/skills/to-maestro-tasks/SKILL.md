---
name: to-maestro-tasks
description: "Turn a plan or idea into a queue of ready-to-run Maestro task prompts saved under .claude/maestro-tasks/. Runs the confidence-check and use-code-architecture-design-check gates to sharpen intent and flag a needed code-architecture-design pass, decomposes the work into tracer-bullet vertical slices, then writes one numbered, workflow-agnostic prompt file per slice for the Maestro orchestrator to classify and execute. Use when the user wants to break work into Maestro tasks, queue up prompts for the /maestro skill, or asks to convert a plan/spec/idea into runnable task files."
---

# To Maestro Tasks

Convert a plan, spec, or rough idea into a queue of **ready-to-run prompt files** under `<cwd>/.claude/maestro-tasks/`. Each file is a self-contained, workflow-agnostic prompt that the `/maestro` skill can classify and execute end-to-end.

## Process

### 1. Confidence check

Run the `confidence-check` skill to self-assess readiness to decompose the plan into task files.
If you get a **Score >= 0.9:** proceed straight to Step 2. Otherwise, let the `confidence-check` go through refining the idea with the user until it gets a score of above 0.9.

### 2. Design check

Run the `use-code-architecture-design-check` skill to decide whether the work needs a `code-architecture-design` pass before any slice can be written. If it says RUN, invoke the `code-architecture-design` skill and carry its Design Brief into the slices below.

### 3. Draft vertical slices

Once you are confident about the intent and if necessary went through the design phase with the user, break the plan into **tracer-bullet** slices. Each slice is a thin vertical cut through ALL integration layers end-to-end, NOT a horizontal slice of one layer.

<vertical-slice-rules>

- Each slice delivers a narrow but COMPLETE path through every layer (e.g. schema, API, UI, tests)
- A completed slice is demoable or verifiable on its own
- Any prefactoring should be done first

</vertical-slice-rules>

### 4. Quiz the user

Present the proposed breakdown as a numbered list. For each slice, show:

- **Title**: short descriptive name
- **Blocked by**: which other slices (if any) must complete first
- **User stories covered**: which user stories this addresses (if the source material has them)

Ask the user:

- Does the granularity feel right? (too coarse / too fine)
- Are the dependency relationships correct?
- Should any slices be merged or split further?

Iterate until the user approves the breakdown.

### 5. Write the task files and sync the tracker

Once approved, prepare one slice object per approved item — **do not write the markdown files or `status.json` by hand.** Order slices in the array exactly as the topological order from Step 4 (blockers before dependents; the script rejects a forward reference). **Do not name agents or workflows** in `whatToBuild` — choosing the workflow is the orchestrator's job (`maestro.md` Step 1), not the prompt's.

```json
[
  {
    "title": "Add login form",
    "whatToBuild": "A concise description of this vertical slice — the end-to-end behavior, not a layer-by-layer implementation plan. Use the project's domain vocabulary. Avoid specific file paths or code snippets; they go stale fast. Exception: if a precise artifact (state machine, reducer, schema, type shape) encodes a decision better than prose, inline just the decision-rich part.",
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

`blockedBy` is a list of **indices into this same array** (not filenames — the script hasn't assigned any yet). Write the array to a scratch file and run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-write-tasks.cjs" <path-to-json>
```

### 6. Report

Tell the user how many task files were written, the numeric range (e.g. `003–007`), and that each is ready to paste into (or run from) a session where the `/maestro` skill is invoked.

## Notes

- These files are designed to be classified by the Maestro orchestrator (`.claude/skills/maestro/SKILL.md`). Keeping each prompt workflow-agnostic is what lets the orchestrator pick the right workflow per task and stay correct as `maestro.json` evolves.
- This skill never publishes to GitHub. If the user also wants tracked issues, that's a separate, explicit `/to-issues` invocation.
