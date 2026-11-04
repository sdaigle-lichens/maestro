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

Iterate until the user approves. Then, for each epic:

1. `node "<scripts>/maestro-epic.cjs" create <slug> --goal "<goal>"`
2. Replace the placeholder under `## Scope` in the `EPIC.md` it prints with `Depends on epics:`, `Covers:`, `Owns:` (its shared foundations, if any) and `Expansion: now|deferred — <reason>`. This is the plan's only durable record: nothing else stores epic-to-epic ordering before tasks exist, and the session that later expands a deferred epic reads it from here.

Then expand every `now` epic **in dependency order, in this session**: run SKILL.md Steps 2–4 once per epic, writing with `--epic <slug>`. A later epic's tasks block on the earlier epic's tasks by filename (`["012"]`), because that batch is already written. Block on the specific tasks the work needs, not the whole epic. The tracker enforces these edges across epics: a task is never ready while a blocker in another epic is unfinished. In the parallel-safety check, also compare the batch against the tasks of epics it is *not* ordered after.

## Expanding an epic

Read the epic's `EPIC.md` as the source: `Covers` is the scope, `Decisions` constrains it, and `Depends on epics` becomes `blockedBy`. For each epic named there, `node "<scripts>/maestro-epic.cjs" show <dep>` lists its tasks: block on the ones this work needs, by filename. If a dependency epic has no tasks yet, stop and tell the user to expand it first. Then run SKILL.md Steps 2–5, writing with `--epic <slug>`.

## Report

End the report with a suggestion; never start sessions or the manager yourself.

- **One epic:** keep **this** session open and invoke the `maestro-manager` skill for the epic, so it coordinates worker reports and rewires tickets. Open a separate Claude session for each task of the epic that is `ready` right now (no unfinished blocker, per `.claude/maestro-tasks/status.json`) and run `/maestro` on its task file in each, so they run in parallel. Tasks still blocked wait.
- **After planning several epics:** report per epic: its slug, and either the task range written or `deferred`. Suggest a `maestro-manager` session only for the epics that have a `ready` task now. For each deferred epic, say to run `/to-maestro-tasks` and ask it to expand `<slug>` once the epics it depends on have landed.
