# Report r003: 176-containerized-workers-report-to-the-manager-through-the-epic-inbox-and-herdr-pane-input.md

- Task: 176-containerized-workers-report-to-the-manager-through-the-epic-inbox-and-herdr-pane-input.md
- Written: 2026-11-12T20:27:50.504Z
- From session: containerized-workers-176

# Report: task 176

**Outcome:** done. Commit `1ce80fd` on branch `task-176`. `pnpm verify` is green on it: lint, check, typecheck, and 173 test files / 3349 tests.

## Built
- Epic CLI: container wording for reports, notes and review requests (no SendMessage or ListAgents, a recorded manager is enough). Host wording is unchanged.
- New `watch <slug> [--for s] [--interval s]`: read-only, announces unacknowledged entries already waiting plus new ones, each once per run. It exits at 25 minutes by default and is capped at 29.
- `add-worker --pane` stores the pane id. `show`, `show --json` and the add-worker output list it.
- Manager replies by `herdr pane run <pane> "[manager message] ..."`. The marker is never the user's approval.
- Worker image carries every host-enabled plugin, including user-scope and local-directory marketplaces. The launcher probes the image and refuses one that lacks a plugin, naming the plugin and the fix.
- Manager skill, orchestrator template (rendered), concept skills, `plugin.json` 0.15.9, libs rebuilt.

## Findings
- **Unverified, left for task 177's Docker run:** the in-container inbox-write prompt. Task 175's checks ran shell commands only and never tested it. Nothing was changed for it.
- Real Docker (shell only): image `maestro-worker-maestro:96a3b32cbe0e` carries `maestro@maestro` with its agents and skills. The old image `1ba1aab29bc6` fails the probe, naming the missing plugins.
- The launcher refusal was tested with a docker stub, not against a real image.
- Not exercised: watch's default `--for` (25 min) and cap, pane replies and worker continuation (need a live pane), and prose assertions for the template and manager skill.
- `@frontend` made no change (no renderer shows epic workers).
- Scribe note: stamps were not run for task-queue, maestro-architecture and plugin-libs-parity. plugin-libs-parity was edited without a full read.

## Suggested ticket changes
- Task 177's Docker run should verify the inbox-write prompt inside the container, plus the pane reply path end to end.
