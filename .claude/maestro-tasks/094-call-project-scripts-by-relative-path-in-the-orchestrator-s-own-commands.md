# Call project scripts by relative path in the orchestrator's own commands

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The orchestrator skill tells Claude to run its project-copy scripts as `node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/<script>" ...`. A permission check cannot resolve the `${...}` expansion, so each of these commands asks the user for approval even when an allow rule covers the script. Claude's Bash starts in the project root, and the orchestrator session stays there even when a task runs in a Maestro worktree (only the subagents work in the worktree, and the task queue lives in the main checkout); in a session started inside a Claude Code worktree, the relative path and `CLAUDE_PROJECT_DIR` resolve to the same place. So the plain form `node .claude/scripts/<script> ...` runs the same file and can be checked, and the prompt goes away. If a session ever `cd`s away, the relative form fails loudly with "Cannot find module" rather than running the wrong script.

Switch every command Claude runs itself in the published orchestrator template to the relative form: the `maestro-task-status.cjs` calls (claim, release, worktree, plan, plan-step, plan-show, handoff-issues, done, merge), `maestro-set-session-workflow.cjs`, `maestro-resolve-skill-path.cjs`, `maestro-resume-target.cjs` and the `maestro-epic.cjs report` call. Leave the `!` command-injection lines and their `allowed-tools` frontmatter grants exactly as they are: they are pre-approved and never prompt, and a frontmatter change only reaches an existing project through a purge-and-reinstall. Then sweep the other published Maestro skills for body commands that call a project-copy script under `.claude/scripts/` through `$CLAUDE_PROJECT_DIR` and switch those too; commands that run a script from the plugin itself (through the plugin root) stay as they are, since they live outside the project. Bump the plugin version, re-render this repo's orchestrator copy, and update any test that pins the template text.

## Acceptance criteria

- [ ] Every command the orchestrator template tells Claude to run against a project-copy script uses the relative form node .claude/scripts/<script>
- [ ] The ! command-injection lines and the allowed-tools frontmatter are unchanged
- [ ] Other published skills' body commands that call a project-copy script through $CLAUDE_PROJECT_DIR use the relative form; plugin-root script calls are unchanged
- [ ] In a /maestro run in this repo, the claim, plan, handoff-issues and done commands run without a permission prompt
- [ ] The maestro plugin version is bumped, this repo's orchestrator skill is re-rendered, and template-text tests are updated
- [ ] pnpm verify passes

## Blocked by

None — can start immediately
