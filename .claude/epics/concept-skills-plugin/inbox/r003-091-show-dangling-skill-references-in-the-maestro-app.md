# Report r003: 091-show-dangling-skill-references-in-the-maestro-app.md

- Task: 091-show-dangling-skill-references-in-the-maestro-app.md
- Written: 2026-10-13T14:51:15.298Z
- From session: maestro-42

Task 091 (dangling skill references in the Maestro app): implemented and reviewed; pnpm verify passed (1838 tests) before the final doc edits.

Recurring environment problem: Electron's chrome-sandbox loses root ownership / the setuid bit (needs `sudo chown root:root` + `sudo chmod 4755` on node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox) after Electron is re-extracted, so the app aborts on launch and the running-window check (test-maestro) cannot run. The user reports it recurs every time they power on their PC; the bit was correct after a manual fix today. Cause of the recurrence is not confirmed.

Suggested ticket: make the sandbox fix permanent (e.g. a narrowly scoped sudoers rule plus a `just`/postinstall step, or an AppArmor profile for the pnpm Electron path) and document it in test-maestro's electron-sandbox-setup.md.
