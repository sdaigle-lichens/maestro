---
name: to-maestro-tasks
description: "Turn a plan or idea into a queue of ready-to-run Maestro task prompts saved under .claude/maestro-tasks/. Runs a /grilling session to sharpen intent, decomposes the work into tracer-bullet vertical slices, then writes one numbered, workflow-agnostic prompt file per slice for the Maestro orchestrator to classify and execute. Use when the user wants to break work into Maestro tasks, queue up prompts for the /maestro skill, or asks to convert a plan/spec/idea into runnable task files."
---

# To Maestro Tasks

Convert a plan, spec, or rough idea into a queue of **ready-to-run prompt files** under `<cwd>/.claude/maestro-tasks/`. Each file is a self-contained, workflow-agnostic prompt that the `/maestro` skill can classify (Step 1) and execute end-to-end.

This skill composes two upstream behaviors into one continuous session:

1. **`/grilling`** — a relentless interview to sharpen the user's intent.
2. The **tracer-bullet vertical-slice decomposition** of `to-issues` — but instead of publishing to a GitHub issue tracker, it writes local prompt files.

Because everything runs in one shared context, each step naturally reuses the output of the one before it: grilling sharpens the plan, the plan drives the slice breakdown, the approved slices become files.

## Process

### 1. Grill the intent (skippable)

Run a `/grilling` session to interrogate the plan until you and the user share a clear picture of what they want to build.

**Skip grilling** only when the user signals the intent is already sharp — e.g. they say "skip grilling" / "already grilled", or pass a finished spec/PRD/design doc. In that case work from whatever is already in context, exactly as `to-issues` does.

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Slice titles and descriptions should use the project's domain vocabulary and respect any ADRs in the area you're touching. Look for prefactoring opportunities — "make the change easy, then make the easy change."

(Unlike `to-issues`, there is no issue tracker or triage-label vocabulary to gather — these tasks live as local files.)

### 3. Draft vertical slices

Break the plan into **tracer-bullet** slices. Each slice is a thin vertical cut through ALL integration layers end-to-end, NOT a horizontal slice of one layer.

<vertical-slice-rules>

- Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests)
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

### 5. Write the task files

Once approved, write one prompt file per slice into `<cwd>/.claude/maestro-tasks/`. Create the directory if it doesn't exist.

**Numbering — append, never overwrite:**

- Read the existing `NNN-*.md` files in `.claude/maestro-tasks/`. Find the highest existing number; new files continue from there. Never clear or overwrite existing files — the user may be mid-way through running an earlier queue.
- Within this batch, order the slices **topologically** (blockers get lower numbers) so that running the files in numeric order is always a safe execution order.
- Filenames: `NNN-kebab-slug.md`, zero-padded to 3 digits (`001-…`, `012-…`), the slug derived from the slice title.

**File contents — the hybrid prompt envelope.** Each file is a workflow-agnostic prompt: an imperative opener (so the orchestrator can classify it as a request) wrapping the issue-style body. **Do not name agents or workflows** — choosing the workflow is the orchestrator's job (`maestro.md` Step 1), not the prompt's.

<task-file-template>
# <slice title>

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

A concise description of this vertical slice — the end-to-end behavior, not a
layer-by-layer implementation plan. Use the project's domain vocabulary. Avoid
specific file paths or code snippets; they go stale fast. Exception: if a precise
artifact (state machine, reducer, schema, type shape) encodes a decision better
than prose, inline just the decision-rich part.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Blocked by

- `002-other-slice.md`   (reference sibling task files by name)

Or "None — can start immediately" if no blockers.
</task-file-template>

`Blocked by` references sibling task files by name. It is the **sole authored source of the dependency graph** — the next step parses it into the status tracker, and the `/maestro-tasks` view derives each task's blocked/ready state from it. Because numbering is topologically sorted, "run them in order" is always a valid path; `Blocked by` records the precise graph for anything non-linear. (The Maestro orchestrator still runs one workflow at a time and does not auto-chain these files.)

Never write task **state** (done/ready/blocked) into the markdown — state lives only in `status.json`, maintained by the tracker in the next step.

### 6. Sync the status tracker

After writing the files, refresh `<cwd>/.claude/maestro-tasks/status.json` so the new tasks (and their `Blocked by` edges) are picked up:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-task-status.cjs" sync
```

`sync` parses each file's `## Blocked by` section, adds entries for the new files, preserves any tasks already marked `done`, and recomputes every `ready`/`blocked`. It's idempotent and safe to re-run. (Uses the plugin-root script so it works even before `/maestro-install` has copied the runtime scripts into the project.)

### 7. Report

Tell the user how many task files were written, the numeric range (e.g. `003–007`), and that each is ready to paste into (or run from) a session where the `/maestro` skill is invoked.

## Notes

- These files are designed to be classified by the Maestro orchestrator (`.claude/skills/maestro/SKILL.md`). Keeping each prompt workflow-agnostic is what lets the orchestrator pick the right workflow per task and stay correct as `maestro.json` evolves.
- This skill never publishes to GitHub. If the user also wants tracked issues, that's a separate, explicit `/to-issues` invocation.
