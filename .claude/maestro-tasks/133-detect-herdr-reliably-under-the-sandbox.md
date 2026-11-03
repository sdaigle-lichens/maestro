# Detect herdr reliably under the sandbox

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

maestro-update, maestro-install and maestro-manager decide whether herdr is installed with `command -v herdr`. Under the Bash sandbox, the herdr binary (e.g. ~/.local/bin/herdr) is hidden unless the project's allowRead lists it, so the check gives a false 'not installed'. Observed in a project whose sandbox lacked the herdr entries: maestro-update skipped the herdr opt-in question (so the --herdr allow-list entries were never offered), reported herdr as missing, and walked the user through an install they didn't need, while they were running inside herdr. Fix the detection in all three skills. A failed `command -v herdr` alone must never mean 'not installed'. Treat herdr as in use when any of these hold: HERDR_ENV=1; the allow-list script reports the herdr socket exists; a herdr entry is already in the project's sandbox settings. Note the allow-list script (maestro-sandbox-allow.cjs) is itself run inside the sandbox: its PATH lookup returned binary null in that same session, so adding more lookup directories to it does not fix this by itself. Have the script report the evidence it can see (socket present, HERDR_ENV, herdr entries already in settings) as fields of its herdr JSON, and have the skills read that instead of re-deriving it. Messages: when herdr is in use but its binary isn't visible, say 'herdr is running, but this project's sandbox can't see it' and give the exact apply command with --herdr; the current 'not installed' line is kept only when there is no evidence at all. The herdr opt-in question in update and install is offered whenever herdr is in use or its binary is found, not only when `command -v` succeeds. In maestro-manager's spawn checks, when HERDR_ENV=1 but `command -v herdr` fails, say herdr is installed but blocked by the sandbox and to run /maestro-update (which then offers --herdr), instead of the install guidance. Includes the three skill texts and the herdr install reference, the allow-list script and its tests, refreshing the tracked .claude/scripts mirror of that script if it has one, and a plugin version bump.

## Acceptance criteria

- [ ] No skill concludes 'herdr is not installed' from a failed `command -v herdr` alone; HERDR_ENV=1, a present herdr socket, or an existing herdr settings entry each count as herdr being in use
- [ ] maestro-sandbox-allow.cjs's herdr JSON reports the evidence it can see (socket present, HERDR_ENV, existing herdr settings entries), with tests for each case
- [ ] maestro-update and maestro-install offer the herdr opt-in whenever herdr is in use or found, and print the 'running but the sandbox can't see it' message with the --herdr apply command in that case
- [ ] maestro-manager tells the user to run /maestro-update when HERDR_ENV=1 but the binary is hidden, instead of install guidance
- [ ] Mirrors refreshed and the parity test passes, the plugin version is bumped (patch), and pnpm verify passes

## Blocked by

None — can start immediately
