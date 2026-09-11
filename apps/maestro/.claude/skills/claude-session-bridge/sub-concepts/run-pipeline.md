# Run pipeline — preview → token → run

A one-shot run is three modules on purpose. `claude-preview.ts` builds the prompt and issues a
**one-time token**; `claude-tokens.ts` defines what that token authorises; `claude-run.ts` claims one
and is the only module in the app that starts a Claude process.

**`run` takes a token AND NOTHING ELSE.** Not a token plus a prompt to check it against — there is
consequently no argument a caller could pass that would make the run differ from the preview, and
nothing to get the validation subtly wrong. The property bought: _the only executable prompts are
ones the user was shown._ A compromised renderer cannot invent a prompt, because inventing one is
not something the run channel accepts.

## What a token carries, and its four rules

`ClaudeInvocation` holds `bin`, `args`, `cwd`, `prompt`, `writable` and `handoff`. The last two are
on the invocation for exactly the same reason the prompt is — so no caller can widen what a
previewed run may write, or hand the pane a directory of its choosing.

- **Single use.** Claiming consumes it, so a stale message cannot re-trigger a run.
- **Expiry** (`TOKEN_TTL_MS`, 10 min). A preview is a snapshot of a decision; the files it describes
  may have changed.
- **Process-local.** Nothing is persisted; a project switch calls `clearInvocations()`.
- **Purpose-pinned.** `InvocationPurpose` is `"claude"` or `"usage-stats"`. One store, two run
  channels (`claude-run.ts` and `ccusage.ts`), and a token can only run the kind it was previewed
  for. A refused claim is consumed either way, and its message says _which_ refusal it was —
  "forged" and "expired" call for different next moves from the user.

## Building the prompt

`build()` in `claude-preview.ts` switches over six request kinds: the four create-\* flows,
`update-skill-tags`, and `maestro-task`. **Every branch is a prompt the app can execute; no branch
takes prompt text from a caller.** Adding a kind means adding a case, which is the review surface.

Two things about a create-\* prompt that are easy to undo:

- It carries **facts only, plus the name of the skill that holds the guidance** (task `026`).
  Authoring instructions used to be inlined _and_ written in the matching `SKILL.md` — two copies
  with nothing to catch the drift. Deleting the inline copy is why a run needs the `Skill` tool and
  a loaded plugin.
- It is **prose, not a slash command**. `test/core/create-preview.test.ts` asserts that. A slash
  command re-enters the skill from the top; naming it lets the model arrive holding what the form
  already decided.

The **cwd is derived here**, never taken from the caller: a create-\* flow targeting a marketplace
runs in that repo, not the open project — and since cwd is also what the run can read, that choice
is a disclosure. `readScopeFor` never throws; an unresolvable settings cascade still yields a scope
naming the cwd, with `unresolved` saying why the rest is unknown.

**No CLI means no token, and that is a supported state.** The preview still returns the prompt, the
argv and the read scope in full — Copy prompt is the whole fallback and must work exactly there.

## Running, and stopping

`runPreviewedClaude` never rejects except on a refused token: a session that errored and a CLI that
could not be executed are both resolved `ClaudeRunResult`s, distinguishably (`crashed` names the
file; `failed` carries the SDK's reason and a count of denied calls). Output streams as it arrives —
a window with nothing in it is indistinguishable from one that has hung — while the retained buffer
keeps the **tail** (`RETAINED_OUTPUT_BYTES`), because the end of a failing run is the part that says
why. `argv` on the result is what was **actually** spawned, not the equivalent argv the modal showed.

Stop is three non-interchangeable steps: `session.close()` ends the query and releases the child the
SDK knows about; **SIGTERM to the process _group_** reaches the CLI's own children; SIGKILL follows
after `SIGKILL_AFTER_MS`. The child is spawned `detached` for exactly this, which is also why
`disposeClaudeRuns()` runs on quit — a detached group outlives its parent by design.
`terminateChildGroup` is exported so the pane's teardown is the same teardown, not a second one
written from the same description.

**`claude` is resolved explicitly, never off `process.env.PATH` alone.** A GUI-launched Electron app
gets a PATH that does not include `~/.local/bin`, which is where the CLI installs — so the app
reported "not installed" on machines where `which claude` answers instantly. This does not
reproduce from a terminal, and no unit test in this app can see it; it was verified by launching
from a real desktop entry. `claude-cli.ts` decides with `fs` instead. `git` is resolved the same way
and for the same reason, through the `resolveOnPath(names, opts)` that `resolveClaudeCli` is now a
one-line call to.

Files: `src/core/claude-preview.ts`, `src/core/claude-tokens.ts`, `src/core/claude-run.ts`,
`src/core/claude-cli.ts`. Tests: `test/core/claude.test.ts`, `test/core/create-preview.test.ts`.
