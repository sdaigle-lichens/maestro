---
name: create-concept-skills
description: "Builds a project's concept-skill list from scratch: works out the core concepts empirically, agrees them with the user, then writes the skill directory, SKILL.md and sub-concepts/ skeleton for each. Use when a repo has no concept skills yet, when the user asks to document the project's core concepts for agents, or when /update-concept-skills reports no list exists."
---

# Create Concept Skills

A **concept skill** is a `.claude/skills/<id>/SKILL.md` that explains one **core concept** of the
project — a large feature, or an important slice of logic or runtime. It is written for Claude and
its subagents, not for humans: it exists so an agent can get oriented in a concept fast and then
explore the code itself, rather than rediscovering the same shape every session.

What counts as "core" is not an exact science and differs from user to user. That is why step 5 of
this skill is a conversation, not a heuristic.

This skill builds the **skeleton** of the whole list. It deliberately does not go deep: the
`/update-single-concept-skill` skill is where one concept gets researched properly. Your job here is
breadth — enough understanding of the project to name its concepts correctly and file them in the
right places.

> **Budget matters more than completeness here.** Do not read the project exhaustively. Delegate the
> reading to cheap subagents (below), keep their findings as *lists of candidate concepts*, and stay
> out of the details. A session that ends up knowing everything about the project has failed this
> skill's purpose, however good the resulting files look.

## User's intention

$ARGUMENTS

(If that reads as an empty or literal placeholder, nothing was passed — work from the repo alone.)

**If it already carries an approved concept list**, a previous run of this skill proposed one and the
caller has settled it with the user. The conversation in step 5 is done: skip steps 2–5, treat that
list as final, and go straight to step 6. Say in your report that you resumed from an approved
proposal rather than deriving the list yourself.

## Workflow

Create a task per step with `TaskCreate` before you start, so the sequence survives a long session.
Wire each to the previous with `TaskUpdate addBlockedBy`.

> In a project running a Maestro workflow, the `PostToolUse` validation hook will warn that these
> tasks don't match the active workflow's success path. That warning is expected and harmless — the
> hook is advisory and never fails a call.

### 1. Stop if a list already exists

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-concept-skills.cjs" state
node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-concept-skills.cjs" list
```

`state` reports `{"present": true, ...}` when `.claude/maestro.json` already records a concept-skill
list. If it does — **or** if `list` finds any concept skills even without a `maestro.json` — stop
here and tell the user to run `/update-concept-skills` instead. Do not proceed and do not offer to
merge; rebuilding a list over one that exists is how a user loses hand-written concept skills.

Both empty is the only signal to continue — **with one exception**: a run resuming from an approved
proposal (above) has already passed this check on its first pass and may continue even if the
skeleton it is finishing is partly on disk. That is a re-entry, not a rebuild.

### 2. Read what the project already says about itself

Dispatch a **subagent** for this, not your own context — `Explore`, or a `general-purpose` agent on a
cheap model. Ask it for `README.md`, every `CLAUDE.md`, `AGENTS.md`, anything under `docs/`, and the
descriptions of the existing skills in every `.claude/skills` in the tree.

Tell it to report **a list of candidate core concepts with one line each**, plus where the
documentation lives. Explicitly tell it not to return file contents or code excerpts.

### 3. Sweep the code from an eagle view

A second subagent, same shape. The documentation from step 2 is often incomplete and often stale, so
this pass exists to find concepts nobody wrote down. Point it at the top-level structure — entry
points, route tables, the directory layout, the biggest modules — and ask for candidate concepts and
the directory each one is centred on.

You want the concept's **home directory**, because that decides which `.claude` its skill goes in.

### 4. Propose the list

Merge the two reports into a proposal. For each concept: a name, a one-line description, the
directory it lives in, and any **sub-concepts** beneath it.

A sub-concept is a distinct part of a core concept that deserves its own file — the way "the shared
logic behind the four create-\* flows" has one sub-concept per artifact kind. If a concept has no
natural parts, it has no sub-concepts, and inventing four to fill the table makes the skill worse.

Present it as a numbered list. Say plainly which concepts came from documentation, which you found
in the code, and which you are least sure about.

### 5. Settle it with the user

This step is what makes the list theirs rather than yours, and **how you run it depends on whether
you can talk to them.** Check your own tool list before you start.

**If `AskUserQuestion` is available** — you are the main session. Use it. Give every option a real
label and a `description` saying what it means; use `multiSelect` where the choice is not exclusive.
Ask about the things that actually differ between readings:

- Which candidates are genuinely core, and which are too small or too broad
- Whether a proposed sub-concept should be promoted to its own concept, or a concept demoted
- Where a concept belongs when its code spans more than one package

Iterate until the user approves, then continue to step 6.

**If `AskUserQuestion` is NOT available** — you are running as a subagent, and Claude Code strips
that tool from every one of them. There is nobody here to ask, so **do not decide on the user's
behalf and do not write anything.** Emit the step-4 proposal as your final report — each concept
with its one-line description, its home directory, its sub-concepts, and which ones you are least
sure about — and stop. Say explicitly that the list is unconfirmed and that re-invoking this skill
with the approved list resumes at step 6.

Stopping here is a completed turn, not a failure. Writing an unconfirmed list into a dozen `.claude`
directories is the failure.

### 6. Write the skeleton

For each approved concept, in the `.claude` **nearest its code** — `apps/web/.claude/skills/...` for
a concept that lives in `apps/web`, the repo root's only for something genuinely repo-wide:

```
<dir>/.claude/skills/<concept-id>/
  SKILL.md
  sub-concepts/
    <sub-concept>.md
```

The `SKILL.md` body, at this stage, is:

- A one-paragraph statement of what the concept is and where it lives
- The files and directories it is made of, as a table when there is more than a handful
- Its relationships to the other concept skills, by name
- A `## Sub-concepts` section linking each `sub-concepts/*.md` file, one line each

Each `sub-concepts/*.md` gets a paragraph and the files it covers. A stub that says nothing is worse
than no file, so write only the sub-concepts that step 5 approved.

**Do not create an `agents/` directory.** Agent-specific notes need an understanding of the concept
this skill has deliberately not acquired; `/update-single-concept-skill` writes them.

Write the frontmatter with `name` and `description` only — the next step adds the markers.

### 7. Stamp the versions

For each skill written:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-concept-skills.cjs" stamp <concept-id> --bump initial
```

Then the repo-level record:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-concept-skills.cjs" state-set --bump initial
```

Both default the commit to `HEAD`. `state-set` reports `written:false` when the project has no
`.claude/maestro.json` — that is fine and expected in a repo without Maestro installed; the skills
themselves are still stamped, and `list` remains the source of truth.

Never hand-edit `metadata.version` or `metadata.last-update`. The script owns them so that a version
can't quietly drift, and a version stuck at `1.0` makes `/update-single-concept-skill` re-research a
concept that was already done.

## What belongs in a concept skill

Written for an agent about to change the code:

- The mechanism, and the invariants that hold it together
- Where things live — a file map beats a paragraph
- The traps: what looks like the fix and is not, what fails silently
- What this concept assumes of the others

Not this:

- Diagrams, schemas and onboarding narrative — those are for humans and belong in `docs/`
- An exhaustive account of every function
- Anything you have not actually read

The `/scribe` skill is the full rule for that split. Load it if you are unsure where something goes.

## Report

Say how many concept skills were created and where each landed (a monorepo puts them in several
`.claude` directories, and the user will want to know which). Name any concept the user rejected, so
the decision is on the record. Say whether `state-set` wrote to `maestro.json` or reported
`written:false`. Close by naming `/update-single-concept-skill` as the next step for whichever
concept matters most — the skeletons are not yet worth much on their own.
