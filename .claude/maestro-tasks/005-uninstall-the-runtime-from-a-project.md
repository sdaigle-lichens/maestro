# Uninstall the Maestro runtime from a project

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Step 5 of `docs/plans/m3-in-app-install.md`, plus its share of the install UI. Read that plan first.

Uninstall exists as a script today; the app should be able to do it, and the reason it is a
separate slice from install is that its risk profile is completely different — install writes
files the app owns, uninstall deletes files the *user* may have hours of work in.

**The two-level contract is the whole design and must be preserved.** The default removal takes out
the hooks and the ephemeral session files and **keeps `maestro.json`** — a user removing the
runtime has not asked to throw away their workflow and rule configuration. Only an explicit purge
also removes the orchestrator skill, the copied scripts, and the config itself. Collapsing these
two into one action, or defaulting to the destructive one, turns "I want to stop the hooks firing"
into silent data loss.

That contract has to survive into the UI, not just the underlying function. Purge is a separate,
clearly-labelled destructive action behind a confirmation that **names the files it will delete** —
a generic "are you sure?" is not informed consent when `maestro.json` is on the list.

Removing hooks is the mirror of registering them, and inherits the same trap: the project's
settings file may contain hooks and settings the app never put there, and uninstall must take out
only its own entries. A settings file that is emptied or clobbered on uninstall is a worse bug than
anything install can cause.

## Acceptance criteria

- [ ] Default uninstall removes the registered hooks and the ephemeral session files
- [ ] Default uninstall **keeps** `maestro.json` — workflow and rule configuration survives
- [ ] Purge additionally removes the orchestrator skill, the copied scripts, and the config, and is
      reachable only as a distinct action, never as the default
- [ ] The purge confirmation names the specific files that will be deleted before the user commits
- [ ] Hooks and settings the app did not add survive uninstall, including in a settings file the
      user has hand-edited
- [ ] After a default uninstall the hooks no longer fire in a real Claude session
- [ ] Uninstalling a project that has nothing installed is a no-op that says so, not an error or a
      partial write
- [ ] Install after uninstall returns the project to a working installation
- [ ] Both levels are covered by tests that assert what is left behind, not only what is removed

## Blocked by

- `004-install-and-update-the-runtime-from-the-app.md`
