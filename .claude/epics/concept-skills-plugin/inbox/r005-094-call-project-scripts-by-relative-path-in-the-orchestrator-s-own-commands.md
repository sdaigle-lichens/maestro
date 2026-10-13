# Report r005: 094-call-project-scripts-by-relative-path-in-the-orchestrator-s-own-commands.md

- Task: 094-call-project-scripts-by-relative-path-in-the-orchestrator-s-own-commands.md
- Written: 2026-10-13T15:39:21.500Z
- From session: orchestrator

Task 094 done. Orchestrator template and four other published skills now call project-copy scripts as `node .claude/scripts/<script>`; plugin 0.11.10; new test orchestrator-template-commands.test.ts; pnpm verify green. Live no-prompt run not verified. No problems.
