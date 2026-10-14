# Report r008: 096-never-overwrite-or-crash-on-a-corrupt-or-unsupported-maestro-json-during-install.md

- Task: 096-never-overwrite-or-crash-on-a-corrupt-or-unsupported-maestro-json-during-install.md
- Written: 2026-10-13T16:35:33.030Z
- From session: maestro-a2

Task 096 done. Both install paths refuse an unparseable or non-v3 maestro.json via shared maestroConfigRefusal; result card shows the refusal and has render tests. Reviewer looped back once for a prettier failure in plugins/maestro/scripts/maestro-install.js (pnpm verify never prettier-checks plugins/). Known edge: unreadable maestro.json (e.g. a directory) makes the app's installRuntime throw, while the plugin refuses cleanly.
