# Setting up herdr for Maestro epics

herdr is optional. Maestro works without it; with it, `/maestro-manager` can start an epic's worker
sessions for you.

## What herdr is and why Maestro uses it

[herdr](https://herdr.dev) is a terminal runtime for coding agents. It runs several agent sessions
side by side in tabs and panes inside your terminal, keeps them running when you detach, and shows
in a sidebar which sessions are working, **blocked** (waiting for you), done or idle.

An epic runs several `/maestro` sessions at once, one per task. Without herdr you open each one by
hand. With herdr, the `maestro-manager` session opens one herdr tab per ready task (up to 5 at a
time), named after the worker session, and starts `claude -n <name> '/maestro <task.md>'` in it. You
then watch herdr's sidebar for the sessions that need you.

The manager never approves anything for a worker. Each worker's permission prompts and human-review
stops stay in that worker's own pane, and you answer them there.

## 1. Install herdr

These commands change things outside this project (a binary on your PATH), so **run them yourself**
by typing them at the Claude prompt with a leading `!`, or in your own terminal. Claude does not run
them for you.

Pick one:

```bash
! curl -fsSL https://herdr.dev/install.sh | sh     # macOS or Linux
! brew install herdr                               # Homebrew
```

Other options (Nix, a release binary, Windows beta) are on <https://herdr.dev/docs/install/>.
Check it worked with `! herdr --version`.

## 2. Install herdr's Claude Code integration

```bash
! herdr integration install claude
```

This also changes files outside the project (your Claude Code hook settings), so run it yourself
with `!` too. It makes Claude Code report its state to herdr directly. herdr can also detect Claude
Code from its screen without it, but less reliably.

## 3. Let the sandbox reach herdr's socket

The manager drives herdr through its CLI (`herdr tab create`, `herdr pane run`), which talks to the
herdr server over a Unix socket at `~/.config/herdr/herdr.sock`. If Claude Code's Bash sandbox is
on, it blocks that socket, and the manager falls back to printing the launch commands for you to run.

**Letting the sandbox reach this socket is a sandbox escape.** `herdr pane run` runs any command it
is given outside the sandbox, so once the socket is reachable, any sandboxed command can run
anything unsandboxed. Leave it blocked unless you accept that.

The simplest way is the allow-list script's opt-in, which `/maestro-install` and `/maestro-update`
offer when herdr is in use (`HERDR_ENV=1`, its socket exists, or a herdr entry is already in your
sandbox settings) or its binary is found: it writes the entries below into this project's
`.claude/settings.local.json`, with absolute paths, and `--remove --herdr` takes them out again.
See [`sandbox.md`](sandbox.md#the-herdr-opt-in---herdr-a-sandbox-escape):

```bash
! node <plugin root>/scripts/maestro-sandbox-allow.cjs <project> --apply --herdr
```

To do it by hand instead, add the socket to your **user** settings (`~/.claude/settings.json`), not
the project's, because the path is in your home directory. Edit the file yourself:

```json
{
  "sandbox": {
    "network": {
      "allowUnixSockets": ["~/.config/herdr/herdr.sock"]
    }
  }
}
```

If `sandbox.network.allowAllUnixSockets` is already `true` in your settings, you don't need this
`allowUnixSockets` entry. Claude Code honours `allowUnixSockets` on macOS only; on Linux its
seccomp filter blocks every Unix socket unless `allowAllUnixSockets` is `true` (or the filter is
not installed).

On Linux, if your sandbox also hides your home directory, add two more entries:

- **The herdr binary itself**, to `sandbox.filesystem.allowRead`. Without it, `command -v herdr`
  finds nothing inside the sandbox and the manager falls back. A failed `command -v herdr` there
  does not mean herdr is not installed: when you are running inside herdr (`HERDR_ENV=1`),
  `/maestro-update` says *"herdr is running, but this project's sandbox can't see it"* and gives the
  `--herdr` command instead of install steps. Add just the binary, not the whole
  directory it is in, for example `"allowRead": ["~/.local/bin/herdr"]` (use the path that
  `! command -v herdr` prints).
- **The socket**, to `sandbox.filesystem.allowWrite`: `"allowWrite": ["~/.config/herdr/herdr.sock"]`.
  Connecting to a socket needs write access to it.

```json
{
  "sandbox": {
    "filesystem": {
      "allowRead": ["~/.local/bin/herdr"],
      "allowWrite": ["~/.config/herdr/herdr.sock"]
    }
  }
}
```

Settings lists merge across files, so these add to any entries you already have.

To check the manager will see the server, `herdr status server` must print `status: running`. It
exits 0 even when the server is down, so read the output rather than the exit code.

## 4. Use it

1. Start herdr by running `herdr` in your terminal.
2. Start Claude Code in a herdr pane.
3. Run `/maestro-manager` from that Claude session.

The manager must run **inside** herdr. herdr sets `HERDR_ENV=1` in each pane it manages, and the
manager checks for it, because herdr's own guidance says never to control a herdr session from
outside herdr. When you run `/maestro-manager` in a Claude session started anywhere else, the manager
doesn't spawn anything, even if the herdr server is running. It prints the launch commands instead.

When an epic has ready tasks, the manager offers to spawn them. Each worker gets its own tab in the
manager's workspace (`herdr tab create --workspace "$HERDR_WORKSPACE_ID"`), labelled with the
worker's session name. To skip herdr for one epic, tell the manager so: it prints the
`claude -n ...` commands for you to run instead.

## If herdr is missing, unreachable or not around the manager

Nothing fails. This covers herdr not being installed, the server not running, the sandbox blocking
the socket, and the manager running outside herdr. In each case the manager prints the exact command
for each ready task, for example:

```bash
claude -n 'billing-007' '/maestro .claude/maestro-tasks/007-add-invoices.md'
```

Run each one in its own terminal, from the project's root.
