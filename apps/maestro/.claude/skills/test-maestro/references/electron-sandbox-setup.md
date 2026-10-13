# The Electron sandbox on Linux

The app aborts on launch with *"The SUID sandbox helper binary was found, but is not configured
correctly."* when Electron has no way to sandbox its renderers. `pnpm --filter maestro dev` now
runs `apps/maestro/scripts/check-electron-sandbox.mjs` first and, when the sandbox cannot start,
prints the exact one-time command instead.

## Confirmed cause

The setuid bit is lost by a **`pnpm install` that re-resolves Electron**, not by a reboot. Each new
`node_modules/.pnpm/electron@<version>_…` store directory is a fresh extraction, and pnpm does not
preserve the setuid bit or root ownership on `chrome-sandbox`.

Evidence from the machine where it was reproduced:

- last boot 07:52, yet `chrome-sandbox` had mtime 09:25:18 — the dependency-bump install (commit
  `37d2702`, 09:26:56) that created `electron@40.10.6_supports-color@7.2.0`;
- the user re-applied chown/chmod at 10:50 (the file's ctime);
- the store is ext4, so it is not a filesystem that drops the bit.

The machine also has `kernel.apparmor_restrict_unprivileged_userns=1` (Ubuntu, AppArmor abi 5.0).
That is why the helper is needed at all: with unprivileged user namespaces blocked, the setuid
helper is the only sandbox left, so a missing bit is fatal.

## Permanent fix: an AppArmor profile (needs root once)

A profile whose path glob covers **every** `electron@*` store dir lets Electron use user namespaces
again, so a reinstall needs nothing. It is modelled on Ubuntu's `/etc/apparmor.d/slack` and
generated for this checkout (the path is repo-specific, so it is never hardcoded):

```bash
node apps/maestro/scripts/check-electron-sandbox.mjs
```

When the sandbox would fail, it writes the profile to a temp file and prints a line of the form:

```bash
sudo install -m 644 <tmpfile> /etc/apparmor.d/maestro-electron && sudo apparmor_parser -r /etc/apparmor.d/maestro-electron
```

This needs root, so hand it to the user to run — an agent never runs it. Re-run it once if the
repository is moved to a different path (the glob embeds the absolute repo root).

## Fallback: the setuid bit

Works without AppArmor, but must be **redone after any install that re-resolves Electron**:

```bash
sudo chown root:root node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox
```

Both `node_modules/electron` and `apps/maestro/node_modules/electron` symlink into the pnpm store,
so this deliberately fixes the **store copy**, not the links. Check it with
`ls -l node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox` — you want
`-rwsr-xr-x` and `root root`.

## The check script

`pnpm --filter maestro check:sandbox` (also run by `dev`, and so by `just dev` and the root
`pnpm dev`). It passes when any of these holds, and otherwise exits 1 with the commands above:

- not Linux, or Electron not installed;
- `apparmor_restrict_unprivileged_userns` is not `1` (user namespaces work);
- the resolved `chrome-sandbox` is `root`-owned with the setuid bit;
- a file in `/etc/apparmor.d/` contains this repo's Electron glob. Unreadable files are skipped.

It trusts that an installed profile is loaded; after `apparmor_parser -r` it is.
`build`, `test` and `start` are unaffected. The logic is unit-tested in
`test/electron-sandbox-check.test.ts`.

Confirm the sandbox is on: `pnpm --filter maestro dev` opens the window with no abort, and
`chrome://sandbox` inside the app reports the sandbox as enabled (or `ps` shows no `--no-sandbox`
among the `electron` renderer processes).

## Never `--no-sandbox`

Do **not** work around a failure with `--no-sandbox`: renderer isolation from the OS is the premise
`test/isolation.test.ts` spends four assertions defending.
