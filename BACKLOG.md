# Backlog

Yes, any discovered agent, same list as the Tools tab. My intent is to decouple maestro from the fixed agent list and to make it usable by any agent on the user's computer

● Good — that confirms the scope. One consequence to flag as we go: this generalizes cleanly with what's already there, since MaestroInstanceV3.agent and the templates/handoffs/<sender>/<receiver>.md convention are already agent-name-agnostic (they key off the frontmatter name, not a fixed list). The one place Maestro does hard-code the 7-agent list is SKILL_TAGS (the skill-tagging feature) — that's a separate system and out of scope here, just flagging it so it's not confused with this effort.

I want to make maestro runtime agent agnostic. In other terms, my intent is to decouple maestro's runtime from the fixed agent list and to make it usable by any agent on the user's computer. The agents shipped with maestro in the marketplace/plugin (backend, frontend, mobile, refactor, reviewer, scribe, test) are simply there to get the user started. But maestro should be usable even without the agents from the plugin. Are there places in the runtime scripts where agents from maestro are still hardcoded that should be removed ? I understand that for installation, uninstallation and update scripts and skills, the hardcoded agents part can be kept since we want them installed and updated so they stay relevant. A previous session flagged that the one place Maestro does hard-code the 7-agent list is SKILL_TAGS (the skill-tagging feature). I don't know it this is still true.

---

- Settings to use or not maestro-tasks, add a field to maestro.json. Is set to true if user calls /to-maestro-tasks or checked in the app for the project. This will inject the related directive in the maestro skill template. Similar from the step 1 custom checks
- Add to the maestro skill template to step 4 to ask the user if he wants to run the maestro-post-mortem skill when the session failed to do a streamlined and clean job (e.g. major review fix needed or refactor or failed to complete the task given correctly without needing a hard steering from the user).
- Reuse the fork agent logic on agent description update in the app to add in the right panel a content tab where the full agent's content except for it's header can be edited as well

- Update the to be and go through the list of concepts skill and read the relevants one to understand correctly the task at hand

---
