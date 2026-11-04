# Epic: freebuff-reviewer

## Goal

Let a Haiku bridge subagent hand code review to Freebuff through herdr, in place of the reviewer subagent, without changing workflow routing

## Scope

Depends on epics: none.
Covers: a project-local `freebuff-reviewer` subagent (model: haiku) that only relays a review to
Freebuff and relays its verdict back, and swapping it in for `reviewer` in the workflow(s) the user
picks. Out of scope: publishing it in the maestro plugin, and supporting other external agents.
Owns: nothing shared.
Expansion: now — one task, parked until the user returns to it.

## Decisions

- Freebuff has no non-interactive prompt flag (`--continue`, `--cwd`, `--trust-agents`; commands
  `login`, `doctor`) and is not a herdr agent kind, so the bridge drives a plain herdr pane:
  `pane run` to launch, `pane wait-output` on a ready marker, `pane send-text` + `send-keys enter`
  for a one-line prompt pointing at a brief file, then polls for a done-sentinel file.
- The real instructions live in a brief file under `$TMPDIR`; Freebuff writes findings to a file,
  then a done file. The bridge emits the reviewer's normal HANDOFF so routing is unchanged.
- Haiku never reviews code itself: its tools and instructions are limited to the brief, the
  findings file and herdr commands.

## Prerequisites (user, before running the task)

- `! freebuff login` once.
- Start `freebuff` in a herdr pane by hand and note the exact text it shows when ready for input.
- Decide on `--trust-agents` (trusted repos only).
- Decide which workflow(s) swap `reviewer` for `freebuff-reviewer`.
- Accept that the free tier sends code to Freebuff's servers.
