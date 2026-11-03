# Report r002: 130-human-review-always-shows-its-summary.md

- Task: 130-human-review-always-shows-its-summary.md
- Written: 2026-10-28T17:21:32.770Z
- From session: manager-review-130

# Task 130 — human review always shows its summary

**Outcome:** done, uncommitted in the main checkout. All five acceptance criteria met (reviewer: SUCCESS). `pnpm verify` exits 0 (2215 tests); @test's full run 2227 passed, parity 43 passed.

**What landed**
- New PreToolUse hook on `AskUserQuestion` (`maestro-human-review-gate.js`, logic in `human-review-gate.ts` via the `maestro-session` bundle). Denies while the plan's first unfinished step is `human review` and that round's review file is missing; fails open on no plan / no active_task / bad state.
- Registered in plugin `hooks.json`, `install.ts`, `maestro-install.js`, `.claude/settings.json`. Plugin 0.12.11 -> 0.13.0.
- Template: write `<task>.review.md` (`.review-N.md` later rounds) in fixed format, print full summary, digest (~15 lines, ending with the file path) in the Approve preview.
- Review files skipped by task listings; `plan-step <label> pending` now increments `plan.loopbacks`.

**Findings**
- Claude Code honouring a deny on `AskUserQuestion` is untested; only the hook's output is.
- The loop-back counter bumps on any loop-back, so a review can be `.review-2.md` after a test loop-back.
- Sessions that never record a `plan` are not gated.
- Sandbox blocked subagents from `.claude/scripts` and `.claude/skills`: the user ran the mirror copies and `maestro-install.js` by hand. NOTE: `maestro-render-orchestrator.cjs` only renders the HANDOFFS table; STEPS is re-synced by `maestro-install.js`.
- One full-suite flake: `claude.test.ts` process-group test timed out under load, passes alone.

**Outstanding doc edits (sandbox-protected, scribe gave exact text):** `.claude/skills/{maestro-architecture,task-queue,installing-maestro,updating-maestro}/SKILL.md`. Only `plugin-libs-parity` was updated.

**Suggested ticket changes:** none for 131/132 beyond noting the gate is now active for any session that records a plan.
