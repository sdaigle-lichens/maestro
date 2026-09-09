# Prompt for maestro-post-mortem after a rough session, in Step 4

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Add short, always-on prose to the orchestrator template's Step 4 (`plugins/maestro/templates/maestro/SKILL.md`, inside the managed `Maestro:STEPS` region — static template text, not script-injected) instructing the orchestrator to ask the user, once, whether they'd like to run the `maestro-post-mortem` skill. Gate this on the session NOT having gone streamlined and clean — a major review fix was needed, a refactor was needed mid-task, or the task wasn't completed correctly on the first pass without heavy steering from the user. Keep the instruction to 2-4 sentences: state the trigger condition plainly, and explicitly say to skip the question entirely on a clean run — this must not become a prompt the user sees on every single task.

This is independent of the `use_maestro_tasks` setting and its gate script from the first task — it always renders, for every project, regardless of that setting's value. Sequenced after the first task purely to avoid two tasks editing Step 4's template text out of order; do not otherwise depend on or reference the task-routing setting.

## Acceptance criteria

- [x] Step 4 of the rendered orchestrator skill contains a short (2-4 sentence) instruction telling the model to ask the user about running maestro-post-mortem
- [x] The instruction is explicitly gated on the session not having gone cleanly (major review fix needed, refactor needed, or the task not completed correctly on the first pass without heavy user steering) and explicitly says not to ask on a clean run
- [x] The addition sits inside the managed Maestro:STEPS region so it reaches existing installs via /maestro-update, and does not disturb the existing mark-task-done instructions or the task-routing directive/gate line from the first task
- [x] Plugin version bumped (patch — behavior change to an existing template, no new skill/agent/command/hook event)

No divergences from the task page's plan.

## Blocked by

- `046-add-the-use-maestro-tasks-setting-and-the-step-4-gate-script.md`
