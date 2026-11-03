# Report r007: 136-one-command-to-refresh-this-repo-s-mirrors-and-orchestrator.md

- Task: 136-one-command-to-refresh-this-repo-s-mirrors-and-orchestrator.md
- Written: 2026-10-28T21:44:52.296Z
- From session: manager-review-136

## Outcome

Task 136 is done. `pnpm refresh:runtime` (scripts/refresh-runtime.mjs) runs build-plugin-libs, then maestro-install.js, then maestro-render-orchestrator.cjs, and stops at the first failing step. Parity test messages now name that command, and a new parity block checks the rendered orchestrator's STEPS/PRINCIPLES region. The plugin-publishing rule, updating-maestro, plugin-libs-parity, the root CLAUDE.md and the installing-maestro manifest (review-gate hook row) are updated. Nothing under plugins/ changed, so there is no version bump. maestro lint, check, typecheck and the full test run (2320 tests) pass.

## Findings

- Idempotency on the real path is unverified. In the agent sandbox, step 3 fails with EROFS writing .claude/skills/maestro/SKILL.md. On a temp copy the render was byte-identical to the repo file, and steps 1 and 2 left git status unchanged. The user should run `! pnpm refresh:runtime` twice and check git status after the second run.
- `maestro-task-status.cjs merge` hint text and the task-queue skill still tell the user to hand-copy libs. Fixing that is a plugin change and needs a patch bump.
- No .claude/agents file has text about what to hand the user, so that guidance went into the root CLAUDE.md and the plugin-publishing rule.
- The scribe did not run extract/apply on the plugin-libs-parity skill and did not check whether it is declared in scribe.config.json.

## Post-mortem

The session was clean: no loop-backs, and the human review was approved in round 1.

## Suggested ticket changes

- Queue a follow-up (plugin change plus patch bump) that updates the merge hint in maestro-task-status.cjs to name `pnpm refresh:runtime`.
- Queue a check that the user ran `! pnpm refresh:runtime` twice with git status unchanged after the second run.
