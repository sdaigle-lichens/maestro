# Note n001 from epic worktree-handoff-fixes

- From epic: worktree-handoff-fixes
- From session: maestro-mgr-82f98516
- Subject: Task 167 changes this repo's Backend workflow before merge
- Written: 2026-11-09T15:27:50.373Z

Heads-up from worktree-handoff-fixes: task 167 is about to merge and changes this repo's own Backend workflow, which every session here runs on. Nothing under plugins/ changes.

- A new test -> refactor condition edge in the Backend workflow fires when the same defectClass repeats in the previous two backend rounds of a run. The existing refactor -> backend edge is unchanged.
- The test -> backend handoff asks for `defectClass` and `sameClassProbes`, and @backend fixes the whole class in one round.
- The backend -> test handoff asks for a written `grammar` (accepted and rejected forms, one example of each) when the change classifies free text.
- @test keeps an append-only ledger at `.claude/channels/<scope>/defect-classes.md`.
- Side effect: `.claude/maestro.json` runtimeVersion moves to 0.13.36.

What to do: workers already running keep their loaded workflow. Branches that edit `.claude/maestro.json`, `.claude/handoffs/{backend/test,test/backend}.md`, `.claude/agents/test.md` or `.claude/skills/maestro-architecture/sub-concepts/handoff-contract.md` rebase after it lands and re-run `pnpm refresh:runtime` and the parity test instead of hand-merging.
