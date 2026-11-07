---
name: to-maestro-tasks
description: "Turn a plan or idea into a queue of ready-to-run Maestro task prompts saved under .claude/maestro-tasks/. Runs the project's configured to-maestro-tasks start skills to sharpen intent, sizes the work into as few tasks as it genuinely needs — often one — then writes a numbered, workflow-agnostic prompt file for each, for the Maestro orchestrator to classify and execute. When a design or a list of specs spans several epics, it first agrees the epic list, records each epic's dependencies and coverage, then expands the epics into tasks in dependency order. Use when the user wants to break work into Maestro tasks, queue up prompts for the /maestro skill, convert a plan/spec/idea into runnable task files, split a design or a set of specs into epics, or expand an existing epic into tasks."
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-step1-gates.cjs" *)
---

# To Maestro Tasks

Convert a plan, spec, or rough idea into **ready-to-run prompt files** under the **repository-root** `.claude/maestro-tasks/` (never `<cwd>/.claude/` or a sub-folder `.claude`; the writer resolves the root as the nearest ancestor with `.claude/maestro.json`, then the git root). Each file is a self-contained, workflow-agnostic prompt the `/maestro` skill classifies and executes end-to-end.

**Epics.** If the user names an epic, you run for a `maestro-manager`, the source is a design or list of specs spanning several epics, or the user asks to expand an existing epic, read [`references/epics.md`](references/epics.md) after Step 1 and follow it alongside the steps below. Its `<scripts>` is `${CLAUDE_PLUGIN_ROOT}/scripts`.

## Process

### 1. Start skills

If the text below is missing, empty, or reads `[shell command execution disabled by policy]`, this project has no start skills: go to Step 2.

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-step1-gates.cjs" --for to_maestro_tasks`

Whatever those skills produce (a clarified intent, a design brief) carries into the tasks below.

### 2. Size the work

Decide **how many tasks this needs — starting from one.** Each task file is a full orchestrator run: classification, the start skills, and a cold-spawned subagent per success-path step that re-derives the project context. Two tasks where one would do roughly doubles the tokens and adds a handoff that can lose intent.

**Default to a single task.** Split only when a boundary meets one of these:

- **Different workflows.** The orchestrator selects one workflow per run.
- **A hard wait in the middle** — an external dependency, a deploy, a human decision that must land before the rest is designable.
- **Parallelism you actually want** — two independent branches the user intends to run at once.
- **Too big for one context** to hold end-to-end.
- **A learning dependency** — the later part's design depends on *observing* the earlier part in use, not merely on its code existing.

**Not reasons to split:** layers or tiers (module, then CLI, then docs — the horizontal split in disguise); "tests/docs are their own concern"; a chain where each part only blocks the next; task count as a proxy for thoroughness. **A straight-line dependency graph is a signal to merge**: no parallelism is gained and each boundary costs a full run.

When it genuinely is more than one, each task is a **tracer bullet**: a thin vertical cut through ALL integration layers (e.g. schema, API, UI, tests), demoable or verifiable on its own. Prefactoring belongs at the start of the task that needs it, not in a task of its own unless it stands alone.

### 3. Quiz the user

For a single task, say so and show its title and acceptance criteria — don't manufacture a breakdown.

For more than one, present a numbered list with each task's **title**, **blocked by**, and **user stories covered** (if the source has them), and **name the split criterion each boundary meets**; a boundary you can't justify is one to merge. Ask whether any boundary isn't worth a separate run, whether the dependencies are right, and whether anything is too large for one run. Iterate until the user approves.

**Parallel-safety check (more than one task).** List each task's **touched surfaces**: likely files plus shared surfaces — version files, generated files (bundles, lockfiles, rendered output), shared docs, any new shared helper. For every pair not already ordered by `blockedBy` (directly or transitively) that overlaps, do exactly one of: add a `blockedBy` edge; merge the two; or record `parallel OK, merge order X then Y, Y rebases` in the later task's touched surfaces. **Version and generated files always count as overlap**, even on different lines. Name **one owner** for a helper two tasks need, and who bumps shared version files (one task, or "whoever merges bumps"). Show the user the overlaps and their resolutions.

### 4. Write the task files and sync the tracker

Once approved, prepare one object per task — **never write the markdown files or `status.json` by hand.** Order the array topologically (the script rejects a forward reference). **Do not name agents or workflows** in `whatToBuild`; choosing the workflow is the orchestrator's job.

**Make `whatToBuild` name every kind of change the criteria need** — the orchestrator picks the workflow from it, so a description that sounds like docs gets a docs-only run even when a criterion needs code.
- A criterion that reaches across the repo ("every reference renamed") needs the description to say whether **user-facing strings in source** (messages, help text, errors) are in scope; if so, say "including messages in source code" in the description itself.
- When mostly docs or skill files but also code, tests, version bumps or a build/regenerate step, list those in plain words too.
- A criterion only a later step can meet ("the ported tests pass") is fine; state it as the end state.
- When `whatToBuild` relies on existing code doing something ("the resume path then hands it back"), either check that code first or mark the claim **assumed, unverified** in the description, so the builder confirms it before designing around it.

```json
[
  {
    "title": "Add login form",
    "whatToBuild": "The end-to-end behavior in the project's domain vocabulary, not a layer-by-layer plan. No file paths or code snippets (they go stale) — except a precise artifact (state machine, schema, type shape) that encodes a decision better than prose.",
    "acceptanceCriteria": ["Criterion 1", "Criterion 2"],
    "touchedSurfaces": ["src/login-form.tsx", "package.json (version)"],
    "blockedBy": []
  },
  { "title": "Wire login to session store", "whatToBuild": "...", "acceptanceCriteria": ["..."], "touchedSurfaces": ["..."], "blockedBy": [0] }
]
```

(A single-task array is the common case.) **Every task carries `touchedSurfaces`**: the script writes it as a `## Touched surfaces` section that sibling tasks and a `maestro-manager` compare against — paths, generated and version files, shared docs, new shared helpers (with owner), any `parallel OK …` line.

`blockedBy` entries are **indices into this array** for tasks in this batch. For a task **already in the queue**, use its filename or number as a string (`["083"]`); the script refuses a name matching no task. Put queued-work dependencies here, not only in `whatToBuild`, so the tracker keeps the task blocked. Write the array to a scratch file and run (add `--epic <slug>` for an epic):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-write-tasks.cjs" <path-to-json>
```

### 5. Report

Say what was written — a single file, or the count and range (e.g. `003–007`) — ready to run from a session where `/maestro` is invoked. For an epic, end with the suggestion in `references/epics.md`; otherwise add none.

## Notes

- Keeping each prompt workflow-agnostic lets the orchestrator (`.claude/skills/maestro/SKILL.md`) pick the right workflow per task and stay correct as `maestro.json` evolves.
- This skill never publishes to GitHub; tracked issues are a separate, explicit `/to-issues` invocation.
