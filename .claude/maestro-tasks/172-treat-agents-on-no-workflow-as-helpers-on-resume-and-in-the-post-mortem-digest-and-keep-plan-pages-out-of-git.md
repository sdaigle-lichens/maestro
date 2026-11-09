# Treat agents on no workflow as helpers on resume and in the post-mortem digest, and keep plan pages out of git

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Task 157 shipped a read-only plan-reviewer agent that sits on no workflow and writes HTML plan pages to .claude/maestro-tasks/views/. Three rough edges remain, all about treating an agent on no workflow (and its output) as a helper rather than a workflow step. (1) When such an agent is resumed, the SubagentStart hook can still inject the 'Resumed run ... handoff routes ... still apply' line; for an agent with no routes it must not mention handoff routes at all, while a workflow agent's resume line stays as it is. (2) The post-mortem digest lists helper agents on no workflow (Explore, plan-reviewer) under Problems as 'missing HANDOFF'; they must not be flagged, while a workflow agent that ended with no label still is. (3) Generated plan pages show up as untracked files: the install flow's committed-mode '# Maestro' .gitignore block gains a glob for .claude/maestro-tasks/views/ beside the existing channels/maestro_sessions/claims globs, the update flow adds it to existing installs idempotently, ignored mode stays unchanged, and this repo's own .gitignore ignores the folder. This changes hook code (edit the TypeScript plugin-entries sources where the logic is generated, never the generated lib bundles), the install/update scripts or skill text as needed, tests for each behaviour, a patch bump of the maestro plugin version, and a refresh of this repo's tracked runtime copies.

## Acceptance criteria

- [ ] Resuming an agent on no workflow injects no line mentioning handoff routes, a test asserts it, and a workflow agent's resume line is unchanged.
- [ ] The post-mortem digest no longer lists agents on no workflow under Problems as missing HANDOFF, a test asserts it, and a workflow agent that ended with no label is still flagged.
- [ ] A committed-mode install adds a .claude/maestro-tasks/views/ glob to the '# Maestro' .gitignore block, the update flow adds it to an existing install idempotently, and ignored mode is unchanged.
- [ ] This repo's .gitignore ignores .claude/maestro-tasks/views/.
- [ ] The maestro plugin version gets a patch bump, the generated libs are rebuilt from source if a plugin-entries file changed, the runtime refresh has been run, and the parity test and full verify pass.

## Touched surfaces

- plugins/maestro/scripts/maestro-inject-agent-context.js (resume line)
- plugins/maestro/scripts/maestro-post-mortem.js (digest)
- plugins/maestro/scripts/maestro-task-status.cjs (if the missing-HANDOFF classification lives there)
- apps/maestro/src/core/plugin-entries/*.ts and plugins/maestro/scripts/lib/*.cjs (generated; only if the logic lives there)
- install/update gitignore writer and plugins/maestro/skills/maestro-install, maestro-update SKILL.md
- .gitignore
- .claude/scripts mirrors (via pnpm refresh:runtime)
- plugins/maestro/.claude-plugin/plugin.json (version; always counts as overlap)
- parallel OK with 170 and 171, which also touch hook scripts and plugin.json: whichever merges later rebases and takes the next patch version

## Blocked by

None — can start immediately
