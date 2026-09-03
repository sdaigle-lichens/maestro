# Workflows and rules

## The Workflows canvas (`/workflows`)

A React Flow diagram over your project's `maestro.json`. Each node is an agent step (e.g. an
implementation agent, a reviewer, a tester); edges are handoffs, including labeled condition edges
that route back to an earlier node instead of continuing the success path.

- On a project Maestro hasn't configured yet, the canvas shows the implementation chain it
  *detected* from the repo (which language/framework agent it thinks you need) along with the
  evidence for that guess, and chips to correct it if it's wrong.
- Editing the canvas — adding a node, moving one, relabeling an edge, promoting a skill from
  "referenced" to "loaded" for a step — edits the in-memory workflow slice. Nothing touches disk
  until you save.
- Saving does three things in order: merges your edit into `maestro.json` and writes it; re-renders
  the orchestrator skill's handoff table from the new graph; and applies any rule assignment
  changes (see below). The toast after a save reports exactly what changed.
- The workflow selector in the top bar lets a project have more than one named workflow and switch
  between them.

## Rules (`/rules`)

Rules are markdown files with instructions scoped to a directory — the project-local equivalent of
a `CLAUDE.md`, but assignable per-subtree rather than only at the root.

- Two selectors: rules the *project* already authors (in a flat `rules/` directory it publishes),
  and installable rules from the `vibe-rules` CLI, if it's available on your machine.
- A directory tree lets you assign a rule to the project root or to a specific subdirectory.
- Saving moves the assigned rule files into `.claude/rules/` under the directories you chose (or
  runs `vibe-rules load` for an installable one) and writes the assignment into `maestro.json`'s
  rules slice.

There is currently no *global* (machine-wide) rules tier — every rule view in Maestro, including
the Rules tab on the Tools dashboard, shows only what's local to the project you're looking at.
