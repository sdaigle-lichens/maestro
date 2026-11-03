# Report r005: 129-sandbox-allow-list-offer-run-it-before-the-update-installer-and-stop-re-asking-the-herdr-opt-in.md

- Task: 129-sandbox-allow-list-offer-run-it-before-the-update-installer-and-stop-re-asking-the-herdr-opt-in.md
- Written: 2026-10-24T18:53:17.383Z
- From session: autonomous-workers-129

Outcome: task 129 done, all five acceptance criteria met. Changes are uncommitted; the plugin is bumped to 0.12.11 in plugin.json and .claude/maestro.json runtimeVersion.

Findings:
- maestro-update now offers the sandbox allow-list as step 1, before the installer. It still never runs --apply itself.
- The dry run now prints `herdr.present`. Both skills decide the herdr opt-in from that field alone, so a plugin update no longer re-asks.
- `~` herdr entries and absolute-under-HOME entries count as the same entry. --apply --herdr writes no duplicate, and --remove leaves hand-written entries.
- An unparseable project or user settings file is reported in `herdr.unparseableSettings`. allowAllUnixSockets is read as unset from it and the script exits 0. The skills tell the user which files don't parse.
- New tests cover `~` entries, a herdr symlink under HOME pointing outside HOME, and unparseable settings.
- Gates: full maestro test 2204 passed, typecheck, lint, check and parity all pass. The reviewer passed it.

Notes: the skill step order in maestro-update is prose and untested. The scribe ended HANDOFF: partial because it is read-only on plugins/, so @backend made the two follow-up skill edits instead. Only check and lint were re-run after those edits.

Suggested ticket changes: none.
