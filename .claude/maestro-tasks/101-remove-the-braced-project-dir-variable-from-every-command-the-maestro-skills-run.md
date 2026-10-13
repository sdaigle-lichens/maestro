# Remove the braced project-dir variable from every command the Maestro skills run

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Any command containing `${CLAUDE_PROJECT_DIR:-.}` asks the user under `permissions.blockReadsOutsideWorkingDirectories`, because a braced variable can't be checked before it runs. That includes the orchestrator's `!` command-injection lines (step 1 gates, step 4 gate, end skills), even though their `allowed-tools` grants cover them; task 094 left these lines alone on the assumption that a grant means no prompt, and that assumption turned out to be wrong (the end-skills line prompts).

Switch those `!` lines and their `allowed-tools` grants in the orchestrator template to the plain relative form (`node .claude/scripts/<script>`), and re-render this repo's copy. In the published skills that pass the project directory to a plugin script as a trailing `"${CLAUDE_PROJECT_DIR:-.}"` argument (team meeting and its apply-kinds reference, create/update-workflow, maestro-install/update/uninstall, post-mortem), pass `.` instead. `${CLAUDE_SKILL_DIR}` and `${CLAUDE_PLUGIN_ROOT}` are filled in when the skill loads, and prose that names a path for the Read tool is not a command, so leave both as they are. The orchestrator's frontmatter change reaches an existing project only through a purge and reinstall.

## Acceptance criteria

- [ ] No command the orchestrator template or a published Maestro skill tells Claude to run contains ${CLAUDE_PROJECT_DIR
- [ ] The orchestrator's ! lines and their allowed-tools grants use node .claude/scripts/<script>; this repo's rendered orchestrator matches
- [ ] Plugin-script calls pass . as the project directory; ${CLAUDE_SKILL_DIR}, ${CLAUDE_PLUGIN_ROOT} and Read-tool path prose are unchanged
- [ ] Tests that pin the template text are updated; pnpm verify passes; maestro plugin version bumped
- [ ] The handoff notes that the frontmatter change needs a purge and reinstall to reach an existing project

## Blocked by

None — can start immediately
