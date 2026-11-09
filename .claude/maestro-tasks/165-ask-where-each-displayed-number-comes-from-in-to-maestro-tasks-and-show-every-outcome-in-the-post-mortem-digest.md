# Ask where each displayed number comes from in to-maestro-tasks and show every outcome in the post-mortem digest

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Two authoring and retrospective fixes from the acces-portail-email walking-skeleton post-mortems. This is a change to the to-maestro-tasks skill and the post-mortem digest's code, with tests, a patch plugin version bump and the repo's runtime refresh if a mirrored script changes.

1. Name the data source of displayed numbers. A ticket asked for a count in the navigation bar without saying which API provides it; the worker computed it from loaded pages and needed a manager redirect. When a task shows a number or other derived value in a UI, to-maestro-tasks must ask, and the task must state, where it comes from: an existing API, a new one in this task, or a later task. Keep it general to any project and stack.

2. Every outcome in the post-mortem digest. The digest listed 9 success outcomes and left out the blocked and no-HANDOFF ones. It must list every recorded outcome (success, fail, blocked, a missing HANDOFF line and any other kind the log records), so the problems are the first thing a reader sees, not hidden.

## Acceptance criteria

- [ ] to-maestro-tasks asks for the source of every number or derived value a task displays in a UI, and the written task states it
- [ ] The wording stays project- and stack-agnostic
- [ ] The post-mortem digest lists every outcome kind the session log records, including blocked runs and a missing HANDOFF line on a final stop; an agent's interim stop (task 160's signal) is never counted as a missing HANDOFF; a test covers a session with all of them and with an interim stop
- [ ] The maestro plugin.json version gets a patch bump; if a mirrored script changed, pnpm refresh:runtime and the parity test pass (a sandboxed run hands the user ! pnpm refresh:runtime), and pnpm verify passes

## Touched surfaces

- plugins/maestro/skills/to-maestro-tasks/SKILL.md (and maestro-write-tasks.cjs only if the template gains a field)
- plugins/maestro/scripts/maestro-post-mortem.js / maestro-post-mortem-context.js and their .claude/scripts mirrors
- plugins/maestro/.claude-plugin/plugin.json (version, shared)
- parallel OK; merge order: last of the three, and after task 160 (whose interim-stop signal the digest must respect); rebase, take the next patch version, rebuild generated files instead of hand-merging
- plugins/maestro/skills/to-maestro-tasks/SKILL.md is also edited by task 157, which runs after this epic and builds on this task's version

## Direction (manager, 2026-11-09)

160 (merged) settles an unresolved interim stop as `missing` in session state and does not write
that settle to the log. The digest stays within this task: it reads an interim stop that is never
followed by a final stop of the same agent run as a missing HANDOFF, in line with the epic's
option 2 decision. This task does not change 160's merged code; a durable settle marker in the log
would be a separate follow-up.

## Blocked by

None — can start immediately
