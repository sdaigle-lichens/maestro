---
name: update-skill-tags
description: "Adds missing descriptions and project-tag / agent-type classifications to a project's own .claude/skills, and re-validates existing ones — driven only by each skill's description, never its body. Use when the user clicks Update skill tags on the Maestro app's /skills page."
---

# Update Skill Tags

Reached only one way: the user clicked **Update skill tags** on the Maestro app's `/skills` page,
which handed this session pane a table of the project's own skills — id, current description,
current project tags, current agent types — and nothing else about them. That table is the whole
job. Do not `Read` a skill's own `SKILL.md` body to "double check" — the entire point of working
from the table is that this session's context stays small, and reading the body defeats it.

## Two independent dimensions, not one flat tag list

A skill is classified along two axes, matched against a seeded agent INSTANCE's own attributes to
decide whether that skill routes to it (see `apps/maestro/src/core/skill-tags.ts`'s
`skillMapFromTags` if you want the mechanics — you don't need them for this task):

- **Project tags** — which kind of project this skill applies to. The prompt you were given states
  the exact live catalog (the project's own Project Tags list) plus the literal value `global`.
- **Agent types** — which kind of agent this skill applies to: `developer`, `planner`, `reviewer`,
  `annotator`, `tester`, plus the literal value `global`.

`global` on either axis means "matches regardless of that dimension" — reach for it only when the
skill genuinely applies to every project, or to every agent type; it isn't the default for an
unclear case. A skill can carry more than one value per dimension.

## The three things to do, per row

Every row falls into exactly one of these. Work through the whole table before writing anything.

1. **No description.** Propose a one-line description derived from the skill's id/name alone —
   `db-migrations` reads as "run and manage database migrations," `create-widget` as "scaffold a
   new widget." If the id gives no usable signal (an id like `misc` or `x`), say so and skip that
   row rather than inventing one.
2. **A description, no project tags / agent types.** Propose values for BOTH dimensions, each from
   exactly the set named in the prompt, and nothing outside it. Derive them from the description
   text alone.
3. **Already tagged.** Re-derive both dimensions from the description the same way, and compare
   against what is already stored. Flag it only if they differ — an already-correct row needs no
   line in the table you present.

## Present, then confirm

Show the full proposed table — id, the description (existing or proposed), the project tags
(existing, proposed, or changed), the agent types (existing, proposed, or changed) — and ask the
user to confirm before writing anything. A short question in prose is enough; this does not need
`AskUserQuestion` unless the proposal has a genuine either/or in it (e.g. a skill that plausibly
fits two different single values on one dimension and you want the user to pick).

## Applying what's confirmed

Two different mechanisms, because a description and a tag land in two different places:

- **Descriptions** are a file edit. Use `Edit` on `<skill's directory>/SKILL.md`'s `description:`
  frontmatter line — the write scope announced when this session opened already covers
  `.claude/skills/`. Touch only that one line; the rest of the frontmatter and the whole body are
  not yours to change here.
- **Tags** are not a file — they live in the app's own global store, and no tool here can write to
  it directly. Instead, as the **very last thing** in your final message (after the user has
  confirmed), emit exactly one fenced block, and nothing else executable after it:

  ````
  ```update-skill-tags
  {"my-skill": {"projectTags": ["backend"], "agentTypes": ["developer", "tester"]}, "other-skill": {"projectTags": [], "agentTypes": []}}
  ```
  ````

  Include every skill whose tags you are setting or changing, with BOTH dimensions on every row
  (an empty array explicitly clears that dimension — omitting a dimension entirely fails to parse
  and nothing in the block gets applied). Do not include a row you left untouched. The app applies
  this block itself; you will not see a tool result for it, but a short notice naming what was
  applied appears in the transcript right after.

## What this session cannot do

No shell, no subagents, and no read access to a skill's own body — the table above is deliberately
the entire input. A write anywhere outside `.claude/skills/` is not forbidden; it pauses and asks
the user, the same as any other pane session, but nothing in this task should need one.
