# Scope modules

Three modules, three different questions, and they do not overlap. All three are pure — path
arithmetic over strings, no `fs`, no spawn, no SDK — which is what lets `claude-preview.ts` import
them while remaining unable to spawn, and what lets them be exhaustively unit-tested.

| Module             | Answers                                                      | Applied by                                                                        |
| ------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `read-scope.ts`    | What a run _will_ be able to read, computed before it starts | the confirmation dialog and the pane header — it is a **disclosure**, not a check |
| `write-scope.ts`   | May this one call write? Decided per call                    | `canUseTool`                                                                      |
| `session-scope.ts` | Did this read stay inside the disclosed directories?         | the `PreToolUse` hook                                                             |

## `read-scope.ts` — disclosure

Reads are the larger surface by a long way: file reads and searches are auto-approved and never raise
a prompt, so the directory list a session starts with **is** the whole bound. Nothing about it is
discovered at runtime, so leaving it implicit was the app granting read access to whatever it
happened to pass along.

Two things make the answer honest rather than merely plausible. It is built from the **effective**
settings resolved through `SettingsPort` — the SDK's own merge engine — not from what the app
intended, because a `~/.claude/settings.json` can add directories and rules this app never chose.
And **every value keeps its origin**: `cwd`, `app`, `session` (a person granted it mid-session, and
can take it back), or `settings` with the tier and file that contributed it. A flat list cannot
distinguish "the app pointed the run here" from "a file on disk widened it", and those are different
things to consent to.

Rules are listed **deny, then ask, then allow**, capped at `RULE_DISPLAY_CAP` with the remainder
counted — if the list is truncated, the entries that _restrict_ the run are the ones worth keeping.
`withinDirectory(parent, child)` is the shared lexical containment test the other two import.

## `write-scope.ts` — per call

The allowed set comes off the invocation the token names, so the callback is **incapable** of being
wider than what the user was shown. It replaced `--permission-mode acceptEdits`, which a headless run
needed because there was nobody to ask and which granted writes to anything under the working
directory — an entire repository, for a marketplace target. `test/isolation.test.ts` asserts the flag
appears nowhere in the app.

- Every deny **carries a reason**; the model reads them and adapts.
- **The fall-through is a deny**, so a tool nobody has thought about fails loudly on first call.
- `WRITE_TOOLS` is wider than the set a session is actually offered, deliberately: this list is what
  the check _recognises_, so a widened tool set gets checked rather than falling through.
- **`Read` is allowed unconditionally, and that is not a gap to close here.** Reads never reach
  `canUseTool`, so a path check on that branch would never run. See below.

## `session-scope.ts` — the boundary, and the door

The `PreToolUse` hook fires for **every** tool call, before the permission flow, and its
`permissionDecision` can refuse one. That is why the read bound lives here and not in `decideWrite`:
reaching for `decideWrite` first is the obvious wrong turn, because it looks like it already handles
every tool.

Two verdicts, `allow` and **`out-of-scope`** — spelled that way rather than "deny" so the hook can
decide what an out-of-scope call _becomes_ (a deny, or an `ask` routed into the prompt UI) as a
one-line change rather than a rewrite. **The fall-through is an allow**, the opposite of
`decideWrite`'s, because this is a boundary in front of a permission model that still applies
afterwards; refusing unknown tools here would quietly make it a second tool allowlist that drifts
from the real one.

`Glob`/`Grep` carry **two** halves: a search rooted at an in-scope directory can still be told to
match `../../../**`, so `boundaryTargetOf` returns the pattern separately — and only when it
escapes. `Bash` is not in `BOUNDED_TOOLS` and could not be: what `cd .. && cat` reaches is not
visible in its input, which is exactly why it is in `SESSION_DISALLOWED_TOOLS`.

The second half of the file is **"unless authorised"**. A refusal that cannot be overridden is a
wall, and the case it gets wrong is ordinary — a user authoring a skill says "make it like my
existing one", and their global skills live outside the project. `grantOptionsFor` decides **what
could be granted**, never whether anything is (the user's answer) and never whether the path exists
(`isDirectory` is the caller's, because it needs the disk). A file offers two options — itself, or
its directory — because `~/.claude/skills/foo/SKILL.md` and _every skill the user has ever written_
must be visibly different choices. An option is flagged `broad` when the directory is shallower than
`BROAD_DEPTH` **or** when granting it would swallow something already in scope.

Files: `src/core/read-scope.ts`, `src/core/write-scope.ts`, `src/core/session-scope.ts`.
Tests: one of the same name per module under `test/core/`.
