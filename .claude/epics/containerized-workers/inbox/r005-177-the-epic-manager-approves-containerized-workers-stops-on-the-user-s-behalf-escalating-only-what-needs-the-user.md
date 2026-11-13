# Report r005: 177-the-epic-manager-approves-containerized-workers-stops-on-the-user-s-behalf-escalating-only-what-needs-the-user.md

- Task: 177-the-epic-manager-approves-containerized-workers-stops-on-the-user-s-behalf-escalating-only-what-needs-the-user.md
- Written: 2026-11-13T01:09:53.211Z
- From session: containerized-workers-177

# Task 177 follow-up: errors and failures met while running Maestro in the container

Task 177 landed: work commits 8a8d6b7 and 5073d44, merged into main as f00bb7d by the manager. This is a list of every call or step that errored, was refused, or failed in this session, with the cause, so the manager can judge what the container image and runtime need. "Mine" marks an error that was my own mistake.

## Tooling missing in the container
| What failed | Cause | Effect |
| --- | --- | --- |
| `pnpm` not on PATH (orchestrator, backend and test agents all hit it) | image has no pnpm | `pnpm verify`, `pnpm refresh:runtime`, `pnpm --filter ...` could not be run by any agent. Agents ran vitest, tsc, eslint, prettier by absolute path; backend ran `build-plugin-libs.mjs` with node directly. The user had to run `pnpm refresh:runtime` and `pnpm verify` on their host, so the "no prompts / container-only" goal did not hold for verification. |
| python3 missing | image has no python3 | 36 SessionEnd shell-twin tests fail (per-session-state 13, session-end-resumable-159 21, plan-reviewer-157 1, run-metrics 1). `maestro-session-cleanup.sh` parses its payload with python3, then silently removes nothing and exits 0. The silent exit 0 is worth a separate look. |
| claude CLI missing | image has no `claude` | claude.test (4) and create-preview.test (2) fail. |
| git identity differs | container identity is not "Ada" | scaffold.test (1) fails. |
| Playwright chromium missing | image has no browser | the vitest `browser` project fails. |

The manager already has the four gaps (pnpm, python3, claude CLI, git identity); chromium is the fifth.

## Container environment side effects
- `MAESTRO_WORKER_RUNTIME=docker` is set in the container, which flips the host-wording assertions in epics-cli.test and manager-review-protocol.test. Backend and test had to run them with the variable unset (`env -u`). Those tests should pin it themselves.
- The sandbox cannot write the `.claude/scripts/` mirrors or re-render STEPS and HANDOFFS, so `refresh:runtime` is always a user action. In a container worker the user must run it on the host, and the container sees the result only through the shared checkout. The user told me they ran it "but not in the docker container".

## Maestro scripts and hooks that refused or flagged
- `handoff-issues` reported "NO PAYLOAD" for the first test agent's FAIL handoff, although the file existed. The test agent wrote `.claude/channels/task-177/backend/test.1.md` without a run_id stamp because it could not find the run id. The agent should be able to read its run id; the false flag nearly caused a needless resume.
- `maestro-task-status.cjs done` refused with "mark-task-done still unfinished". The template says to run `done` at that node, but `done` itself refuses until `plan-step "mark-task-done" done` is recorded. The template should say to record the plan step first.
- `review-verdict` answered "already recorded" (the verdict had been written when the manager's reply arrived). Harmless, but the template implies it is the step that records it.
- `git rebase main` refused: "unstaged changes". The tree held the pre-existing `.claude/maestro.json` and `.claude/epics/.../state.json` edits. Because `main` was already an ancestor I skipped the rebase, but `land-the-task` assumes a clean tree.
- `maestro-task-status.cjs switch-back` refused for the same `.claude/maestro.json` change. It was the epic's own pre-existing edit (`worker_runtime`), not the task's, so a container worker has no safe way to clear it without the user.
- `pnpm verify` (user run) failed at `maestro#check`: prettier on the two new test files. No agent could run `pnpm`, and the test agent treated prettier as outside its gate, so nobody formatted new files. Workers without pnpm should call `apps/maestro/node_modules/.bin/prettier --check` on files they add.

## Guardrail hits
- The first test agent issued one command with a `cd`; the guardrail denied it and it reran without. Not a defect, but the agents' dispatch prompts did not repeat the no-`cd` rule.
- Mine: I called `node_modules/.bin/vitest` from the repo root; it lives at `apps/maestro/node_modules/.bin/vitest` (exit 127). Nothing to fix in Maestro.

## Not seen
- No permission prompt appeared for the epic CLI's inbox writes (`review-request`, `review-verdict`, `report`) in this session. I cannot see the host's herdr pane, so this is "no prompt reached me", not proof there were none.
- The `design-studio` MCP server failed to connect (ECONNREFUSED) at session start. Unrelated to task 177 but visible in every container session.
- Repeated "agent finished" notifications arrived for the same finished agent several times. Noise, not an error.

## Suggested image and runtime changes
1. Add pnpm (and node >= the version `node:sqlite` needs) to the image so workers can run `pnpm verify` themselves.
2. Add python3, the claude CLI and a git identity matching the tests (or make those tests env-independent).
3. Pin `MAESTRO_WORKER_RUNTIME` inside the affected tests.
4. Let a worker read its run id so channel payloads carry the stamp.
5. Fix the `done` ordering in the orchestrator template; teach `land-the-task` to handle pre-existing unrelated tracked edits.
6. Decide how a container worker runs `refresh:runtime` (it cannot write the mirrors).
