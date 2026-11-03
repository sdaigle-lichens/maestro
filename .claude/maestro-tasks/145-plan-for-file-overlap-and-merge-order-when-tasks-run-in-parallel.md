# Plan for file overlap and merge order when tasks run in parallel

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Parallel tasks in one epic keep colliding at merge time. In code-graph's absorb-concept-skills epic, four tasks (045, 048, 049, 050) were written with no blockedBy between them and started at once from the same commit. All four edited the same CLI and pipeline files, docs, two plugin skills, a generated bundle and three version files kept in lockstep. Every merge after the first needed a rebase and a bundle rebuild; 049's rebase hit 6 conflicts. Versions were handed out ad hoc, the same helper was written twice, a manager on-track review missed a clash with a project rule (a new hooks.json that .claude/rules/ forbade), and a worker's green tests failed once merged because nobody re-ran them on the combined result. Evidence: code-graph's .claude/epics/absorb-concept-skills/ (EPIC.md, reports r043 to r046). Fix this in two published skills' instructions. to-maestro-tasks: give each task a 'Touched surfaces' list (the files it will likely touch, plus shared surfaces such as version files, generated files, shared docs and new shared helpers). Before writing, run a pairwise parallel-safety check. Where two tasks overlap, add blockedBy, merge them, or record 'parallel OK, merge order X then Y, Y rebases'. Version and generated files always count as overlap. Name one owner for any shared new helper. If the task writer script or the task file format needs a new section for this, change that code too, with tests. maestro-manager: before spawning workers, write a merge-plan table in EPIC.md (merge order, base branch per task, and who bumps versions, e.g. 'workers never bump; whoever merges bumps'), and spawn according to it. In a manager review, check the touched files against the paths covered by the project's .claude/rules/* and against sibling tickets' touched surfaces. After each merge, whoever merged re-runs the full test suite on the merged result before the manager acknowledges it, and worker reports name the commit they verified. The same rule applies inside a single run: a worker report must state that the full suite was green on the commit it names, and no review round may approve a red suite 'pending the test step' (maestro task 144's first review round approved 121 failing tests that way). Put that rule wherever the orchestrator template or the review handoff tells a review step what to accept. Keep both skills consistent with any concept skill that describes them. This is a plugin change: bump the maestro plugin's patch version and refresh the tracked runtime mirrors.

## Acceptance criteria

- [ ] to-maestro-tasks makes every written task carry a Touched surfaces list, and runs a pairwise overlap check before writing that resolves each overlap (blockedBy, merge, or a recorded merge order), always counting version and generated files as overlap
- [ ] maestro-manager requires a merge-plan table in EPIC.md (merge order, base per task, version ownership) before spawning workers, and spawns only according to it
- [ ] The manager review step checks touched files against .claude/rules/* coverage and sibling tickets' touched surfaces
- [ ] After each merge, the merger re-runs the full suite on the merged result before the manager acknowledges it, and worker reports name the verified commit
- [ ] Worker reports state the verified commit and a green full suite on it, and the review step refuses to approve a red suite pending a later test step
- [ ] Any task-writer or task-format code change has tests
- [ ] The maestro plugin.json version gets a patch bump (minor only if the published surface grows), pnpm refresh:runtime and the parity test pass (a sandboxed run hands the user ! pnpm refresh:runtime), and pnpm verify passes

## Blocked by

- `147-close-the-gaps-left-in-per-task-channel-scoping.md`
