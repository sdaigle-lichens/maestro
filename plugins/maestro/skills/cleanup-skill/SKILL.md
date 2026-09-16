---
name: cleanup-skill
description: "Trims a skill down to what a session actually needs: cuts bloat and repetition from its SKILL.md, and splits growing content into sub-concepts/ or references/ files. Use after writing or deepening a skill, when a SKILL.md has grown long or repetitive, or when the user asks to clean up or trim a skill."
---

# Cleanup Skill

Make a skill leaner before anyone loads it again. A skill's body is not documentation for a human who can flip back a page — it is prompt context loaded into every session whose task matches its `description`, so every unnecessary line and every repeated idea is a cost every one of those sessions pays.

## Input

`$ARGUMENTS` names the skill to clean: its directory path (step 1 determines the kind itself, from
the file). If it's missing — a caller passed nothing, or a user asked to "clean up skills" in
general — ask which skill, either of the calling skill or, if you're the one being invoked directly,
of the user.

## 1. Which kind of skill this is

Check the `SKILL.md` frontmatter for `metadata: { type: concept-skill }` (see e.g.
`apps/maestro/.claude/skills/agents-view/SKILL.md`). If present, it's a **concept skill** and split
content goes to `sub-concepts/*.md`. If absent, it's a **normal (published) skill** and split content
goes to `references/*.md`.

## 2. Cut bloat and repetition

Read the whole `SKILL.md`, and every file it already links to (`sub-concepts/*.md`,
`references/*.md`, `agents/*.md`) — a repeated idea often lives across files, not just within one.

Remove:

- Two sections saying the same thing in different words. Keep the sharper one.
- A sentence that only restates the frontmatter `description` or an earlier heading.
- Prose that narrates what the code already makes obvious — a file map plus one clause beats a
  paragraph walking through it.
- A caveat, trap, or step that is speculative rather than something that actually happened or that
  you can point to in the code.

This is a volume cut, not a style rewrite. Keep every trap, invariant, and hard-won detail — a
warning said three ways is waste, but a warning said once is the reason the skill exists.

## 3. Split what's outgrowing the top-level file

A section is a candidate to move out when it:

- Describes one coherent sub-part with its own mechanism, files, and traps that the top-level file
  doesn't need in order to make its own case — one line and a link is enough there.
- Or, for a normal skill, covers a specific case, a variant path, or an edge case that most
  invocations of the skill never hit.

**Concept skill** → extract to `sub-concepts/<name>.md`; replace the section in `SKILL.md` with one
line and a link. Apply the rule in reverse too: if the extracted file would be thinner than the
one-line link replacing it, inline it instead — a sub-concept file only earns its place when it is
substantial on its own.

**Normal skill** → extract to `references/<name>.md`; replace the section with a pointer that names
the case it covers ("for `<case>`, see `references/<name>.md`"), not a bare link — the reader of a
published skill doesn't open every reference by default, so the trigger to open it has to be in the
main file.

Don't extract just to shorten the file. Splitting a section that isn't a genuine sub-part or a
genuine edge case costs a future reader two loads (the main file, then the reference) for content
that fit in one.

## 4. Re-read what's left

Read the trimmed `SKILL.md` as the agent that will load it cold would: does it still open with what
this is and when it applies? Does every remaining section earn its place? A section that now reads
thin is the point of this pass; a section that now reads incomplete means you cut something that
should have stayed — put it back.

## Report

What shrank, what moved to `sub-concepts/` or `references/` and why, and anything you deliberately
left alone because splitting it would have cost more than it saved.
