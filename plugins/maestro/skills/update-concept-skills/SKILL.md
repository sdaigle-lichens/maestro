---
name: update-concept-skills
description: "Reconciles an existing concept-skill list against what changed since it was last updated: which concepts were added, which went away, and which skills need revising. Use after a feature lands, when an agent was added or removed, when a code-change report needs folding into the concept skills, or when the concept list has gone stale."
---

# Update Concept Skills

The list already exists; this skill keeps it true. It is the shallow, wide pass — it reconciles the
whole list against a diff. `/update-single-concept-skill` is the deep, narrow one.

The cheapest way to run this is with a **code-change report** in `$ARGUMENTS`: a summary of what a
session just changed. With one, you can go straight from the report to the concept skills it
implicates and skip re-discovering work that has already been described to you. Without one, you do
the same job from a diff, which costs more.

## User's intention

$ARGUMENTS

(If that reads as an empty or literal placeholder, nothing was passed — derive the changes yourself
from step 3.)

**If it carries an approved list of concepts to add or delete**, a previous run proposed one and the
caller has settled it with the user. Step 5 is done: apply that list in step 6 without re-proposing
it, and say in your report that you resumed from an approved proposal.

## Which mode you are in

| Signal | Mode | What changes |
| --- | --- | --- |
| `$ARGUMENTS` carries a report of code changes | **Report-driven** | Trust the report for *what* changed; do not re-scan for it. Diff only to check the report didn't miss a concept. |
| An agent was added or removed | **Agent-scoped** | Only the `agents/` subdirectories are in scope. Skip steps 4.1–4.4 entirely. |
| Neither | **Full** | Derive the changes from the diff yourself. |

## Workflow

Create a task per step with `TaskCreate` and wire them with `TaskUpdate addBlockedBy`. (In a project
running a Maestro workflow the validation hook will warn these tasks aren't on the success path —
expected, and harmless.)

### 1. Confirm a list exists

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-concept-skills.cjs" state
node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-concept-skills.cjs" list
```

If `list` finds nothing, stop and tell the user to run `/create-concept-skills` instead. There is
nothing here to update.

If `list` finds skills but `state` reports `{"present": false}`, carry on — the list is real and
just isn't recorded in `maestro.json` (a repo without Maestro installed, or one whose skills were
written by hand). Step 6 will record it.

### 2. Find the window to diff

`state` gives `last_update`, the commit the list was last reconciled against. The far end is the
commit this session started on — **ask the main session for it** rather than assuming `HEAD`, since
the session may have committed since it started.

Per-skill `last-update` values from `list` can differ from the repo-level one: a skill
revised by `/update-single-concept-skill` is ahead. Diff each skill from *its own* last update, not
from the repo's, or you will re-do work that was already done.

### 3. Read the window

```bash
git diff --stat <last-update>..<session-start>
```

Two passes, in this order, because they answer different questions:

1. **Documentation first** — `README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/`. A concept that was
   renamed or reframed usually shows up here first, and in the author's own words.
2. **Then the code, from an eagle view.** Which directories moved the most, and do they map onto
   concepts that exist? Delegate this to a subagent if the diff is large — ask it for *which
   concepts are implicated*, never for the diff back.

In report-driven mode, both passes are a check on the report rather than the primary source: you are
looking for a concept the report didn't mention, not re-deriving what it already told you.

### 4. Decide what changes

Work through all four, in order, and write down the answer to each even when it is "nothing":

1. **Concepts to add** — new code that is core and belongs to no existing skill.
2. **Concepts to delete** — a skill whose subject no longer exists. A concept that merely shrank is
   not deleted; it is revised.
3. **Skills to revise** — the `SKILL.md`, a `sub-concepts/*.md`, or both. Most changes land here.
4. **`agents/` notes to revise** — only for agents named in `.claude/maestro.json`'s
   `agents_available`. An agent that was removed loses its notes; an agent that was added gets none
   from this skill (that is `/update-single-concept-skill`'s job, when it next runs).

### 5. Confirm additions and deletions with the user

**Only additions and deletions.** Revisions to a skill that already exists do not need asking —
keeping an accepted concept accurate is the whole point of this skill — so if step 4 found nothing to
add and nothing to delete, this step is empty and you go straight to step 6.

A deletion in particular needs the user, because a concept skill may hold hard-won notes that outlive
the code they were written about.

**If `AskUserQuestion` is available** — you are the main session. Use it, with real labelled options,
to the same standard as `/create-concept-skills` step 5. Then continue to step 6 with the answer.

**If it is NOT available** — you are a subagent, and Claude Code strips that tool from every one of
them. Split the work rather than stopping outright:

1. Do step 6 for the **revisions only**. Those were never in question, and leaving a skill stale
   because an unrelated concept needed confirming helps nobody.
2. Report the proposed additions and deletions as a numbered list, each with why, and say the list is
   unconfirmed. Re-invoking this skill with the approved list applies it.
3. Do **not** create or delete a concept skill on your own judgement. A deletion especially is not
   yours to make.

### 6. Write and stamp

Apply the changes. Keep each file lean — this pass reconciles, it does not expand. If a skill needs
more than reconciliation, say so in the report and leave it for `/update-single-concept-skill`
instead of half-doing a deep pass here.

Then, for every skill you touched:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-concept-skills.cjs" stamp <concept-id> --bump minor
```

A skill you created in this run gets `--bump initial` instead. A skill you did not touch is not
stamped — its `metadata.last-update` is a statement about when it was last checked against the code,
and moving it forward for free is how a stale skill becomes invisible.

Then the repo-level record:

```bash
# a concept was added or deleted
node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-concept-skills.cjs" state-set --bump major
# only revisions
node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-concept-skills.cjs" state-set --bump minor
```

Pass `--sha <session-start-commit>` if the session has committed since it started, so the recorded
window matches the one you actually read.

## Report

Four counts — added, deleted, revised, untouched — and the concept ids behind each. Name any skill
you decided needed a deep pass rather than a reconciliation, so the user can run
`/update-single-concept-skill` on it. Say what the repo-level version moved to and whether it was a
major or minor bump.
