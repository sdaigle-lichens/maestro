# create-subagent

Scaffolds a new Claude Code subagent (AGENTS.md format) — either inside a marketplace plugin or directly in the user's current project. Mirrors `create-skill` with two extra fields: `triggers` (when to hand off) and `tools` (allowed tools).

## How it works

1. In the **Maestro desktop app** (`apps/maestro`), the user picks **Create → Subagent** from the top bar and fills the split-pane form (auto/manual mode, marketplace/project target, name, idea/description, triggers, tools) with a live preview on the right.
2. On submit the route calls `scaffoldSubagent` in `apps/maestro/src/core`: the agent file and its frontmatter are written **immediately**, with no model involved.
3. If a body is still to be authored, the route builds a prose prompt carrying the payload and the scaffold result, shows it in full for confirmation, and runs it as an Agent SDK session. The run may write only the files that confirmation listed. This file (`SKILL.md`) is what that prompt asks Claude to follow.
4. Invoked directly in a session instead (`/create-subagent`), there is no form and nothing pre-scaffolded: gather the fields conversationally and do every step.

See `apps/maestro/.claude/skills/create-skills-architecture/` for the full architecture.

## Payload contract

| target | mode | Payload shape |
|---|---|---|
| `marketplace` | `auto` | `{ mode, target, name?, idea, triggers, tools, marketplacePath, plugin }` |
| `marketplace` | `manual` | `{ mode, target, name, description, triggers, tools, marketplacePath, plugin }` |
| `project` | `auto` | `{ mode, target, name?, idea, triggers, tools, projectPath }` |
| `project` | `manual` | `{ mode, target, name, description, triggers, tools, projectPath }` |

`triggers` and `tools` are `string[]`. The frontmatter `description` is built the same way as `create-skill`; `tools` becomes a comma-joined `tools:` line in YAML frontmatter.

## Output locations

- **Marketplace target:** `<marketplacePath>/plugins/<plugin>/agents/<name>/AGENTS.md` (file inside a per-agent directory)
- **Project target:** `<projectPath>/.claude/agents/<name>.md` (single file, no enclosing directory — Claude Code project convention)

## Related

- `create-skill` — same pattern for skills
- `create-plugin` — scaffolds the plugin a subagent is filed under
