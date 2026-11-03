# Sandbox allow-list offer: run it before the update installer and stop re-asking the herdr opt-in

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Follow-up to task 127's sandbox allow-list step in maestro-install and maestro-update, covering skill changes, script code in the maestro-sandbox-allow script, and tests. (1) maestro-update offers the allow-list only after its installer step, so right after a plugin update a stale installer exclusion (its path carries the old plugin version) can make the installer fail on a sandbox write before the user is ever offered the fix; move the offer ahead of the installer, as maestro-install already does, and keep the rule that the user runs the apply command with `!` themselves. (2) The herdr opt-in question is re-asked after every plugin version change because it is skipped only when the whole `--herdr` dry run is up to date; decide from the herdr entries alone, so a user who already has them is not asked again. (3) A herdr entry written by hand with `~` (for example `~/.config/herdr/herdr.sock` in allowWrite, `~/.local/bin/herdr` in allowRead) must count as present: treat the `~` form and the absolute form under HOME as the same entry when deciding what to add, so `--apply --herdr` never writes a duplicate and the skills never offer the opt-in to a user who already has it. Hand-written entries are never removed by `--remove`; only what the script itself wrote is. (4) Add the tests task 127 left out: a herdr binary that is a symlink under HOME pointing outside HOME, and an unparseable project or user settings file while reading allowAllUnixSockets (the script must report it clearly rather than crash or guess). Bump the maestro plugin version to the next free patch at commit time, in plugin.json and `.claude/maestro.json` runtimeVersion.

## Acceptance criteria

- [ ] maestro-update offers the sandbox allow-list before running the installer, and still never runs --apply itself
- [ ] The herdr opt-in is not asked again after a plugin version change when the herdr entries are already present
- [ ] Hand-written `~` herdr entries count as present: the dry run adds no herdr entry for them, --apply --herdr writes no duplicate, and --remove leaves them in place; covered by tests
- [ ] Tests cover a herdr symlink under HOME that points outside HOME, and an unparseable project or user settings file while reading allowAllUnixSockets
- [ ] The maestro plugin version gets a patch bump to the next free patch in plugin.json and .claude/maestro.json runtimeVersion

## Blocked by

None — can start immediately
