# Reviewing a forked agent that has fallen behind its template

A fork is a project-local copy of a `user`- or plugin-tier agent (`/agents` → "Fork into this
project"). It goes stale when the template improves. For each agent `list` named, show the user
what is at stake and let them decide — never decide for them:

```bash
node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/maestro-agent-forks.cjs" diff <agent>
```

That prints the fork's description beside the template's (they drift: a fork syncs its **body**
while its description stays the user's), then the body diff — exactly what taking the update would
change. Apply their answer one agent at a time:

- `update <agent>` — take the template's new body, keep this fork's own name and description.
- `keep <agent>` — change nothing, and don't ask again until the template moves on.
- `detach <agent>` — drop the provenance record. The file stays where it is; Maestro stops tracking
  it, and it is the project's own agent from then on.

Two verdicts worth repeating back to the user:

- **"you edited its body"** — the fork is never overwritten automatically. `update` discards those
  edits, so say what the diff shows before running it.
- **"in step"** on a plugin agent whose files you know changed — a plugin's files come from a
  per-VERSION marketplace cache that only re-pulls when `plugin.json`'s `version` changes, so an
  edit shipped without a version bump has genuinely not reached this machine. *No update available*
  is the correct answer, not a missed one.

The desktop app's `/agents` page runs the same code over the same files, so it reaches the same
verdicts.
