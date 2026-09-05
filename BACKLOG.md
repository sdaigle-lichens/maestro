# Backlog

Yes, any discovered agent, same list as the Tools tab. My intent is to decouple maestro from the fixed agent list and to make it usable by any agent on the user's computer

● Good — that confirms the scope. One consequence to flag as we go: this generalizes cleanly with what's already there, since MaestroInstanceV3.agent and the templates/handoffs/<sender>/<receiver>.md convention are already agent-name-agnostic (they key off the frontmatter name, not a fixed list). The one place Maestro does hard-code the 7-agent list is SKILL_TAGS (the skill-tagging feature) — that's a separate system and out of scope here, just flagging it so it's not confused with this effort.

---

- Settings to use or not maestro-tasks, add a field to maestro.json. Is set to true if user calls /to-maestro-tasks or checked in the app for the project. This will inject the related directive in the maestro skill template. Similar from the step 1 custom checks
- Add to the maestro skill template to step 4 to ask the user if he wants to run the maestro-post-mortem skill when the session failed to do a streamlined and clean job (e.g. major review fix needed or refactor or failed to complete the task given correctly without needing a hard steering from the user).
- Reuse the fork agent logic on agent description update in the app to add in the right panel a content tab where the full agent's content except for it's header can be edited as well

---

- .claude/skills/maestro-architecture/SKILL.md
- apps/maestro/.claude/skills/create-skills-architecture/SKILL.md
- apps/maestro/.claude/skills/workflow-view/SKILL.md
- .claude/skills/react-flow-canvas-geometry/SKILL.md

You can use the /grill-me skill to clarify the plan.
