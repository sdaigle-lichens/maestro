# Report r001: 126-human-review-asks-with-an-approve-request-changes-picker.md

- Task: 126-human-review-asks-with-an-approve-request-changes-picker.md
- Written: 2026-10-24T13:37:28.214Z
- From session: maestro-5337fc9f

## Outcome

Task 126 is done, on branch task-126 in the worktree /home/superadmin/gits/maestro-task-126. It is not committed or merged yet.

- The `human review` stop in the orchestrator template (plugins/maestro/templates/maestro/SKILL.md) now summarises the work, then asks with AskUserQuestion offering Approve and Request changes. Corrections come through the free-text option. If AskUserQuestion is unavailable or fails, it asks in plain text. The review is still a hard stop that is never bypassed, and requested changes still follow the condition edge back to the agent that produced the work.
- This repo's rendered .claude/skills/maestro/SKILL.md has the same edit, word for word.
- plugins/maestro/.claude-plugin/plugin.json goes from 0.12.6 to 0.12.7, and .claude/maestro.json runtimeVersion goes to 0.12.7 to match, as earlier runtime commits did.
- New tests: apps/maestro/test/core/orchestrator-template-commands.test.ts has a new describe block with 5 tests.
- Docs: .claude/skills/maestro-architecture/sub-concepts/handoff-contract.md is updated.
- This session's own human review already used the new picker, and the user approved through it.

## Findings

- Version conflict: the main checkout's own uncommitted work, and probably task 125, also bump plugin.json and maestro.json runtimeVersion to 0.12.7. Whichever branch merges second must re-bump to 0.12.8, or its change never reaches cached plugin installs.
- The worktree has no node_modules. Agents symlinked the main checkout's apps/maestro/node_modules in temporarily to run vitest. Repo-wide pnpm verify and check can't run in the worktree.
- In the full suite, the Storybook browser project fails to launch because Playwright Chromium isn't installed (an environment issue). Otherwise 2158 passed and 0 failed.
- The tests check the skill's wording only. Nothing proves that a live orchestrator calls AskUserQuestion or falls back to plain text.

## Post-mortem

None. The session was clean.

## Suggested ticket changes

None for 126. Consider a ticket to give task worktrees installed dependencies, or a documented way to run tests in them.
