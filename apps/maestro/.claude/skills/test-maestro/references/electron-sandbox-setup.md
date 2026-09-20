# The Electron sandbox setuid bit

Needed once per install that re-extracts Electron. pnpm does not preserve the bit, and the app
aborts with *"The SUID sandbox helper binary was found, but is not configured correctly."*

This needs root, so hand it to the user to run:

```bash
sudo chown root:root node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox
```

Both `node_modules/electron` and `apps/maestro/node_modules/electron` symlink into the pnpm store,
so the commands above deliberately fix the **store copy**, not the links. (`gits/farel` documents
the same fix for an npm layout.)

Do **not** work around it with `--no-sandbox`: renderer isolation from the OS is the premise
`test/isolation.test.ts` spends four assertions defending. Check the bit with
`ls -l node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox` — you want
`-rwsr-xr-x` and `root root`.
