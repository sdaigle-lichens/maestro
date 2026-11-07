# Make the testing step re-verify after its last edit and name the tree it verified

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

A handoff-discipline fix from the acces-portail-email walking-skeleton post-mortems. This is a change to the testing step's handoff template, with tests, a rebuild of the generated plugin libs, a patch plugin version bump and the repo's runtime refresh.

The testing step reported the project's format, lint and type checks as passed from an earlier run, then added tests without running them again; the reviewer caught it. The testing step's handoff must require that the project's own static checks and the tests it reports are run after its last edit, and that the report names the tree it verified (the commit, or the working tree state). This must stay project-agnostic: the template says "the project's own format, lint and type checks" and names no tool, command or package manager.

Out of scope: a stop with background work still running being taken as the final report. Task 160 (stop flagging hand-off issues on an agent's interim stops) owns that.

## Acceptance criteria

- [ ] The testing step's handoff template requires the static checks and tests to be re-run after the last edit, and the report to name the tree verified
- [ ] The template names no specific tool, command or package manager
- [ ] The maestro plugin.json version gets a patch bump, the generated libs are rebuilt, pnpm refresh:runtime and the parity test pass (a sandboxed run hands the user ! pnpm refresh:runtime), and pnpm verify passes

## Touched surfaces

- apps/maestro/src/core/plugin-entries/maestro-handoff-defaults.ts (testing handoff template) and its generated lib
- plugins/maestro/scripts/lib/*.cjs (generated) and the .claude/scripts mirrors
- plugins/maestro/.claude-plugin/plugin.json (version, shared)
- parallel OK; merge order: the worktree ticket first, then this one, then the authoring ticket; rebase, take the next patch version, rebuild generated files instead of hand-merging

## Blocked by

None — can start immediately
