# Epic: containerized-workers

## Goal

Maestro workers spawned by maestro-manager run in per-project Docker containers with no login or permission friction, and talk to the manager without Remote Control, so the user only interacts with the manager (PC or phone).

## Scope

In: per-project worker image (plugins pinned to host versions, hook deps, pre-filled first-run config, no secrets), docker launcher (token from ~/.config/maestro/worker-token, read-only hook/git mounts, settings.local.json without hooks, sibling worktree mount), `worker_runtime` in maestro.json, inbox-watch + herdr pane-input messaging for containerized workers.
Out: cloud sessions, ECS, ports/HTTP/SSH messaging, Remote Control on workers, desktop-app UI for `worker_runtime`.

## Decisions

- Remote Control only on the manager (setup-token tokens can't use it; workers use them to skip login).
- Worker → manager: the existing epic inbox written by maestro-epic.cjs, watched by the manager; files never moved, ack/verdict state decides what is new.
- Manager → worker: `herdr pane run <pane>`; the herdr socket is never mounted into containers.
- Guardrails exemption by overlaying settings.local.json with its hooks removed, not by editing the guardrails hook (it belongs to another plugin).
- Host workers stay the default and unchanged.
- r001 (175) is held unacknowledged until worker 175 reports the non-interactive real-Docker checks (build, reuse and rebuild, no secrets in layers, read-only mounts, settings overlay, worktree mount and ownership, hooks run clean).
- The interactive checks (no prompts up to the first human review, plugin loading, worktree trust, TTY, the inbox-write prompt) are proven by spawning 176's worker in Docker mode (`worker_runtime: "docker"`) after 175 merges, and only when the user says to spawn it (not offered automatically). A prompt it hits becomes a fix on 176's ticket.
- r001 and r002 acknowledged: 175 is verified at 32a0a4b (`.env`-in-image fixed, image `maestro-worker-maestro:e329e81c1b31` removed). Checks for 176's Docker run on top of the interactive list: (a) plugins whose needed files are untracked or git-ignored (generated build output) are now missing from the image, so plugin loading must be checked for each plugin; (b) code-graph hooks ran with `--hook` and may not have loaded ts-morph, so check that a real Stop hook loads it.
- 175 merged at 17df9b7 and the user ran `pnpm refresh:runtime`. The manager verified the merged result (worker 175 had exited): `pnpm verify` green (173 files, 3331 tests; turbo replayed cached results for identical inputs) and the parity test green (44/44).
- 176's first Docker run stopped at its first implementation step: the image held only project-enabled plugins, so the user-scope `maestro@maestro` (local-directory marketplace at this repo) and its agents were missing. The user chose: release, add the image fix and a launcher refusal for missing plugins to 176's ticket, run 176 as a host worker (`worker_runtime` back to `"host"`), and prove the interactive container checks with 177's worker after 176 merges and the image is rebuilt (with the plugin refreshed to include the 0.15.8 test-agent fix).
- r003 (176) acknowledged: done at `1ce80fd` on `task-176`, `pnpm verify` green (173 files, 3349 tests). The new image `maestro-worker-maestro:96a3b32cbe0e` carries `maestro@maestro`, and the old image fails the probe. Left for 177's Docker run (direction added to 177): the inbox-write prompt, pane replies end to end, and the launcher refusal against a real image. Scribe note: stamps not run for task-queue, maestro-architecture and plugin-libs-parity.
- 176 merged at 50a69a2 (plus d6517ea, which commits `maestro.json`'s `worker_runtime: "host"` and runtimeVersion 0.15.9). Merged `pnpm verify` green (173 files, 3349 tests; turbo replayed it because the merged tree matched the verified branch tree, accepted). The manager's parity test on merged main is green (44/44).
- The user wants epics to run without them as much as possible: with the opt-in `manager_approval`, the manager approves containerized workers' review, commit and merge stops. The user agreed this list always escalates: a red or partial suite, a scope change or decision conflict, a push or any outward-facing or destructive git operation, a change to agents/skills/workflows/rules/settings, a security finding, a second redirect. Until 177 lands, the user still approves in each worker's tab.
- Post-mortem for r001's notes ran. The test agent refused its channel payload as a "report `.md` file" (1 run + 4 resumes). The fix, chosen by the user: `plugins/maestro/agents/test.md` now says the payload is required route output, not a report, and that a resume asking for it comes from the agent's own workflow (plugin 0.15.8, uncommitted). Check in 176's run: the test agent writes its payload with no `missing_payload`. The backend agent's `cd` + `sed -i` was left unfixed by the user's choice.

## Merge plan

| Order | Task | Base branch | Version bump | Shared surfaces with siblings |
|---|---|---|---|---|
| 1 | 175 docker container runtime | main | 175 bumps plugin.json minor | plugin.json, generated `maestro-epic.cjs`, `.claude/scripts` mirrors, `maestro-manager/SKILL.md`, `epics.ts` |
| 2 | 176 inbox + pane messaging | main after 175 merged | 176 bumps plugin.json patch | same as 175 (ordered by blockedBy, starts only once 175 is merged) |
| 3 | 177 manager approves on the user's behalf | main after 176 merged | 177 bumps plugin.json patch | plugin.json, generated libs, `epics.ts`, `human-review-gate.ts`, `worker-runtime.ts`, worker template, `maestro-manager/SKILL.md` (ordered by blockedBy after 176) |

After each merge the merger re-runs the full suite on the merged result, and the user runs `! pnpm refresh:runtime`.
