# Running Maestro under Claude Code's sandbox

Claude Code's Bash sandbox always refuses writes to `.claude/settings*.json`, `.claude/skills/`,
`.claude/hooks/` and most of `~/.claude`, even when `allowWrite` names them. A few Maestro commands
have to write there, or outside the project, so under the sandbox they fail with `EPERM` / `EROFS`
/ "Operation not permitted". Two ways through:

- **Run the failed command yourself** with `!` in front of it. It works every time, but you have to
  do it every time.
- **Let those exact commands run outside the sandbox** with `maestro-sandbox-allow.cjs`. It adds
  narrow `sandbox.excludedCommands` entries to this project's `.claude/settings.local.json`, so the
  commands work without a `!` from then on.

## What the script allows

| Command (exact text) | Why it needs to leave the sandbox |
| --- | --- |
| `node .claude/scripts/maestro-render-orchestrator.cjs` (and `… .`) | rewrites the handoff table in `.claude/skills/maestro/SKILL.md` |
| `node .claude/scripts/maestro-task-status.cjs worktree *` | creates a task worktree beside the project (`<repo>-task-N`) |
| `node .claude/scripts/maestro-task-status.cjs freeform-check *` | same, for a freeform run while another session is live |
| `node .claude/scripts/maestro-task-status.cjs merge *` | merges a finished worktree back, which can touch protected paths |
| `node <plugin root>/scripts/maestro-install.js *` | `/maestro-install` and `/maestro-update`: writes the hooks into `.claude/settings.json` and the orchestrator skill |

An entry with no `*` matches only that exact text. A trailing ` *` allows any arguments to that
one subcommand, and nothing else. Every command in a chained call (`&&`, `;`) has to match an
entry on its own, and a call with `cd`, a redirect or `$(...)` stays sandboxed as a whole. Excluded
commands still go through the normal permission prompts.

It also adds two guards, because an excluded command is only as safe as the file it runs:

- `sandbox.filesystem.denyWrite` on the project's `.claude/scripts/`, so a sandboxed command
  cannot rewrite `maestro-render-orchestrator.cjs` and then run its own code outside the sandbox.
- `permissions.deny` `Edit(/.claude/scripts/**)`, the same guard for Claude's Edit and Write tools,
  which the sandbox does not cover.

`/maestro-install` and `/maestro-update` still refresh those scripts: they run excluded, outside
the sandbox. If you copy files into `.claude/scripts/` by hand, run the copy with `!`.

**The installer entry carries the plugin version in its path.** After each maestro plugin update,
`/maestro-update` notices that it no longer matches and asks you to re-run `--apply`, which
replaces the old entry.

## The herdr opt-in (`--herdr`), a sandbox escape

The default list never includes herdr. `/maestro-manager` talks to herdr over its socket, and
`herdr pane run` runs any command it is given, so letting the sandbox reach that socket lets **any**
sandboxed command run anything outside the sandbox. Only add it if you accept that. Without it, the
manager prints the `claude -n …` commands for you to run.

`--herdr` adds, with absolute paths:

| Entry | Added when | Why |
| --- | --- | --- |
| `sandbox.filesystem.allowWrite`: `$HOME/.config/herdr/herdr.sock` | always | connecting to a Unix socket needs write access to it |
| `sandbox.filesystem.allowRead`: the herdr binary | `command -v herdr` resolves under `$HOME` | the Linux sandbox hides your home directory; the binary only, never its directory |
| `sandbox.network.allowUnixSockets`: the socket | your settings do not already set `sandbox.network.allowAllUnixSockets: true` | Claude Code honours this list on macOS only; on Linux only `allowAllUnixSockets` opens Unix sockets |

The herdr CLI's socket commands read nothing else under `~/.config/herdr`, so nothing more is
added. `/maestro-install` and `/maestro-update` offer the opt-in when herdr is in use (`HERDR_ENV=1`, its socket exists, or a herdr entry is already in your settings) or on your `PATH`,
defaulting to No. `--remove --herdr` takes out only the herdr entries; a plain `--remove` takes out
everything, herdr included, and a plain `--apply` leaves herdr entries alone.

## Running it

The script only writes when you pass `--apply` or `--remove`, and only to
`.claude/settings.local.json`. That file is personal and never committed, which is right here:
the plugin path differs on every machine. It keeps every key it did not add, and recognises its
own entries by their exact text. An entry you wrote yourself is never changed or removed.

```bash
node <plugin root>/scripts/maestro-sandbox-allow.cjs .                      # preview, writes nothing
! node <plugin root>/scripts/maestro-sandbox-allow.cjs <project> --apply     # add or refresh
! node <plugin root>/scripts/maestro-sandbox-allow.cjs <project> --remove    # take them all out
! node <plugin root>/scripts/maestro-sandbox-allow.cjs <project> --apply --herdr   # also the herdr opt-in
```

The preview prints one JSON object. `added` and `removed` are what `--apply` would change,
`upToDate` is true when there is nothing to do, `entries` lists every entry with its reason, and
`applyCommand` is the exact command to run. `broadEntries` lists any wide pattern already in the
file, such as the `node *maestro-install.js*` an older `/maestro-update` suggested. The script
leaves those alone, since you wrote them, but you can delete them once the narrow entries are in.

The skills never run `--apply` or `--remove` themselves. A sandboxed command cannot write settings
files, and the choice of what runs outside the sandbox is yours.
