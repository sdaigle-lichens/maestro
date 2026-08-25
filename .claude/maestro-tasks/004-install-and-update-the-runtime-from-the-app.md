# Install and update the Maestro runtime into a project from the app

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Steps 1–3 and the install half of step 6 of `docs/plans/m3-in-app-install.md`. Read that plan
first; this file records the decisions and the traps, not the whole design.

Today a project gets its Maestro runtime installed by a skill run inside a Claude session. The
desktop app already owns every other write to a project — it should own this one too. From an open
project the app reports what is installed, and installs or updates it in place.

The traps that make this more than a file copy:

**Hooks must be registered project-locally, not globally.** The runtime half of Maestro is a set of
hook scripts that fire inside a Claude session. Installing them means editing the project's own
settings, and an installer that reaches for the user's global configuration instead has quietly
changed the behaviour of every other repo on the machine. Merging into a settings file the user
also hand-edits means preserving what is already there — this is a merge, not a write.

**Reinstalling must be idempotent.** Running install twice should leave the project in the same
state as running it once — no duplicated hook entries, no growing arrays. This is the single
easiest thing to get wrong and the failure is invisible until a hook fires twice.

**Staleness is what makes "update" a meaningful word.** The app has to be able to say *this project
has an older runtime than the one I ship* — otherwise the button is just "install again" and the
user has no reason to press it. Decide what identity is compared (version, content hash, whatever
the plan settles on) and make the answer stable across machines rather than depending on file
timestamps.

The UI is the smaller half: install status for the open project, and an action that installs or
updates with a clear report of what changed on disk. It goes through the app's existing IPC and
error-surfacing conventions — a rejected call has to produce a message, not a spinner that never
stops.

## Acceptance criteria

- [ ] The app reports, for the open project, whether the Maestro runtime is installed and whether
      what is installed is older than what the app ships
- [ ] Installing into a project with no Maestro runtime produces a working installation: the hooks
      are registered in the project's own settings and fire in a real Claude session
- [ ] Installing over an existing installation is idempotent — no duplicated hook entries, and a
      second run reports nothing left to do
- [ ] Pre-existing content in the project's settings survives installation, including hooks and
      settings the app did not put there
- [ ] The user's global Claude configuration is not modified by installing into a project
- [ ] Updating a stale project brings it current and the staleness indicator clears
- [ ] Staleness is decided by something stable across machines and checkouts, not by file
      modification times
- [ ] A failed install surfaces the reason in the UI and leaves the project in a state the user can
      retry from, rather than half-written
- [ ] The install path is covered by tests that do not require a real Claude session

## Blocked by

None — can start immediately
