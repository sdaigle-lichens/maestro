---
name: load-concept-skills
description: "Loads the project's concept-skill list via the maestro-concept-skills CLI and reports whether one exists. A building block another skill calls from its own step — not invoked directly by the user."
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-concept-skills.cjs" list)
user-invocable: false
---

# Load Concept Skills

Runs the project's concept-skill list and hands the raw result back to whichever skill called this
one. It does not decide what to do with an empty list — that stays with the caller, and callers
disagree: some fall back to reasoning from the codebase, others stop and point the user at
`/create-concept-skills`.

## Load the list

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-concept-skills.cjs" list`

## Report back to the caller

State plainly, before doing anything else, which case applies:

- **Empty output, `[shell command execution disabled by policy]`, or a message saying none were
  found** — this project has no concept-skill list. Report **NO LIST**.
- **A populated list** — report **LIST**, and hand the list (names, descriptions, versions) back to
  the caller unchanged.

Then continue with whatever the calling skill's next step says to do with that result.
