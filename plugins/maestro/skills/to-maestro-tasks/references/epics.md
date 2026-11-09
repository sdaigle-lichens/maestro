# Epics in to-maestro-tasks

`<scripts>` below is the plugin scripts directory that SKILL.md names.

## Writing into an epic

Add `--epic <slug>` to the `maestro-write-tasks.cjs` command: every task it writes is linked to the epic in the tracker (`epic` field). The command refuses, writing nothing, when the epic does not exist; create it first with `node "<scripts>/maestro-epic.cjs" create <slug> [--goal "<goal>"]`. To link or unlink tasks that already exist: `maestro-epic.cjs link <slug> <task.md>...` / `unlink <task.md>...`.

## Planning several epics

**An epic boundary must meet the same split criteria as a task boundary** (SKILL.md, Step 2): a hard wait, parallelism the user wants, a learning dependency, or too much for one manager to coordinate. Layers are not epics: "backend epic, then frontend epic" is the horizontal split again. Each epic delivers something demoable end-to-end. Default to fewer epics.

Propose the epic list, one entry per epic:

- **Slug** and a one-line **goal**
- **Depends on epics**: which epics must land first, and why
- **Covers**: the spec items or design sections this epic owns
- **Expansion**: `now`, or `deferred` only for a learning dependency (its design depends on *observing* an earlier epic in use)

Show two checks with the list:

- **Coverage**: every spec item or design section maps to exactly one epic. Name any item that maps to none or to two.
- **Shared foundations**: scaffolding, shared schema or helpers, version files and generated files, each with the **one epic that owns it**. Every other epic that touches it depends on the owner.

**Gate 1.** Before asking for approval, run Gate 1 of [`plan-review.md`](plan-review.md) on this list. Iterate until the user approves. Then, right after Gate 1, for each epic:

1. `node "<scripts>/maestro-epic.cjs" create <slug> --goal "<goal>"`
2. Replace the placeholder under `## Scope` in the `EPIC.md` it prints with `Depends on epics:`, `Covers:`, `Owns:` (its shared foundations, if any) and `Expansion: now|deferred — <reason>`. This is the plan's only durable record: nothing else stores epic-to-epic ordering before tasks exist, and the session that later expands a deferred epic reads it from here.

Then expand every `now` epic **in dependency order, in this session**, with **held writes**: no task is written until the last review is finished.

1. **Draft.** Run SKILL.md Steps 2–3 once per epic and keep each approved batch as a draft; do not run Step 4 yet. A draft that needs a task of an earlier epic in this plan names it **by title** in `blockedBy` (`"title: Add login form"`), since that task has no file yet. Block on the specific tasks the work needs, not the whole epic. In the parallel-safety check, also compare the batch against the drafts of epics it is *not* ordered after.
2. **Gate 2.** Run Gate 2 of [`plan-review.md`](plan-review.md) over all the drafts at once, and apply what the user approves.
3. **Write in dependency order.** Run SKILL.md Step 4 once per epic, writing with `--epic <slug>`. Before each write, swap every title reference for the real filename (`["012"]`) the writer printed for the earlier epic's batch; a title that matches no written task means the order is wrong, so stop and fix it. `maestro-write-tasks.cjs` itself is unchanged and never sees a title.

The tracker enforces the cross-epic edges: a task is never ready while a blocker in another epic is unfinished.

## Expanding an epic

Read the epic's `EPIC.md` as the source: `Covers` is the scope, `Decisions` constrains it, and `Depends on epics` becomes `blockedBy`. For each epic named there, `node "<scripts>/maestro-epic.cjs" show <dep>` lists its tasks: block on the ones this work needs, by filename. If a dependency epic has no tasks yet, stop and tell the user to expand it first. Then run SKILL.md Steps 2–5, writing with `--epic <slug>`. Gate 2 is opt-in here: offer it once, as one line in the Step 3 quiz, and on a yes run it from [`plan-review.md`](plan-review.md) before Step 4. The same one-line offer applies to a single epic planned on its own whose expansion holds more than three tasks.

## Report

End the report with a suggestion; never start sessions or the manager yourself.

- **One epic:** keep **this** session open and invoke the `maestro-manager` skill for the epic, so it coordinates worker reports and rewires tickets. Open a separate Claude session for each task of the epic that is `ready` right now (no unfinished blocker, per `.claude/maestro-tasks/status.json`) and run `/maestro` on its task file in each, so they run in parallel. Tasks still blocked wait.
- **After planning several epics:** report per epic: its slug, and either the task range written or `deferred`. Suggest a `maestro-manager` session only for the epics that have a `ready` task now. For each deferred epic, say to run `/to-maestro-tasks` and ask it to expand `<slug>` once the epics it depends on have landed.
