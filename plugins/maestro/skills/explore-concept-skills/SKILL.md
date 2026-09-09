---
name: explore-concept-skills
description: "Figures out which of the project's concept skills a task touches, and loads those SKILL.md files before any design reasoning starts. Called from another skill's own step 1 — not invoked directly by the user."
allowed-tools: Read, Grep, Glob
user-invocable: false
---

# Explore Concept Skills

Grounds a task in the project's existing concepts before any design happens. A design that invents a
second shape for a concept the project already has is worse than a shallow one; the existing concept
is either the answer or the thing being deliberately changed, and the caller needs to know which
before it starts.

## 1. Load the list

Run the `load-concept-skills` skill.

If it reports **NO LIST**, this project has no concept-skill list — read the available-skills list
first (a project skill may already document the pattern the task needs), then reason about concepts
from the codebase itself. Report back **NONE** (see below) and stop.

## 2. Decide which concepts the task touches

For each entry in the list, judge from its `description` alone whether the current task is an
instance of it, changes it, or is unrelated to it. Read source only when the description leaves it
ambiguous — the description exists so this step doesn't require opening files for every candidate.

## 3. Load the ones that matter

Read the `SKILL.md` (and, if the task needs the detail, the `sub-concepts/*.md`) of every concept
the task touches. Skip the rest — loading a concept skill the task doesn't touch costs context for no
benefit.

## Report back to the caller

Name every concept loaded, one line each: the concept name and the one thing about it the caller must
not contradict. If none applied, or the project has no list, report **NONE** and say why. Then
continue with whatever the calling skill's next step says to do with that result.
