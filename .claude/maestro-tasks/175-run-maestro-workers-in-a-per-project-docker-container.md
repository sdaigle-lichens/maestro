# Run Maestro workers in a per-project Docker container

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Give Maestro a containerized worker runtime so a maestro-manager can spawn an epic's /maestro worker sessions inside Docker, with no login step, no first-run screens and no sandbox or guardrail permission prompts, leaving only the worker's genuine human-review stops.

This needs code (a new plugin script built from a new TypeScript plugin-entry source, plus changes to the epic spawn list), tests, skill and reference doc updates, a plugin version bump, and regenerating the plugin libs.

Behaviour:

- **Per-project image.** A new plugin command builds or reuses an image for the current project. Its tag is derived from its inputs: the plugins the project uses, pinned to the versions installed on the host; the dependencies the project's hooks and the plugins' hooks need at runtime (the code-graph Stop hook failed in a probe because ts-morph was missing); and the Claude Code version. A plugin version bump therefore produces a rebuild. The image pre-fills the container user's ~/.claude.json (onboarding completed, theme set, trust accepted for the project's real host path) so no first-run screen appears. No secret is ever baked into an image. The container user's uid must match the host user so files written in the repo stay owned by them.
- **Launcher.** A run command starts one worker: `docker run -it --rm` with the repo bind-mounted at its real host path and these paths mounted read-only over it: .claude/settings.json, .claude/settings.local.json, .claude/scripts, .claude/hooks, .git/hooks, .git/config. It authenticates with CLAUDE_CODE_OAUTH_TOKEN read at launch from ~/.config/maestro/worker-token (a `claude setup-token` token: inference-only, no Remote Control, which is fine for workers). It never prints, logs or bakes the token, and it stops with a clear setup message when the file is missing. It sets an environment variable marking the session as a containerized worker (for example MAESTRO_WORKER_RUNTIME=docker) for the messaging task that follows. It starts `claude -n <worker name> [--model <worker_model>] '/maestro <task file>'` exactly as the host launch does. The herdr socket is never mounted into the container: pane input from the manager must stay the only control channel.
- **Guardrail exemption.** The personal guardrails PreToolUse hook is registered in .claude/settings.local.json and comes from another plugin. In a probe it prompted inside the container on a harmless command. The launcher mounts a copy of settings.local.json with its hooks section removed (everything else kept) in place of the real file. The guardrails hook file itself is not edited.
- **Worktrees.** Maestro creates a task's worktree as a sibling of the main checkout (<repo>-task-N), outside the repo bind mount. The launcher must make the task's worktree path exist and be mounted at the same path, so a worktree created inside the container exists on the host too, and the reverse.
- **Spawn-list switch.** A new optional .claude/maestro.json setting, worker_runtime ("host" by default, or "docker"), makes the epic `ready` command print the docker launch command in place of the plain `claude -n ...` command, the same way worker_model already changes it. maestro-manager's Spawning workers steps (herdr tab create, herdr pane run with the printed command, add-worker) then work unchanged. Unset or "host", the output is identical to today's. Editing this setting in the desktop app is out of scope.
- **Docs.** maestro-manager's skill and the maestro-install herdr reference say how to enable the docker runtime: build the image, create the token file with mode 600 (the user runs `claude setup-token` themselves), and set worker_runtime. Note that Remote Control stays on the manager only.
- **Verify inside a real container** (assumed, unverified): whether `maestro-epic.cjs` writing a report or review request into .claude/epics/<slug>/inbox/ prompts there. A probe showed that Claude Code prompts for writes under .claude/ even in auto mode, but that probe wrote the file directly, not through the CLI. Record the result in the task's report: the follow-up messaging task depends on it.

Prior art for the probe: /tmp/claude-1000/worker-probe/Dockerfile and launch.sh (may be gone; their content is restated above). Sandcastle (a sibling repo) is a reference for mount layout only; don't depend on it.

## Acceptance criteria

- [ ] The image command builds the project's image with each plugin the project uses pinned to the host's installed version and the hooks' runtime dependencies installed; running it again with unchanged inputs reuses the image, and a changed plugin version rebuilds it
- [ ] No token, credential or secret is present in any image layer
- [ ] With worker_runtime set to "docker", `maestro-epic.cjs ready <slug>` prints the docker launch command for each [spawn] task; unset or "host", its output is byte-identical to before
- [ ] A worker launched through the docker command reaches its first human-review stop with no login, onboarding, trust, guardrails or .claude/settings permission prompt
- [ ] Inside the container the read-only paths cannot be written, the guardrails hook does not run, and every other project and plugin hook runs without error (the code-graph Stop hook included)
- [ ] A worktree the worker creates is reachable at the same path on the host, and files it writes are owned by the host user
- [ ] A missing token file makes the launcher stop with a setup message and never start the container
- [ ] The task's report states whether a maestro-epic.cjs inbox write prompted inside the container
- [ ] Unit tests cover the launch command for both runtimes, the mount list, the settings.local.json hooks filter and the image-tag inputs; the full suite is green
- [ ] plugins/maestro/.claude-plugin/plugin.json version gets a minor bump, and the generated libs are rebuilt from their TypeScript sources

## Touched surfaces

- apps/maestro/src/core/plugin-entries/ (new worker-runtime entry) and the generated plugins/maestro/scripts/lib/*.cjs for it
- plugins/maestro/scripts/ (new script wrapper)
- apps/maestro/src/core/epics.ts (launchCommandFor, readyTasks) and generated plugins/maestro/scripts/lib/maestro-epic.cjs
- apps/maestro/src/core/types.ts (maestro.json worker_runtime)
- apps/maestro/src/core/install.ts (runtimeAssets: new script mirrored to .claude/scripts)
- plugins/maestro/skills/maestro-manager/SKILL.md (Spawning workers)
- plugins/maestro/skills/maestro-install/references/herdr.md (or a new docker reference beside it)
- plugins/maestro/.claude-plugin/plugin.json (version, minor)
- .claude/scripts mirrors (user runs `pnpm refresh:runtime`)

## Blocked by

None — can start immediately

## Manager direction

Added at manager review m001 (round 1, on-track):

- **Version bump: patch, not minor.** The ticket's "minor" was the manager's mistake. `.claude/rules/plugin-publishing.md` bumps minor only when a skill, agent, command or hook event is added, and a new script is none of those, so 0.15.6 becomes 0.15.7. This overrides the "minor" in the acceptance criteria and touched surfaces.
- **No prompt in the worker's real working directory.** "No trust prompt" covers the task's `<repo>-task-N` worktree path too, not just the main checkout. And plugins must load in the container without an interactive step. Baking non-secret marketplace metadata into the image is in scope; tokens and credentials are not.
- **Settle the guesses with the real-container run.** Disabling Claude Code's sandbox inside the container fits the epic (the container is the isolation boundary). But it, plugin loading, worktree trust and the inbox-write result all count as done only once a real container run of a worker shows them. Report each result.
