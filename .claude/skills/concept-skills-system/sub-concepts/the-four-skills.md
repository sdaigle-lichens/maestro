# The four skills

**`create-concept-skills`** derives the list from scratch. Its defining constraint is budget: it
delegates reading to cheap subagents, keeps their findings as *lists of candidates*, and stops at
skeletons. It refuses to run when a list already exists. It must settle the list with the user via
`AskUserQuestion` — and when running as a subagent, where that tool is stripped, it must emit the
proposal and stop rather than decide on the user's behalf.

**`update-concept-skills`** reconciles an existing list against what changed since `last-update`.
Diff-driven: given a code-change report it can skip re-exploring the code the session just wrote.

**`update-single-concept-skill`** takes one skill from skeleton to something worth loading:
researches the concept, deepens `SKILL.md` and `sub-concepts/`, and writes the per-agent `agents/`
notes for the agents the project actually uses (`maestro-concept-skills.cjs agents`). Deep on one
concept, still not exhaustive.

**`scribe`** is the placement rule rather than a lifecycle step: concept skills are for agents,
`docs/` is for humans, and shared knowledge becomes a `docs/` file a concept skill references.

Directory: `plugins/maestro/skills/`.

## What each bump means

Version conventions follow the depth split: `update-concept-skills` bumps a touched skill **minor**,
`update-single-concept-skill` bumps one **major** (a deep research pass is what separates a
researched skill from a skeleton), and a skill created in either run gets **initial**.

**The repo-level record moves by `0.1` and effectively only by `0.1`.** A reconciliation bumps it
minor whether or not concepts were added or deleted — adding one is the ordinary outcome of a pass,
not a different kind of event, and treating it as a major made the number jump a whole version for a
routine run. `--bump major` on `state-set` stays in the CLI for a wholesale re-derivation of the
list; nothing in the four flows reaches for it today, and `create-concept-skills` seeds a new list
with `initial` instead.
