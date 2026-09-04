---
name: scribe
description: "The rule for what documentation goes where: concept skills under .claude/skills for agents, docs/ for humans, and a referenced docs/ file for knowledge both need. Use when writing or moving project documentation, when a concept skill is accumulating diagrams or narrative, or when deciding whether something belongs in a skill or a doc."
---

# Scribe

Two audiences, two homes, and one rule for telling them apart.

**Concept skills** (`.claude/skills/<concept>/`) are for Claude and its subagents. They are loaded
into a context window that costs money and attention, and they are read by something that can already
read the code. **`docs/`** is for humans, who cannot, and who need the picture before the mechanism.

Most documentation mistakes are a file in the wrong home rather than a file badly written.

## Which home

| Write it as | When it is |
| --- | --- |
| A **concept skill** | The mechanism and its invariants. A file map. The traps — what looks like the fix and isn't, what fails silently. What one concept assumes of another. |
| A **`docs/` file** | A diagram or schema drawing. An onboarding narrative. Screenshots. Rationale written to persuade. Anything whose value is in being *looked at*. |
| A **`docs/` file that a concept skill references** | Knowledge both audiences need: how to run a migration, how to add a route, the release process. One home, two readers. |

The third row is the one people skip, and it is the most useful. A `docs/migration-instructions.md`
written for a person, linked from the backend concept skill, is better than the same content twice —
because the two copies drift, and nothing reports it when they do.

## Signals you are in the wrong home

**A concept skill drifting toward `docs/`:**

- An ASCII or Mermaid diagram of more than a few boxes. A small layout sketch earns its place; a
  full architecture drawing is something to look at, and an agent reads the file map instead.
- A schema dump, an ER diagram, a full type listing.
- Narrative — "originally we tried X, then Y, and eventually settled on Z". Keep the *decision* and
  what it prevents; move the story.
- Anything addressed to "you" as a new team member.

When you find one, **offer to move it** and leave a reference behind. Don't move it silently — the
author put it there for a reason and may want to argue.

**A `docs/` file that should be a concept skill:** a doc nobody has read in a year that agents keep
rediscovering the hard way. If its content is mechanism and traps, it is a concept skill wearing the
wrong extension.

## Writing a concept skill

- **Lead with what it is and where it lives.** One paragraph, then a file map.
- **Prefer a table to a paragraph** for anything with more than three parallel cases.
- **Put the trap beside the step that causes it**, not in a list at the end.
- **Every claim is something you read.** A concept skill that describes code that isn't there is
  worse than no skill, because it is believed.
- **Cut as much as you add.** Length is a cost paid by every agent that loads the file.

## Writing a `docs/` file

- Lead with what the reader is trying to do.
- A diagram earns its place when it shows a relationship prose makes the reader hold in their head.
- Say when it was true. A human can tell a stale doc from a current one given a date; an agent
  usually can't, which is the other reason mechanism belongs in a skill.

## The three concept-skill flows

| Skill | For |
| --- | --- |
| `/create-concept-skills` | No concept skills exist yet. Builds the whole list's skeleton. |
| `/update-concept-skills` | The list exists and the code moved. Reconciles it, wide and shallow. |
| `/update-single-concept-skill` | One concept skill is thin or an agent reported a gap. Deep and narrow. |

## Reporting a gap

Working agents write concept-skill gaps to your own channel lane — `.claude/channels/scribe/` —
rather than into a caller's report: the concept skill they loaded and what it failed to tell them.
That arrives inlined in your context, labelled by sender, the next time you're invoked, whether or
not this run's workflow wired a route to you at all. It is the signal to run
`/update-single-concept-skill` on that skill, and it is worth more than any audit you could run
yourself: it names a gap someone actually hit.

## Also true of the other files

The `CHANGELOG.md`, `AGENTS.md` File Structure sections and `.claude/rules/` are unchanged by any of
this — they have their own rules in the scribe agent's own file. This skill is only about the
concept-skill/`docs/` split.
