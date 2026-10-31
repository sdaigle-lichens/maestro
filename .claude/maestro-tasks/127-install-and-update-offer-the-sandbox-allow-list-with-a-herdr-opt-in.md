# Install and update offer the sandbox allow-list, with a herdr opt-in

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Make maestro-install and maestro-update offer the Maestro sandbox allow-list built by the existing maestro-sandbox-allow script. Its dry run (`node ${CLAUDE_PLUGIN_ROOT}/scripts/maestro-sandbox-allow.cjs .`) prints JSON with `upToDate`, `entries` (each with `kind`, `value`, `why`), `sandboxEnabled`, `applyCommand` and `removeCommand`; `--apply` merges the entries into .claude/settings.local.json and `--remove` takes them out. Both skills run the dry run and, when `upToDate` is false and `sandboxEnabled` is not false, show each entry with its `why`, point to the sandbox reference file next to the herdr install guide, and ask the user to run `! <applyCommand>` themselves, because a sandboxed command can never write settings files; they never run `--apply`. Switch both skills' maestro-install.js invocations to the unquoted form `node ${CLAUDE_PLUGIN_ROOT}/scripts/maestro-install.js . ...`: the allow-list's excludedCommands entry matches the literal command text, so the current quoted `${CLAUDE_SKILL_DIR}/../..` form in install and the quoted form in update never match it. Replace maestro-update's Notes line suggesting `node *maestro-install.js*` / `node *maestro-render-orchestrator.cjs*` exclusions with a pointer to the sandbox reference. Separately, add an explicit herdr opt-in so maestro-manager can spawn workers by itself: a script flag that adds the herdr socket entries and that `--remove` also takes out. It always adds herdr's socket (~/.config/herdr/herdr.sock) to `sandbox.filesystem.allowWrite`, and the herdr binary itself (wherever `command -v herdr` resolves under $HOME, e.g. ~/.local/bin/herdr; the binary only, never its directory) to `sandbox.filesystem.allowRead`, because on Linux the sandbox hides it otherwise (found in task 125); it adds the socket to `sandbox.network.allowUnixSockets` only when the effective settings don't already set `sandbox.network.allowAllUnixSockets: true` (common on Linux kernels where bubblewrap's seccomp filter can't apply), and `--remove` removes only what the flag added. The default allow-list stays herdr-free. The skills offer the opt-in only when herdr is on PATH, default it to No, and state plainly that it is a sandbox escape: any sandboxed command can then run anything unsandboxed through `herdr pane run`. Without it the manager keeps printing `claude -n ...` launch commands. Verify, rather than assume, whether `~` expands in `allowUnixSockets` and `allowWrite` (write an absolute path if not) and whether the herdr CLI needs to read anything under ~/.config/herdr besides the socket. Add to the herdr install guide that its manual socket entry is a sandbox escape and point it at the opt-in. This includes script code with tests for the herdr flag (dry run, apply, remove, and its absence by default), skill and reference-file changes, and a patch bump of the maestro plugin version to the next free patch at commit time.

## Acceptance criteria

- [ ] maestro-install and maestro-update run the sandbox allow-list dry run and, when it is not up to date and the sandbox is enabled, show each entry with its reason, point to the sandbox reference, and ask the user to run the printed apply command with `!`; neither runs `--apply` itself
- [ ] Both skills invoke maestro-install.js in the unquoted `node ${CLAUDE_PLUGIN_ROOT}/scripts/maestro-install.js . ...` form that the allow-list's excludedCommands entry matches
- [ ] maestro-update's Notes no longer suggest broad `node *maestro-install.js*` / `node *maestro-render-orchestrator.cjs*` exclusions and point to the sandbox reference instead
- [ ] The default allow-list contains no herdr entry
- [ ] A herdr opt-in flag adds herdr's socket to allowWrite, and to allowUnixSockets only when allowAllUnixSockets isn't already true; `--remove` removes only what it added; tests cover dry run, apply, remove, both allowAllUnixSockets cases and the default without herdr
- [ ] The skills offer the herdr opt-in only when herdr is on PATH, default it to No, and state that it is a sandbox escape
- [ ] Whether `~` expands in those sandbox fields, and whether the herdr CLI needs more than its socket, is checked and the written entries reflect the result
- [ ] The herdr install guide says its socket entry is a sandbox escape and points at the opt-in
- [ ] The maestro plugin's plugin.json version gets a patch bump to the next free patch

## Blocked by

- `125-manager-spawns-worker-sessions-in-herdr.md`

Branch `feat/sandbox-allow-list` (maestro-sandbox-allow.cjs and the sandbox reference) is merged
into feat/use-code-graph (`2c95bae`), at plugin 0.12.9. This task bumps to 0.12.10, in plugin.json
and `.claude/maestro.json` runtimeVersion, unless a later merge has taken it.
