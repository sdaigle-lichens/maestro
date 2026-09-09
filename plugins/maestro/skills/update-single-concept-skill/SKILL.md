---
name: update-single-concept-skill
description: "Takes one concept skill from skeleton to something worth loading: researches the concept properly, deepens its SKILL.md and sub-concepts, and writes per-agent notes for the agents the project actually uses. Use when a concept skill is thin, when an agent reports a gap in one, or when the user asks to improve or flesh out a specific concept skill."
---

# Update Single Concept Skill

The deep, narrow pass. `/create-concept-skills` writes skeletons and `/update-concept-skills` keeps
them true; this is where one concept skill actually becomes useful.

It is still not a licence to read everything. The measure of a good concept skill is not how much it
knows — it is how quickly an agent that loads it can start working, and how many of the traps it
walks the agent around. Aim for the notes a colleague would give in five minutes before you touched
the code, not a written-out account of the code itself.

## User's intention

$ARGUMENTS

(The concept skill to work on. If nothing was passed, run step 1 below and ask the user which one.)

## Workflow

### 1. Find it, and read how mature it is

Run the `load-concept-skills` skill.

If it reports **NO LIST**, there is nothing to work on — tell the user to run
`/create-concept-skills` first.

The `version` reported for each skill (its frontmatter `metadata.version`) tells you what kind of
pass this should be:

| Version | What it means | This pass |
| --- | --- | --- |
| `1.0` | A skeleton from `/create-concept-skills`. Never researched. | Broad. Establish the mechanism, the file map, the relationships, the first real traps. |
| `1.x` | Reconciled against diffs, never deepened. | Same as above — a minor bump is not a deep pass. |
| `2.0`+ | Already been through here at least once. | Targeted. Find what is now wrong or missing; do not rewrite what is already right. |

On a `2.0`+ skill, read the existing file first and treat it as mostly correct. Rewriting a mature
concept skill from scratch loses the traps someone paid for in a debugging session, and they are the
most valuable thing in the file.

### 2. Understand the concept, and its neighbours

Read the concept's own code — properly this time, but bounded by the file map the skill already
carries. Then read enough of the **other** concept skills to place this one: what it assumes of them,
what they assume of it, where the boundary is. Those relationships are what a skeleton always gets
vaguest, and what an agent most often needs.

Delegate breadth to subagents where it helps; keep the synthesis yourself.

Watch for the two things worth writing down that reading code alone will not give you: a decision
that looks arbitrary until you know what it prevents, and a failure mode that does not announce
itself. Git history and existing comments are usually where those are.

### 3. Deepen the `SKILL.md`

The core concept file. What it should carry:

- **What this is, and where it lives.** One paragraph, then a file/directory map.
- **How it works.** The mechanism and the invariants — the reasoning an agent needs *before*
  changing anything, not a narration of the call stack.
- **Its relationships.** Which other concept skills it touches, and how, by name.
- **Things that bite.** The traps. This is the section that earns the skill its context cost.
- **Sub-concepts.** One line each, linking `sub-concepts/*.md`.

Cut as much as you add. A file that grew and got no clearer has gone the wrong way.

### 4. Deepen the sub-concepts

Each `sub-concepts/*.md` gets the same treatment at its own scale: the mechanism, its files, its own
traps. A sub-concept file exists so the `SKILL.md` doesn't have to carry that detail — if a
sub-concept's content would be better inline, delete the file and inline it.

Add a sub-concept file only for a part the concept genuinely has. Splitting a concept into files to
look thorough is how a skill becomes expensive to load and no more useful.

### 5. Write `agents/` notes — only where they earn their place

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-concept-skills.cjs" agents
```

Write `agents/<agent>.md` **only** for agents in that list, and **only** where an agent genuinely
needs something the shared file shouldn't carry — how the backend agent should implement against this
concept, how the test agent should test it, what the reviewer should look for.

An empty list, or no `maestro.json`, means write no agent notes — `agents` is the one place these
flows read Maestro's config, and a project without it correctly gets none. This step is optional by design: an
`agents/` directory full of files restating the `SKILL.md` costs every one of those agents context
and tells them nothing.

Reference each note from the `SKILL.md` so the agent knows it exists.

### 6. Stamp it

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-concept-skills.cjs" stamp <concept-id> --bump major
```

A major bump, because this pass is the thing that distinguishes a researched skill from a skeleton —
that is exactly what step 1 reads. The repo-level `concept-skills.json` record is **not** touched: the
list itself did not change, only one skill's depth.

## Keeping it lean

The pressure on this skill is always toward more. Three checks before you finish:

- Would an agent that read only this file be able to start work? If not, something essential is
  missing. If it would have been able to a third shorter, cut.
- Is anything here recoverable in ten seconds from the code itself? Cut it — the file map already
  says where to look.
- Does every trap describe something that actually happened, or that you can point at in the code?
  A speculative warning is noise, and it teaches the reader to skim the section that matters most.

## Report

The concept skill you worked on, its old and new version, and what changed: the sections you
deepened, the sub-concept files added or removed, the agent notes written. Say which agents you
deliberately wrote no notes for. If you found something that belongs in `docs/` rather than here —
a diagram, a schema, an onboarding walkthrough — say so and offer to move it; the `/scribe` skill
carries that rule.
