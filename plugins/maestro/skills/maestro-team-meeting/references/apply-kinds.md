# Applying each kind by hand (the `main` rows)

| kind | how |
|---|---|
| `workflow.create` / `workflow.update` | `create-workflow` / `update-workflow` skill |
| `workflow.delete` | `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-workflow-spec.cjs" delete --name "<wf>" "${CLAUDE_PROJECT_DIR:-.}"`. Kept instances are listed as `unplacedInstances`. |
| `skill.create` | `create-skill` skill |
| `skill.edit` | edit the SKILL.md; if it grew, run `cleanup-skill` when that skill is in the session's skill list, otherwise do a short inline pass: drop repeated ideas and restated prose, keep every trap and invariant |
| `skill.delete` | delete the skill directory and remove the id from `skills_available` and from every instance's skill lists |
| `skill.placement` | move the id between `loaded_skills` and `referenced_skills` of that `workflow_instances` entry |
| `agent.create` | `create-subagent` skill |
| `agent.edit` / `agent.tools` | edit `.claude/agents/<name>.md`: the body, or the frontmatter `tools:` |
| `agent.delete` | only if no workflow places it (otherwise `update-workflow` first); delete the file and drop it from `agents_available` |
| `rule.edit` / `rule.delete` | edit or delete `.claude/rules/<id>.md` |
| `agent.fork` | `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-agent-fork.cjs" <agent> [--as <newName>] "${CLAUDE_PROJECT_DIR:-.}"`. Prints one JSON line; on `ok:false` tell the user the `reason` and that `/agents` in the Maestro desktop app can fork it instead. |
| `rule.move` | `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-rules.cjs" move <id> --to <destination> [--scope-only] "${CLAUDE_PROJECT_DIR:-.}"` (`list` shows the rules, `unassign <id>` drops an assignment). On `ok:false` tell the user the `reason` and that `/rules` in the desktop app can do it instead. A row with no `destination` cannot be applied: ask the user. |
| `rule.to-agent` | add the rule's content to the named project agent's file under `## Project rules`, then delete the rule file |
| `handoff.edit` | edit `.claude/handoffs/<sender>/<receiver>.md` |
| `report.edit` | edit `.claude/reports/<id>.md`; if `reports` has no entry for the agent, add `{ "id": "<agent>" }` |
| `gate.change` | set `start_skills.maestro`, `start_skills.to_maestro_tasks`, `end_skills.maestro` (ordered skill ids) or `use_maestro_tasks` |
