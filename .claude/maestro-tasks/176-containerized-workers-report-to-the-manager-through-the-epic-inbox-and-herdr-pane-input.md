# Containerized workers report to the manager through the epic inbox and herdr pane input

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Containerized workers (started by the docker runtime the previous task added, which marks them with an environment variable) can't see the manager through ListAgents or SendMessage: their home is private and their token can't use Remote Control. Make the manager-worker conversation work for them with files one way and herdr pane input the other way, with no ports and no Remote Control on workers.

This needs code in the epic CLI and the plugin-entry sources it is generated from, the worker-side orchestrator template and the manager skill, tests, a plugin version bump, regenerating the libs and re-rendering the orchestrator.

Behaviour:

- **Worker to manager.** Workers already write done reports and manager review requests into the epic's inbox through maestro-epic.cjs, then send the manager one SendMessage line. In a containerized worker, the commands that print that SendMessage line say instead that no message is needed because the manager watches the inbox. The manager review stop no longer falls back to a human review just because the manager isn't live in ListAgents: a recorded manager is enough for a containerized worker. The worker then waits for the reply as user input in its own session. If the previous task's report says the CLI's inbox write prompts inside the container, move only what is needed so that it doesn't (the inbox must stay readable by the existing ack and verdict logic).
- **Manager watching.** A new epic command, meant to run under Monitor, prints one line per inbox report, note or review request that is not yet acknowledged or answered, including the ones already waiting when it starts. It reuses the existing ack and verdict state, so files are never moved and nothing is announced twice in one run. It exits after a bounded time below Monitor's 30-minute limit, so the manager re-arms it. Its lines read like today's SendMessage pointers, and the manager handles them through its existing loop.
- **Manager to worker.** add-worker records the worker's herdr pane id, and show lists it. The manager sends a containerized worker its reply, verdict or direction note with `herdr pane run <pane> "<text>"`, which arrives as user input. The text stays one short line pointing at a file when the content is long. The herdr socket is never mounted into containers.
- **Unchanged.** Host workers keep ListAgents and SendMessage exactly as today. A manager message is still never the user's approval: the human-review gate and approval rules hold for containerized workers too. The Remote Control manager stays the user's single point of contact, from the PC or a phone.

Update maestro-manager's skill (spawning: record the pane; the loop: arm, re-arm and react to the watcher; replying by pane) and the worker side of the Maestro orchestrator template.

## Acceptance criteria

- [ ] A containerized worker's done report and its manager review request reach the manager through the watch command, with no SendMessage or ListAgents call
- [ ] The manager's ack reply, review verdict and direction note reach the worker as input in its herdr pane, and the worker continues its success path from them
- [ ] Entries already in the inbox when the watcher starts are announced; after a manager restart or watcher expiry, nothing unacknowledged is lost and nothing acknowledged is announced again
- [ ] Host (non-container) workers behave exactly as before: same printed lines, same ListAgents-based fallback
- [ ] A manager message is never treated as the user's approval in a containerized worker; human-review stops still prompt in the worker's pane
- [ ] Text the manager sends through `herdr pane run` arrives looking like typed user input, so it carries a marker identifying it as a manager message, and the worker never counts marked text as the user's approval (a later task makes approval possible only through a read-only approval record)
- [ ] Tests cover the watch output against inbox and ack state, the pane id round-trip through add-worker and show, and the container versus host wording of the report and review-request output; the full suite is green
- [ ] The worker image carries every plugin the worker session needs, not only the ones the project's settings enable: plugins the user enabled at user scope too (on this machine `maestro@maestro`, which supplies the workflow's agents and start skills), including plugins whose marketplace is a local directory (this repo is one, so its plugin must load inside the container). Inside the container the agents and skills of each such plugin are available
- [ ] The docker launcher refuses to start a worker whose image is missing a plugin the host session has enabled, with a message naming the plugin and the fix, instead of a worker that stops mid-run on a missing agent
- [ ] plugins/maestro/.claude-plugin/plugin.json version gets a patch bump, the generated libs are rebuilt, and the orchestrator's STEPS and HANDOFFS are re-rendered

## Manager direction

- The first Docker run of this task (worker image `maestro-worker-maestro:1ba1aab29bc6`) stopped at the first implementation step: the image had only the `code-graph` and `claude-plugins-official` marketplaces and the `code-graph` plugin cache, so `@backend`, `@reviewer` and `/confidence-check` (all from `maestro@maestro`, enabled at user scope from the local-directory marketplace at this repo) were missing. The image fix is part of this task (criteria above); it touches the previous task's image builder (`apps/maestro/src/core/worker-runtime.ts` and its plugin entry).
- This task runs as a host worker (`worker_runtime: "host"`) because a containerized worker can't build it without those agents. Prove the image fix with real-Docker checks that run only shell commands in a container (as the previous task did): the maestro plugin's agents and skills are present in the image, and the launcher's refusal fires for a missing plugin. The full interactive container run is proven by the next task's worker.
- (m002, on-track) The inbox-write prompt was never tested: the previous task's checks ran shell commands only and listed it as still open. Leaving it unchanged is right for this task, but say in the report that it is unverified and left for the next task's Docker run, not that it showed no prompt.

## Touched surfaces

- apps/maestro/src/core/worker-runtime.ts and plugin-entries/maestro-worker-runtime.ts, plus plugins/maestro/scripts/maestro-worker-runtime.cjs and its .claude/scripts mirror (image fix)

- apps/maestro/src/core/epics.ts and plugin-entries/maestro-epic.ts, plus generated plugins/maestro/scripts/lib/maestro-epic.cjs
- apps/maestro/src/core/human-review-gate.ts (if the manager-review path changes)
- plugins/maestro/templates/maestro/SKILL.md (worker side), and the rendered .claude/skills/maestro/SKILL.md
- plugins/maestro/skills/maestro-manager/SKILL.md
- plugins/maestro/.claude-plugin/plugin.json (version, patch)
- .claude/scripts mirrors (user runs `pnpm refresh:runtime`)

## Blocked by

- `175-run-maestro-workers-in-a-per-project-docker-container.md`
