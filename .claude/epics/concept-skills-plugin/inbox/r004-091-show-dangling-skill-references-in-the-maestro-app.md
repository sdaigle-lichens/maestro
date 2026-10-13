# Report r004: 091-show-dangling-skill-references-in-the-maestro-app.md

- Task: 091-show-dangling-skill-references-in-the-maestro-app.md
- Written: 2026-10-13T15:24:38.711Z
- From session: maestro-42

Task 091 is done. All criteria are met, including the running-window check: the CDP probe passes 11/11 and pnpm verify passes (1843 tests).

Loop-back: the window probe found that Recheck disappeared once the report was clean, so refresh on demand was unreachable. Fixed with an always-visible "Recheck skills" control plus a debounced refresh on window focus/visibilitychange, then re-tested and re-reviewed.

Post-mortem notes are in the task file: the gap went unnoticed until a real window could be driven; the chrome-sandbox setuid bit is lost whenever Electron is re-extracted (permanent fix is the user's separate ticket).

Known, not implemented: a dangling skill inside a collapsed plugin group has no indicator on the group header. Reviewer nit: the checking state and click handler are duplicated between SkillRefRecheck and SkillRefNotice.
