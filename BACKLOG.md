# Backlog

Yes, any discovered agent, same list as the Tools tab. My intent is to decouple maestro from the fixed agent list and to make it usable by any agent on the user's computer

● Good — that confirms the scope. One consequence to flag as we go: this generalizes cleanly with what's already there, since MaestroInstanceV3.agent and the templates/handoffs/<sender>/<receiver>.md convention are already agent-name-agnostic (they key off the frontmatter name, not a fixed list). The one place Maestro does hard-code the 7-agent list is SKILL_TAGS (the skill-tagging feature) — that's a separate system and out of scope here, just flagging it so it's not confused with this effort.

---

---

- .claude/skills/maestro-architecture/SKILL.md
- apps/maestro/.claude/skills/create-skills-architecture/SKILL.md
- apps/maestro/.claude/skills/workflow-view/SKILL.md
- .claude/skills/react-flow-canvas-geometry/SKILL.md

You can use the /grill-me skill to clarify the plan.
