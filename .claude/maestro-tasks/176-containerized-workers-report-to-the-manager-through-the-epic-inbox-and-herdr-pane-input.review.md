# Manager review brief: task 176

## Goal
Containerized workers report to the manager through the epic inbox, and the manager replies through `herdr pane run`. The worker image also carries every host-enabled plugin.

## Deviations
- The inbox-write prompt inside the container was not changed. The task 175 report showed no prompt, so nothing was moved. If the manager sees a prompt, say so.
- `@frontend` made no change, because no renderer shows epic workers, so the pane id is not shown in the UI.
- No ticket-scope deviations otherwise.

## Decisions
- `watch <slug> [--for s] [--interval s]` is read-only. It announces unacknowledged reports and notes and unanswered review requests, including ones already waiting at start, each once per run. It exits 0 after 25 minutes by default, capped at 29.
- `add-worker --pane` stores the pane id (validated). It is shown in `show`, `show --json` and the add-worker output.
- In a container, the report, note and review-request output says no SendMessage or ListAgents is needed. A recorded manager is enough, and the reply arrives as typed input.
- Manager text sent through `herdr pane run` starts with `[manager message]`. The worker never counts it as the user's approval.
- The image is built with every host-enabled plugin, including user-scope ones. Local-directory marketplaces are retargeted into the image, and the image tag layout is bumped to 4.
- The launcher probes the image and refuses one that lacks a plugin. The message names the plugin and the rebuild command.

## Touches
- `apps/maestro/src/core/epics.ts` and `plugin-entries/maestro-epic.ts`
- `apps/maestro/src/core/worker-runtime.ts` and `plugin-entries/maestro-worker-runtime.ts`
- the worker side of `plugins/maestro/templates/maestro/SKILL.md` and the rendered orchestrator
- `plugins/maestro/skills/maestro-manager/SKILL.md`
- `plugins/maestro/.claude-plugin/plugin.json` (0.15.8 to 0.15.9)
- the regenerated libs and their `.claude/scripts` mirrors
- tests: `epics-cli`, `worker-runtime`, `worker-runtime-cli`, `parity`

## Sibling impact
- Task 177 (the manager approves containerized workers' stops) builds on the `[manager message]` marker and the pane id.
- Host workers print the same lines as before and keep the ListAgents fallback.

## Questions
- None.
