# Report r014: 101-remove-the-braced-project-dir-variable-from-every-command-the-maestro-skills-run.md

- Task: 101-remove-the-braced-project-dir-variable-from-every-command-the-maestro-skills-run.md
- Written: 2026-10-13T21:22:42.798Z
- From session: maestro-1c

Outcome: done, uncommitted in worktree /home/superadmin/gits/maestro-task-101 (branch task-101). The braced project-dir variable is gone from the orchestrator template (! lines and allowed-tools now `node .claude/scripts/<script>`), this repo's rendered orchestrator, and all published Maestro skills (trailing arg now `.`). Maestro plugin 0.11.18 -> 0.11.19. pnpm verify green (1924 passed), parity passes.
Findings: plugins/concept-skills install/update/uninstall skills still use the braced variable, but only in Read-tool prose; left out of scope. Frontmatter change reaches existing projects only through purge and reinstall. Subagents' first channel-file writes were denied by the classifier twice (frontend, test); a retry succeeded each time.
Post-mortem: none. Suggested ticket changes: none; optionally a follow-up to tidy the concept-skills prose.
