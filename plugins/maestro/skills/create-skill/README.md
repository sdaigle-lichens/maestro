# create-skill

Scaffolds a new Claude Code skill — either inside a marketplace plugin or directly in the user's current project.

## How it works

1. In the **Maestro desktop app** (`apps/maestro`), the user picks **Create → Skill** from the top bar and fills the split-pane form (auto/manual mode, marketplace/project target, name, idea, triggers) with a live preview of the file on the right.
2. On submit the route calls `scaffoldSkill` in `apps/maestro/src/core`: the directory and the `SKILL.md` frontmatter are written **immediately**, with no model involved.
3. If anything is left to author — an auto-mode body — the route builds a prose prompt carrying the payload and the scaffold result, shows it in full (what it may read, prompt, equivalent command line, cwd, files it may write), and runs it as an Agent SDK session once the user confirms. The run may write only the files that confirmation listed. This file (`SKILL.md`) is what that prompt asks Claude to follow.
4. Invoked directly in a session instead (`/create-skill`), there is no form and nothing pre-scaffolded: gather the fields conversationally and do every step.

The ordering in 2–3 is the design: the skill exists on disk before Claude is asked for anything, so declining the confirmation still leaves the user with their skill.

See `apps/maestro/.claude/skills/create-skills-architecture/` for the full architecture and gotchas.

## Payload contract

The form sends a JSON object with `mode` and `target` fields, dispatched four ways:

| target | mode | Payload shape |
|---|---|---|
| `marketplace` | `auto` | `{ mode, target, name?, idea, useWhen, marketplacePath, plugin }` |
| `marketplace` | `manual` | `{ mode, target, name?, description, triggers, marketplacePath, plugin }` |
| `project` | `auto` | `{ mode, target, name?, idea, useWhen, projectPath }` |
| `project` | `manual` | `{ mode, target, name?, description, triggers, projectPath }` |

`useWhen` and `triggers` are `string[]`. The `description` frontmatter is built from `firstSentence(idea) + " Use when " + joinOxford(chips)`, clipped to 140 chars.

## Output locations

- **Marketplace target:** `<marketplacePath>/plugins/<plugin>/skills/<name>/SKILL.md`
- **Project target:** `<projectPath>/.claude/skills/<name>/SKILL.md`

## Related

- `create-subagent` — same pattern for subagents (`AGENTS.md` / `<name>.md`)
- `create-plugin` — scaffolds the plugin a skill is filed under
- `manage-marketplace` — installs/updates marketplaces once skills land in one
