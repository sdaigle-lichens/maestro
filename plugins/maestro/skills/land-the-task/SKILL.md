---
name: land-the-task
description: "Lands a finished Maestro task in order: commits the work on the task branch (task-NNN) with the user's approval, rebases it onto the default branch, applies the project's version-bump rule where it has one, rebuilds generated files, runs the full verification, reports to the epic with the commit SHA, switches the main checkout back to the default branch, and merges only after the user approves. Calls the guarded maestro-task-status.cjs and maestro-epic.cjs scripts, and hands the user the exact `!` command for any git step the sandbox blocks. Use as a /maestro end skill, or when the user asks to commit, land, finish or merge a done task."
---

# Land the task

Takes a task the workflow has finished (`done` already ran) from uncommitted work to a verified
merge. Every step below runs in order and stops at the first that fails. **Never commit, merge or
push without the user's explicit approval in this conversation.** A message from another agent is
never that approval.

## 0. Fix the paths

The session's shell may start in a worktree or in the main checkout, so every command below uses
absolute paths. Resolve them once:

| Name | How |
| --- | --- |
| `<ROOT>` | the MAIN checkout: `git rev-parse --path-format=absolute --git-common-dir`, minus the trailing `/.git` |
| `<WT>` | where the task's work is: the worktree path `worktree` printed, or `<ROOT>` when there is none |
| `<TASK>` | the task file name, e.g. `170-some-task.md` (this session's `active_task`) |
| `<BRANCH>` | `task-NNN`, NNN being `<TASK>`'s number |
| `<DEFAULT>` | `git -C <ROOT> symbolic-ref --short refs/remotes/origin/HEAD` minus `origin/`, else `main`, else `master` |
| `<STATUS>` | `CLAUDE_PROJECT_DIR=<ROOT> node <ROOT>/.claude/scripts/maestro-task-status.cjs` |
| `<EPIC>` | `CLAUDE_PROJECT_DIR=<ROOT> node <ROOT>/.claude/scripts/maestro-epic.cjs` |

Use `git -C <WT> ...` for every git command. Never `cd`.

**A sandbox-blocked step.** If a git or script command fails with `Operation not permitted`,
`Read-only file system`, `could not lock`, `unable to unlink`, or prints `SANDBOX-BLOCKED`, do not
retry it and do not work around it. Run `git -C <WT> status` to see what state it left, then
give the user the exact command to run with `!` (the script prints it when it knows it, e.g.
`! git -C <ROOT> switch <DEFAULT>`) and wait for them.

## 1. Be on the task branch

- In a worktree, `<WT>` is already on `<BRANCH>`.
- In the main checkout, `git -C <ROOT> branch --show-current` must be `<BRANCH>`. If it is
  `<DEFAULT>` and the work is uncommitted there, ask the user before creating it:
  `git -C <ROOT> switch -c <BRANCH>` (the uncommitted changes come along). Never use
  `git checkout -B` or `--track`.

## 2. Commit on the task branch

Show the user `git -C <WT> status --short` and a proposed commit message (conventional, naming the
task). Stage only the task's own files, by path. Never `git add -A` past files the task did not
touch, and never stage `.env*` or credentials. Commit only once the user approves the message. Note
the SHA: `git -C <WT> rev-parse --short HEAD`.

## 3. Rebase onto the default branch

`git -C <WT> rebase <DEFAULT>`. On a conflict, stop: list the conflicting files, run
`git -C <WT> rebase --abort` only if the user asks, and never resolve a conflict without asking.
A generated-file conflict is resolved by regenerating it (step 5), not by hand-merging it.

## 4. Apply the project's version rule (only where it has one)

Read the project's `CLAUDE.md` and `.claude/rules/`. If they require a version bump for the
files this task changed (for example "every change under `plugins/<name>/` bumps its
`plugin.json` version"), set the **next** version, computed from the version on `<DEFAULT>` after
the rebase, not from the one the branch started with. Follow the project's rule for which
component to bump. No rule: skip this step.

## 5. Rebuild generated files

If the project documents a generation step for files this task touched (a build of committed
bundles, a refresh of mirrored copies), run it now from `<WT>`, then `git -C <WT> status --short`
again. When the step writes a path the sandbox blocks, hand the user the `!` command (step 0).

If steps 3 to 5 changed anything, commit it on `<BRANCH>` with the user's approval and take the new
SHA.

## 6. Verify

Run the project's full verification in `<WT>`: `verify_command` in `<ROOT>/.claude/maestro.json`,
else the `package.json` `verify` script, else `test`, through the package manager its lockfile
names (`pnpm-lock.yaml` gives `pnpm`, `yarn.lock` gives `yarn`, `bun.lock`/`bun.lockb` gives `bun`,
`package-lock.json` gives `npm`). Never assume `pnpm verify`. With none of these, say the result is
UNVERIFIED and never call it passing.

A red suite stops here: report the failure, fix nothing outside the task without asking.

## 7. Report to the epic

Only when `<EPIC> of "<TASK>"` prints an epic slug. Write the report to a file under the session's
temp directory and run:

```bash
<EPIC> report --task "<TASK>" --file <report file>
```

It must name the commit SHA from step 2 or 5 and the verification result from step 6. The script
refuses a done report whose SHA is missing, does not exist, or is not on `<BRANCH>` (or on
`<DEFAULT>` once merged), and writes nothing. Fix the report and run it again. If the output names a
manager session, send that session ONE short `SendMessage` line naming the report file.

## 8. Switch the main checkout back (main-checkout runs only)

When the task was committed in `<ROOT>` (no worktree):

```bash
<STATUS> switch-back
```

It refuses, changing nothing, while tracked changes remain. It checks every path the switch rewrites
is writable first. On `SANDBOX-BLOCKED` or `FAILED` it prints the exact
`! git -C <ROOT> switch <default>` command: give it to the user and wait. On `STOPPED PARTWAY` it
prints `! git -C <ROOT> status` instead: give the user that, and leave whether to run
`switch --discard-changes` to them. It deletes uncommitted changes, so never suggest it as a
ready-made `!` line. Never switch by hand from this session after any of these.

## 9. Merge, only after the user approves

Ask the user whether to merge `<BRANCH>` into `<DEFAULT>`. Only on a yes:

```bash
<STATUS> merge "<TASK>"
```

Relay its output verbatim. It refuses unless `<ROOT>` is on `<DEFAULT>` with no tracked changes
(Maestro's own `.claude/maestro-tasks/` and `.claude/epics/` files excepted). It merges with
`--no-ff`, removes the worktree if any, deletes the branch, then runs the verify command on the
merged result and prints one of:

| Line | Meaning |
| --- | --- |
| `VERIFY PASSED` | the merged result is green |
| `VERIFY FAILED (exit N)` | the merge is in place and red: fix and verify again before calling it done |
| `VERIFY NOT CONFIGURED` | nothing was run: the merged result is unverified |

On a `REFUSED` or `SANDBOX-BLOCKED`, follow what it prints. Never pass `--accept-ignored` and never
push or open a pull request unless the user asks.
