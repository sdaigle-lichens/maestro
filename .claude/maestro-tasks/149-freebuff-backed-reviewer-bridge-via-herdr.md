# Freebuff-backed reviewer bridge via herdr

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Add a project-local subagent named freebuff-reviewer (model: haiku) whose only job is to relay a code review to the Freebuff CLI running in a herdr pane, and relay Freebuff's verdict back as the reviewer's normal HANDOFF, then rewire the workflow(s) the user picks so freebuff-reviewer takes the reviewer's place and its handoff routes (handoffs are injected by agent name, so the routes must be carried over). Freebuff has no non-interactive prompt flag and is not a herdr-recognised agent kind, so the bridge: checks HERDR_ENV=1 and fails clearly otherwise; writes a review brief under $TMPDIR (diff range, requirements and acceptance criteria from its channel input, and an instruction to write findings to a findings file and then create a done-sentinel file); splits a sibling pane without stealing focus; launches freebuff with --cwd on the repo; waits for Freebuff's ready-for-input marker (startup can be slow because Freebuff auto-updates on launch); types one short line pointing Freebuff at the brief and presses enter; waits for the done file in bounded waits (a single shell call is capped at ten minutes); reads the findings, maps them to the reviewer's pass/fail verdict and HANDOFF; closes the pane it created. The agent must never review code itself: restrict its tools and instructions to the brief, the findings file and herdr commands. On any failure (no herdr, Freebuff not logged in, ready marker never appears, timeout) it reports the cause instead of falling back to reviewing. Before building, confirm with the user which workflow(s) to rewire and the exact ready marker (the user discovers it by starting freebuff in a herdr pane), and check they have run freebuff login. Includes the subagent definition, the workflow config change, and re-rendering the orchestrator so its handoff table names the new agent.

## Acceptance criteria

- [ ] A freebuff-reviewer subagent exists in the project's own agents (not under plugins/), uses the haiku model, and its instructions forbid reviewing code itself
- [ ] Running it inside herdr opens a pane, starts Freebuff, submits the brief, waits for the done file, and closes the pane it opened
- [ ] It emits a HANDOFF in the reviewer's format, so the chosen workflow routes on pass and fail exactly as it did with reviewer
- [ ] Outside herdr, or when Freebuff never becomes ready or times out, it reports the cause and does not review the code itself
- [ ] The chosen workflow(s) in maestro.json use freebuff-reviewer in place of reviewer, and the rendered orchestrator's handoff table reflects it
- [ ] One end-to-end run on a small real diff produces Freebuff findings relayed back through the workflow

## Touched surfaces

- .claude/agents/freebuff-reviewer.md (new)
- .claude/maestro.json (chosen workflow(s))
- .claude/skills/maestro/SKILL.md (rendered HANDOFFS region; regenerated, not hand-edited)
- handoff detail files for the reviewer routes, if the workflow uses project-level ones

## Blocked by

None — can start immediately
