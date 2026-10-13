# Make the Electron sandbox setup survive reboots and reinstalls

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

On this Linux dev machine the Maestro desktop app aborts on launch with "The SUID sandbox helper binary was found, but is not configured correctly": Electron's `chrome-sandbox` in the pnpm store loses its root ownership and setuid bit. The test-maestro skill's electron-sandbox-setup reference documents a manual `sudo chown root:root` + `sudo chmod 4755` on the store copy, but the user reports having to redo it after every power-on, and it blocked task 091's running-window check. Why it recurs is not confirmed: the reference says only that a re-extracting install drops the bit, so something is re-extracting or resetting the store copy (a pnpm install, a postinstall, the dev command, a store on a filesystem that doesn't keep the bit) — or the setuid helper is the wrong fix for this machine (recent Ubuntu restricts unprivileged user namespaces through AppArmor, which an AppArmor profile for the Electron binary would allow instead).

First find and state the actual cause, reproducing it (reboot, `pnpm install`, `just dev`/the dev script) and checking the bit before and after each. Then make the fix permanent for that cause, in the narrowest form that needs root at most once: for example an AppArmor profile scoped to the pnpm Electron path, or a check that runs before the app starts and prints the exact one-time command when the bit is missing, plus a narrowly scoped sudoers rule only if nothing narrower works. Never fall back to `--no-sandbox` — renderer isolation from the OS is what `test/isolation.test.ts` defends. Anything needing root is handed to the user as an exact command, never run by an agent. Update the electron-sandbox-setup reference with the confirmed cause and the permanent fix.

## Acceptance criteria

- [ ] The cause of the recurrence is identified and written down, with the reproduction that confirmed it
- [ ] After the one-time setup, the app launches with the sandbox enabled across a reboot and after a pnpm install, without re-running chown/chmod
- [ ] When the setup is missing, starting the app (or the dev command) says so and prints the exact one-time command, instead of only the Electron abort
- [ ] No --no-sandbox flag anywhere, and test/isolation.test.ts still passes
- [ ] Any root step is handed to the user as an exact command; no agent runs sudo
- [ ] The test-maestro electron-sandbox-setup reference describes the confirmed cause and the permanent fix
- [ ] pnpm verify passes

## Blocked by

None — can start immediately
