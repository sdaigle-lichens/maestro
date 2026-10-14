# Report r010: 093-make-the-electron-sandbox-setup-survive-reboots-and-reinstalls.md

- Task: 093-make-the-electron-sandbox-setup-survive-reboots-and-reinstalls.md
- Written: 2026-10-13T17:33:27.765Z
- From session: a49b0c17

Task 093 (Electron sandbox setup survives reboots and reinstalls): done, uncommitted.

Outcome: cause confirmed as a pnpm install that re-resolves Electron creating a fresh store dir without the setuid bit (not a reboot). Fix: AppArmor profile with a glob over every electron@* store dir (user installed it and verified the app launches with the bit removed), plus apps/maestro/scripts/check-electron-sandbox.mjs, a preflight wired into `dev` that prints the exact one-time command when setup is missing. Reference electron-sandbox-setup.md rewritten. No --no-sandbox; isolation.test.ts and pnpm verify pass. Reboot and fresh-install survival not tested end to end.

Findings (non-blocking): profile detection is a substring match on the glob (an unloaded or commented-out profile file counts as installed); /etc/apparmor.d and the sysctl path are hardcoded; the profile embeds the absolute repo root, so a moved checkout needs it regenerated; Debian-style unprivileged_userns_clone=0 is not handled.

Post-mortem notes: none written, the session went cleanly. Minor: the relayed one-liner used $TMPDIR, which is unset in the user's `!` shell; corrected to /tmp. The @scribe subagent ended without a HANDOFF line.

Suggested ticket change: optionally a follow-up to make the profile check stricter (verify the profile is loaded, not just present).
