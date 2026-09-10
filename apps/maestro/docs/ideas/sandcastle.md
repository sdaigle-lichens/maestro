# Idea: run Maestro tasks in parallel with Sandcastle, and watch them from the app

[Sandcastle](https://github.com/ai-hero-dev/sandcastle) (`@ai-hero/sandcastle`) is a TypeScript
library for running AI coding agents in isolated sandboxes — Docker, Podman, or Vercel — each on its
own git branch, with the commits merged back afterwards. This idea uses it to run several Maestro
tasks at once, one sandbox per task, and turns the app's session log into a multi-tab view so all of
them can be monitored from one screen.

Unlike the other ideas recorded here, this one is a **recommendation to build**, not a trade-off
that was declined. What follows is the design as deliberated, in the order it would be implemented.

## Why it came up

The task queue under `.claude/maestro-tasks/` already knows which tasks can run at the same time —
`## Blocked by` declares the dependencies and `maestro-task-status.cjs sync` prints the `ready` set.
But they are still run one at a time, in one session. Sandcastle's own `.sandcastle/run.ts` is
already the shape this wants: **plan → N parallel sandboxes → merge agent**, with GitHub issues
sitting exactly where Maestro tasks would go.

## The two halves compose at different levels

This is the load-bearing distinction, and getting it backwards would produce a much worse design.

| | Scope | Unit of work |
| --- | --- | --- |
| **Sandcastle** | Across sessions, one branch each | One *ready* task file → one sandbox |
| **The `maestro` skill** | Inside one session | That task's workflow: implementation → test → reviewer → scribe |

Sandcastle parallelizes **tasks**; Maestro sequences **steps**. Sandcastle must not replace the
subagent graph — each sandbox's prompt is, in essence, *"run `/maestro` on
`.claude/maestro-tasks/{{TASK_FILE}}`"*, and the orchestrator inside that sandbox behaves exactly as
it does today.

## Why the runtime already travels

Maestro's install is **project-local by design**, and this repo commits the whole of it:
`.claude/maestro.json`, `.claude/scripts/` (including `lib/`), the hook registrations in
`.claude/settings.json`, the rendered orchestrator at `.claude/skills/maestro/SKILL.md`, the
materialized `.claude/handoffs/` and `.claude/reports/`, and the task queue itself.

A git worktree therefore carries a working orchestrator with no setup step. This is the single fact
that makes the whole idea cheap, and it is a consequence of the project-local install decision
documented in `.claude/skills/installing-maestro/` — not a coincidence.

What does *not* travel, correctly: `.claude/maestro_session.json`,
`.claude/maestro_session.log.jsonl` and `.claude/channels/` are gitignored ephemeral state. Each
sandbox mints its own.

## Plugins: only `maestro`, and installed from the branch

The subagents (`maestro:backend`, `:frontend`, `:mobile`, `:infra`, `:test`, `:reviewer`, `:scribe`,
`:refactor`) come from the **plugin**, not the project install — there is no `.claude/agents/` in the
repo. A sandbox with a bare Claude Code install has the orchestrator but nothing to dispatch to, and
the first `Task` call fails. So the plugin has to be present.

Only that one. Every other plugin enabled on the host is developer tooling for the host, and one of
them (`bxl-devops`) can deploy to live AWS instances. Excluding it is a **safety boundary, not a size
optimization** — an unattended agent iterating in a loop should not have a deploy skill in reach. The
entire plugin cache is under 10 MB, so size never enters the decision.

Install it from the worktree rather than mounting the host's cache:

```ts
hooks: {
  sandbox: {
    onSandboxReady: [
      { command: "claude plugin marketplace add ." },
      { command: "claude plugin install maestro@maestro" },
    ],
  },
}
```

This repository *is* the marketplace, so this installs the plugin as it exists **on the branch under
test**. A task that changes `plugins/maestro/` is then validated against its own change, rather than
against whatever version the host happens to have cached — which is the whole point of the version
discipline in `.claude/skills/updating-maestro/`.

Two consequences:

- **A mounted cache would not be enough anyway.** `enabledPlugins` lives in the host's
  `~/.claude/settings.json`, which the container's `agent` user does not have; a mounted-but-
  unenabled plugin is invisible. `claude plugin install` writes both.
- **A read-write mount leaks.** `autoUpdate` inside a container would write to the host's plugin
  cache, from a sandbox whose entire purpose is isolation.

The trade-off to accept knowingly: installing the branch's own plugin is a foot-gun. A task that
breaks a hook breaks the agent running it, mid-run, and the failure presents as Sandcastle flaking
rather than as a bug in the change. For a task that does not touch `plugins/maestro/`, a pinned
read-only mount of a single version directory is steadier. Deciding per task is reasonable; defaulting
to install-from-worktree is not.

## The three frictions

**`status.json` is tracked and every sandbox writes it.** N branches each marking their own task done
means a conflict in `.claude/maestro-tasks/status.json` on *every* merge. The fix is ownership: keep
`maestro-task-status.cjs done` out of the sandbox prompts entirely and have the host harness mark
tasks done after the merge lands. The sandbox produces commits; the host owns the queue.

**pnpm workspaces do not survive `copyToWorktree: ["node_modules"]`.** The example in Sandcastle's
README works because it is an npm tree. This monorepo's `node_modules` is a symlink farm pointing
back at the original store path. Mount the pnpm store and run a real `pnpm install` in
`onSandboxReady` instead.

**Blocked chains do not parallelize.** A strictly serial chain is one lane no matter how many
sandboxes are available. The payoff is proportional to how wide the `ready` set is, so this is worth
starting when there is a broad batch of independent tasks, not a dependency chain.

## The app half: a multi-tab session log

For the **Docker and Podman providers the sandbox is a bind-mounted git worktree on the host**. Each
parallel task therefore writes its own `.claude/maestro_session.log.jsonl` to a distinct host path —
the exact file the app already tails. No log shipping, no container introspection, and no Sandcastle
dependency in the app at all.

It also means tailing the *right* stream. Sandcastle's `.sandcastle/logs/*.log` is raw agent stdout;
Maestro's JSONL is the structured dispatch/handoff/tool-call record that `buildInstances()` already
turns into agent cards. Each tab gets the real session view rather than scrollback.

### What changes

| Layer | State today | Change |
| --- | --- | --- |
| `src/core/session-log.ts` | `tailSessionLog(projectRoot, …)` already takes a path | none |
| `src/main/ipc.ts` | One tail per window, keyed by `webContents.id` | Key by `(window, tabId)` |
| `src/renderer/src/utils/session-log-context.tsx` | App-wide provider, mounted once in `__root.tsx` | One per tab |

The core is already multi-target; the singleton assumption lives entirely in the IPC layer and the
provider, and both say so in their own comments. `ipc.ts` calls its single-owner design deliberate and
names refcounting as *"the alternative; with a single owner it would be unexercised code"*. This is
the change that exercises it.

Two specific traps in that layer:

- **`retargetTails()` must not touch sandbox tabs.** It re-points every subscriber at `currentRoot()`
  on a project switch. A worktree tab is not following the open project — if it gets retargeted,
  switching projects silently re-points every parallel tab at the main repo, and they keep looking
  alive while showing the wrong run.
- **Worktree paths are not valid viewing roots.** `resolveViewingRoot` honours a renderer-named root
  only when it is the open project or one from the recent list, and degrades silently otherwise — so
  a tab would quietly show the main repo's log. Worktrees of the open project need to become a
  recognised class of viewing root. That is a design decision to make deliberately, not a check to
  route around.

### Watcher before runner

Two products are possible here and only the first should be built initially.

- **Watcher** — the app runs `git worktree list` and offers a tab for each worktree that has a session
  log. It knows nothing about Sandcastle. This is the IPC change plus a tab bar, it is testable
  without Docker, and it is useful for plain `git worktree` work even if a sandbox is never run.
- **Runner** — the app launches Sandcastle, owns the lifecycle, and shows per-task status and the
  merge phase. This pulls Docker, Node and the orchestration itself into the Electron main process,
  and gives the app opinions about branch strategy and merge conflicts.

Build the watcher. It carries most of the value and does not commit the app to Sandcastle being the
only way tasks ever run in parallel.

## Implementation order

1. **A `.sandcastle/` harness in this repo.** `run.ts` reads the `ready` set from
   `maestro-task-status.cjs sync`, fans out one `createSandbox()` per ready task with
   `branchStrategy: { type: "branch", branch: "maestro/<task-number>" }`, and runs a prompt that
   invokes `/maestro` on that task file. A Dockerfile with Node, pnpm and the Claude Code CLI; the
   plugin installed from the worktree in `onSandboxReady`.
2. **Host-side queue ownership.** The harness marks tasks done after merge; the sandbox prompts never
   call `maestro-task-status.cjs done`.
3. **The merge phase.** Reuse Sandcastle's merge-agent pattern. With `status.json` writes removed from
   the sandboxes, conflicts should be genuine code conflicts only.
4. **The watcher in the app.** Multi-tab session log, per the table above.
5. **A concept skill, last.** Once the harness runs, document it — in the **root** `.claude/skills/`,
   since it describes `plugins/maestro/` plus a repo harness and has no app to belong to. Writing it
   before the harness exists would be documenting a guess.

## Caveats worth carrying forward

- **This is a Docker/Podman property.** The Vercel provider is isolated — no bind mount, so no host
  file to tail, and the log would have to be shipped out. Anything the app assumes about local
  worktree paths should be written knowing that.
- **A run must finish its workflow inside one sandbox.** `.claude/channels/` is gitignored, so an
  in-flight handoff payload dies with the container. That is correct — the channel is per-session —
  but it rules out resuming a partially-completed workflow in a second sandbox.
- **The queue has to be wide for this to pay.** With one or two ready tasks, a terminal session is
  simpler and faster than a container fleet.
