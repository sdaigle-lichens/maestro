# Configurable model for epic worker sessions

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

When maestro-manager spawns or suggests a worker session for an epic task, the launch command (`claude -n '<worker>' '/maestro <task.md>'`) starts on the user's default Claude Code model, so a manager run on Opus spawns every worker on Opus. Add an optional project setting in .claude/maestro.json naming the model worker sessions launch with (an alias like sonnet, opus or haiku, or a full model id). When it is set, every worker launch command the epic tooling prints (the `ready` listing that herdr spawning and the no-herdr fallback both use) includes `--model <value>`, correctly shell-quoted. When it is unset, the command is exactly what it is today. The setting is readable and editable in the desktop app wherever project-level Maestro settings are edited, survives a save round-trip of maestro.json, and is documented in the maestro-manager skill (where workers are spawned) and wherever maestro.json fields are described for users. Includes the config type and its validation, the launch-command builder and the regenerated plugin libs and tracked mirrors, the app settings UI, the skill text, tests, and a plugin version bump.

## Acceptance criteria

- [ ] With the setting unset, the launch command `ready` prints is unchanged
- [ ] With the setting set to e.g. sonnet, every printed launch command includes `--model sonnet`, and a value with shell-special characters is quoted safely
- [ ] The setting can be viewed and changed in the desktop app and survives saving and reloading maestro.json
- [ ] The maestro-manager skill mentions the setting where workers are spawned
- [ ] Tests cover the unset and set cases; libs rebuilt, mirrors refreshed, parity test passes, plugin version bumped (patch), pnpm verify passes

## Blocked by

None — can start immediately
