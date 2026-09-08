# Backlog

The maestro skill template already uses script injected sections. I would like to add a new one in step 4. The `/to-maestro-tasks` call should only be displayed in the skill if, in the app's project setting the new options "Use maestro tasks" is checked. This will inject the related directive in the maestro skill template, similarly from the step 1 custom checks. The option can be saved in the `.claude/maestro.json` file and the script can read it. When a user calls /to-maestro-tasks, the option can also be set to true automatically by a small script in `/to-maestro-tasks` that fires on the skill call.

With this condition, step 4 can potentially do nothing in to maestro task is unused. However, I want you to also add to step 4 instructions to ask the user if he wants to run the maestro-post-mortem skill. The user should be prompted only when the session failed to do a streamlined and clean job (e.g. major review fix needed or refactor or failed to complete the task given correctly without needing a hard steering from the user). Keep the instructions short and clear.

Note: I do not need any migration steps for this task, maestro is not currently used in any project where I don't already want to uninstall and reinstall it.

---
