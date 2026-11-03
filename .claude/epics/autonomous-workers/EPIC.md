# Epic: autonomous-workers

## Goal

maestro-manager spawns its epic's worker sessions in herdr, and human-review stops show as blocked so the user sees which sessions need them

## Scope

In:
- 125: a `maestro-epic.cjs` command that lists ready, unclaimed tasks; a `maestro-manager` spawn step
  using herdr (cap 5, fallback prints `claude -n` commands); one herdr install guide referenced from
  maestro-install, maestro-update and maestro-manager.
- 126: the orchestrator's `human review` stop asks Approve / Request changes with `AskUserQuestion`,
  falling back to plain text.
- 127 (blocked by 125): maestro-install and maestro-update offer maestro-41's sandbox allow-list
  (dry run, user runs `! --apply`), switch to the unquoted `${CLAUDE_PLUGIN_ROOT}` install
  invocation, and add a default-No herdr socket opt-in that warns it is a sandbox escape. feat/sandbox-allow-list
  is merged (`2c95bae`, 0.12.9); 127 takes 0.12.10.
- 128 (r002 follow-up): tests for `ready`: an apostrophe in a task filename through a real shell,
  and claim liveness at the idle-cap edges.
- 129 (r004 follow-up): maestro-update offers the allow-list before its installer; the herdr opt-in
  is not re-asked when herdr entries exist, including hand-written `~` ones; tests for a symlinked
  herdr binary and an unparseable settings file.

Out:
- The setup-claude-guardrails allow-rule suggestions: ai-dev-tools task 001, tracked in that repo.
- Agent teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`): rejected, see Decisions.

## Decisions

- Workers are real, named Claude sessions spawned in herdr, not agent-team teammates. Teammates share
  one task list (clashes with the orchestrator's per-step `TaskCreate`), don't survive `/resume`, and
  route every permission prompt to the lead.
- herdr is optional and checked with `command -v herdr` in the spawn step, not by a hook.
- The manager drives herdr only when it runs inside a herdr pane (`HERDR_ENV=1`, server status
  `running`), opening one tab per worker (not split panes, too small for reviews). Outside herdr
  it prints the launch commands (r002).
- The user watches herdr for sessions that need them. Its `blocked` state comes from screen
  detection; `AskUserQuestion`'s picker is recognised as `blocked` (herdr's claude manifest,
  `live_blocked_form`), which is why 126 exists. A plain-text review stop shows as `idle`/`done`.
- The manager never approves for a worker: each worker's permission prompts and reviews stay in its
  own pane.
- herdr installs (binary, `herdr integration install claude`) are run by the user with `!`; they
  change things outside the project.
- herdr is never in maestro-41's generated sandbox allow-list (`maestro-sandbox-allow.cjs`): its
  socket in allowWrite, or an exclusion for `herdr pane run`, lets any sandboxed command run anything
  unsandboxed. The manual socket entry in `references/herdr.md` stays the user's explicit opt-in.
- The plugin version gets a patch bump for both tasks (no new skill, agent, command or hook event).
  Both bumped 0.12.6 → 0.12.7 in parallel (r001); whichever merges second re-bumps to 0.12.8, in
  plugin.json and `.claude/maestro.json` runtimeVersion.
- r002's post-mortem was skipped: four of its five notes were fixed in 125/127. The fifth
  (uncommitted work from outside the queue leaking into a worker's commit) is handled by committing
  before starting the next worker; no ticket.
