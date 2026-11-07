# Report r003: 162-report-how-far-each-workflow-has-drifted-from-the-seed-in-maestro-update.md

- Task: 162-report-how-far-each-workflow-has-drifted-from-the-seed-in-maestro-update.md
- Written: 2026-11-07T17:35:35.284Z
- From session: install-update-hygiene-162

## Outcome

Task 162 is implemented: a read-only `maestro-workflow-drift.cjs` that compares each project workflow with the same-named seed workflow and reports `identical`, `differs`, `missing-in-project` or `project-only`. `maestro-update` runs it as step 8 (Report is step 9) and summarises it. It writes nothing and has no apply flag.

## Verified

- Commit `46a885f` on branch `task-162`, rebased onto 161's `feat/formatter-ignore-managed-files` (`a4595f3`). Not pushed, no PR.
- Parity test on that head: 44 of 44 passed, after `pnpm refresh:runtime`.
- Full suite on that head: 144 files, 2774 passed, 5 skipped, 0 failed.
- plugin.json is 0.13.29.

## Findings

- Referenced skills are deliberately not compared. A real install seeds them from the project's own tag and skill maps, so comparing them would flag every fresh project. The user approved this partial reading of criterion 3 at the manager's escalation, and it is documented in `references/workflow-drift.md`.
- The seed's design-check skill is taken from the project's own `Refactor` skill node, so a fresh install is never flagged for having or lacking it. Swapping, adding or deleting that node with its edges rewired is therefore not reported.
- Skill nodes are matched by their skill, not their node id.
- The installer copies the script plus `lib/maestro-seed.cjs` (not `maestro-skill-availability.cjs`) through both manifests. No sandbox allow-list entry is needed, because the script is read-only.
- Seed label drift, out of scope: `seed.ts` `testFailLabel` builds `FAIL: backend code (a test exposes a defect)`, while this repo's config uses `FAIL: a simple backend code fix found while testing`. A fresh install therefore reports `default` and `Tests` as `differs`.
- A project with two same-named workflows compares only the first. This is documented.
- One load flake: `worktree-merge.test.ts` timed out once under full-suite load and passed alone and on reruns.

## Post-mortem notes

One loop-back: @test found the skill-node id mismatch, which made a fresh `Refactor` workflow read as `differs`. @backend fixed it in round 2. Nothing recorded in the task file.

## Suggested ticket changes

- Add a task to settle the FAIL edge label (`seed.ts` versus this repo's config), then update `seed.ts`.
- The rebase conflicted on the generated `scribe-output/installing-maestro.ast.json`. It was regenerated with `code-graph extract` and `apply`, not hand-merged.
