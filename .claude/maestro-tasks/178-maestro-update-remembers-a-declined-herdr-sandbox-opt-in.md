# maestro-update remembers a declined herdr sandbox opt-in

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Every /maestro-update run in a project where herdr is in use asks again whether to add the herdr sandbox entries ("Also let /maestro-manager start worker sessions in herdr by itself? This is a sandbox escape ..."), even after the user answered No. Make a No stick: record the decline per project so later updates don't ask again, and say in one line that the opt-in was declined earlier and how to take it (a flag or a re-ask option). Ask again only when the user asks for it, or when what the question is about changes (for example the herdr entries the opt-in would add change). A Yes still adds the entries exactly as today, and the default answer stays No.

The record is project-local state the update flow writes, not a sandbox setting, and it never grants anything. Choose where it lives (for example maestro.json or another project-local file the update flow already owns) so a fresh clone or a purge-and-reinstall behaves sensibly; say in the code which one and why.

Also check, and fix if real: the update skill says the whole sandbox step, the herdr opt-in included, is skipped silently when the sandbox is disabled, yet the question was asked in this repo while its settings.local.json had the sandbox disabled (assumed, unverified: the check may read a different settings file or the merged settings).

This needs code in the sandbox-allow script or its TypeScript source (and its generated or mirrored copies), the maestro-update skill text, tests, and a plugin version bump.

## Acceptance criteria

- [ ] After the user answers No to the herdr opt-in, the next /maestro-update run in that project does not ask it again and says in one line that it was declined earlier and how to opt in
- [ ] The user can still opt in later without editing files by hand (a documented flag or answer), and a Yes adds the same herdr entries as today
- [ ] The question is asked again when the herdr entries it would add change
- [ ] The decline record never adds or changes any sandbox or permission setting
- [ ] The sandbox-disabled skip is verified: with the sandbox disabled in the project's effective settings, the herdr opt-in is not asked; if it was asked because of a bug, that bug is fixed
- [ ] Tests cover: decline recorded, no re-ask on the next run, re-ask on a changed entry set, explicit opt-in after a decline, and the sandbox-disabled skip; the full suite is green
- [ ] plugins/maestro/.claude-plugin/plugin.json gets a patch bump, and generated libs and .claude/scripts mirrors are refreshed (the user runs `pnpm refresh:runtime`)

## Touched surfaces

- plugins/maestro/scripts/maestro-sandbox-allow.cjs (or its TypeScript source and generated copy)
- plugins/maestro/skills/maestro-update/SKILL.md
- .claude/scripts mirrors
- plugins/maestro/.claude-plugin/plugin.json (version, patch; shared with the containerized-workers epic's task 177, so merge order: after 177 or rebase on it)

## Blocked by

None — can start immediately
