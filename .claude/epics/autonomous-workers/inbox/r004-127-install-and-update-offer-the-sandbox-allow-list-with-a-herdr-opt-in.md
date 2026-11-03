# Report r004: 127-install-and-update-offer-the-sandbox-allow-list-with-a-herdr-opt-in.md

- Task: 127-install-and-update-offer-the-sandbox-allow-list-with-a-herdr-opt-in.md
- Written: 2026-10-24T16:08:30.960Z
- From session: autonomous-workers-127

## Outcome

Task 127 done (Backend workflow, approved at human review), uncommitted in the main checkout on feat/use-code-graph. Plugin bumped to 0.12.10 (plugin.json and .claude/maestro.json runtimeVersion).

- maestro-sandbox-allow.cjs gained `--herdr`: socket into sandbox.filesystem.allowWrite, the herdr binary (only when under HOME) into allowRead, the socket into sandbox.network.allowUnixSockets only when the effective allowAllUnixSockets is not true. `--remove --herdr` removes only those; plain `--remove` removes everything. Default list stays herdr-free. All paths absolute.
- maestro-install (new step 5) and maestro-update (new step 6) run the dry run, list entries with reasons, point to references/sandbox.md and ask the user to run `! <applyCommand>`; never `--apply`. The herdr opt-in is offered only when herdr is on PATH, defaults to No, and is called a sandbox escape.
- Both skills call maestro-install.js unquoted as `node ${CLAUDE_PLUGIN_ROOT}/scripts/maestro-install.js . ...`.
- herdr.md and sandbox.md describe the socket entry as a sandbox escape and point to the opt-in.
- 15 new tests in apps/maestro/test/core/sandbox-allow-script.test.ts; full suite 2199/2199, lint and check green.

## Findings

- `~` expands in allowWrite/allowRead (seen in the live effective sandbox config). For allowUnixSockets the docs say it expands, but Claude Code honours that list on macOS only, so it is untestable on Linux; on Linux only allowAllUnixSockets opens sockets.
- strace of read-only herdr commands (0.9.5) shows only the binary exec and a connect() to the socket; nothing else under ~/.config/herdr. State-changing commands (pane run, tab create) were not traced.

## Post-mortem

None (clean session).

## Suggested ticket changes (follow-ups)

- maestro-update runs the installer (step 1) before offering the allow-list (step 6); after a plugin update the stale installer exclusion can make step 1 hit EPERM first. Consider moving the allow-list offer earlier, as install now does.
- The herdr question is re-asked after every plugin version change because it is skipped only when the whole `--herdr` run is upToDate. Check only herdr kinds in `added` instead.
- Untested: a herdr symlink under HOME pointing outside HOME (path.resolve, not realpath); an unparseable project or user settings.json while reading allowAllUnixSockets.
