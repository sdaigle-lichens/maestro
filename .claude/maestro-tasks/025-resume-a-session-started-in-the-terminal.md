# Resume a session started in the terminal

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

A user starts a skill in their own terminal, gets partway, and wants the app. Today everything they
said getting there is lost and has to be retyped. Sessions are persisted, so the pane can list the
recent ones for the open project — with their summary, first prompt, branch and working directory —
and pick one up with its history intact.

The value is not the artifact; the file on disk was always the easy part. It is the *context*: "I
want a skill that does this, but our repo does that, so avoid the other thing."

Three things decide whether this is safe.

**Fork on resume.** Continuing the original session means the app writes into the history of the
user's own terminal session. Fork so the two stay separate.

**Disclose what the imported transcript already read.** This is the one that matters, and it is easy
to skip. A resumed conversation was produced under *the terminal session's* rules — any tools, any
permission mode, possibly with permissions skipped entirely — so it can already contain the contents
of files from anywhere on disk. The pane's boundary applies going *forward only*. Without a
disclosure, "this session cannot leave the selected directory" is true of future turns and quietly
false of the context it starts with, which is the worst kind of wrong: the guarantee reads as intact
while a hole sits underneath it. Show what that session read, and let the user decline.

**Probe whether resuming honours the pane's directories or restores the recorded ones.** The
reference does not say, and the answer is load-bearing for the boundary. Settle it by testing the
running CLI, not by reading source, and record the answer where the next person will find it. Probe
the same question for `settingSources`: every session this app starts passes `[]` (since `018`, that
is the run, the smoke query and the settings resolution alike), and a resume that restored the
recorded session's sources would reopen both doors `[]` closes — a permissions widening, and an
`ANTHROPIC_API_KEY` in a settings file redirecting the bill off the subscription.

**`023` settled half of that probe in advance, and the half it settled is the reassuring one.** The
`PreToolUse` boundary hook runs *before* the CLI's permission system, so whatever a resume restores
into the permission system, the hook is still the authority over what the session may read — that is
the same property that makes `session:revoke` work at all, since the SDK has no API for withdrawing a
`PermissionUpdate`. What still has to be probed is `settingSources`, and whether a resumed session's
recorded `cwd` displaces the pane's. The boundary is anchored to `request.cwd`, and `023` pinned that
it does not follow a working directory that moves.

**A resumed session starts with no grants, and that is correct rather than an omission.** Session
grants live on main's per-window `LiveSession` entry, die with it on every teardown path, and are
written nowhere — so there is nothing on disk for a resume to restore, and a path the terminal
session read freely raises a prompt on the first turn in the pane. That belongs in the disclosure
this task already requires: what the imported transcript already read is exactly the set the pane
will now start asking about.

A long transcript is replayed as context on the first turn, so resuming is not free. Show the user
what they are picking up before they pick it up.

### What `024` already built — the resume machinery exists, and this task is now the picker

`024` needed a Continue, and a Continue is a resume. So the mechanical half of this task is done and
**must not be rebuilt**; what is left is finding a session to resume and deciding to attach to it.

- **Sessions are persisted because the pane asks for it.** `startPaneSession` passes
  `persistSession: true` explicitly — not left to the SDK's default, because Continue rests on it —
  so every pane session already leaves a transcript on disk in the CLI's own store.
- **`resume` is a `PaneSessionRequest` option and it works.** `startPaneSession` passes
  `...(request.resume ? { resume: request.resume } : {})`, and `PaneSession.sessionId()` reads the
  CLI's own id off the init message, which is what a resume is issued against.
- **`openSession` in `src/main/claude-session.ts` is already the one builder for "start a session,
  possibly carrying a conversation into it".** `startSession`, `continueSession` and the pacing
  reopen all land there and differ only in a `CarriedSession` — `resume`, `spend`, `grants`,
  `writes`, `effort`, `model`, `pacing`. Attaching to a terminal session is a fourth caller of that
  same builder, and doing it any other way is how a resumed session ends up with a different tool
  set or a different boundary from a fresh one. Note what the shape already guarantees: every field
  on `CarriedSession` is main's own record, so a renderer cannot smuggle a scope in through it.
- **A resumed session already gets the whole boundary unchanged**, because `openSession` composes
  the same query options for every caller: `PANE_TOOLS`, the `PreToolUse` read boundary,
  `settingSources: []`, `permissionMode: "default"`, the preset system prompt. That is most of one
  acceptance criterion below, held by construction rather than by a new code path.
- **`session:continue` is the precedent for the wire, and the shape to copy.** It carries the
  session id and nothing else, and main resolves everything about the conversation from its own
  entry. A picker that sends a chosen session id is the same shape, with one genuine difference —
  the id names a session **main has no entry for**, so whatever the picker offers has to have come
  from a list main built and published, not from a path the renderer nominated.

**What remains is exactly the part `024` had no reason to build:** enumerating the user's own
sessions for the open project, describing each well enough to recognise (summary, first prompt,
branch, working directory), showing what that transcript already read and what replaying it will
cost, and forking rather than continuing so the terminal session's own history is not written to.
The three probes this page calls for are also untouched — `024` resumed sessions **this app
started**, under this app's own options, so it settled nothing about what a resume restores from a
session started elsewhere.

## Acceptance criteria

- [x] The pane lists recent sessions for the open project with enough detail to recognise one — a History control in the header opens `session-resume.tsx`; each row carries summary, first prompt, branch, cwd, age and size, verified in the window
- [x] Resuming restores the conversation and continues it in the pane — verified in the window: the model answered `TERMTOKEN-7741` from the imported context, which it could only have had from the transcript
- [x] Resuming forks: the original terminal session's history is not written to — verified on disk — `forkSession: true` on the query; both fixture stores were byte-identical (sha, size, mtime) after the resume and a new fork transcript appeared in the resuming project's own store under a new id
- [x] Before resuming, the user is shown what that session previously read, and can decline — `resumeDisclosure` listed the out-of-scope read in amber (`data-in-scope="false"`), and declining returned to the list having started nothing
- [x] Whether resume honours the pane's directory scope is established by probe and recorded, and the boundary behaves correctly either way — measured against a running CLI: it does **not** restore the recorded `cwd` or readable set (`init.cwd` is the resuming query's) and does **not** restore `settingSources`; a `Read` of the path that conversation had read freely raised a prompt
- [x] A resumed session is subject to the same tool set, boundary and prompts as a fresh one — `resumeSession` is the fourth caller of `openSession`; asserted in the window, where the resumed session's tool set and skills were identical to a fresh one's, with zero grants and an empty write scope
- [x] The cost of replaying a long transcript is surfaced before the user commits to it — the disclosure shows the replay estimate (189 tokens, ≈$0.0006 in the fixture) at a named rate, with `024`'s "an estimate, not a bill" sentence
- [x] Sessions belonging to other projects are not offered — `resumableFrom` filters by recorded `cwd` **equality**; a session in a second fixture project was not listed

## Blocked by

- `024-a-budget-ceiling-you-can-continue-past.md`

## What was actually built

Added: `src/core/session-resume.ts` (pure — `resumableFrom`, `resumeDisclosure`, `replayNote`,
`readNote`, `RESUME_SCOPE_NOTE`, `resumedNotice`, `formatTokens`; reads nothing itself),
`src/renderer/src/components/session-resume.tsx` (the picker and the disclosure, reaching
`useSession()` only), `test/core/session-resume.test.ts` (16 tests).

Changed: `agent-sdk.ts` (`listStoredSessions`, `readStoredMessages`, `PaneSessionRequest.fork`),
`contracts.ts` (`ResumableSession`, `ResumeRead`, `ResumeDisclosure`), `core/index.ts`,
`main/claude-session.ts` (`listResumableSessions`, `describeResume`, `resumeSession`, the
per-`webContents.id` `offered` set, `CarriedSession.fork`), `main/ipc.ts` / `shared/ipc.ts` /
`preload/index.ts` (three channels), `session-context.tsx`, `session-pane.tsx`,
`test/isolation.test.ts`.

### Divergences

1. **The picker lists every conversation recorded for the project, not only terminal-started ones.**
   `listSessions({ includeProgrammatic: false })` gives parity with the terminal's `/resume`, but
   measured it returns **zero** rows for SDK-started sessions — which would hide every conversation
   this app itself has run. So the filter is recorded `cwd` **equality** (not containment) plus
   `includeWorktrees: false`, minus this window's own live and exhausted ids. Yesterday's pane
   conversation is as resumable as yesterday's terminal one; the page's title still describes the
   motivating case rather than the rule.
2. **The store is read through the SDK, never walked.** This page did not say how.
   `~/.claude/projects/<slug>/` is private layout with a lossy slug encoding, so `listSessions` /
   `getSessionMessages` are wrapped instead — the same "do not become a second reader of someone
   else's format" rule `ccusage.ts` records. Neither wrapper throws: a store that cannot be read is an
   empty picker. `forkSession: true` is a query option, so the SDK's separate `forkSession()` helper
   is unused.
3. **The disclosure enumerates the transcript's recorded TOOL CALLS, and says what it cannot see.**
   Attached, pasted and auto-loaded text never appears as a tool call in `getSessionMessages`' output,
   so `readNote()` states the limit plainly. Implying completeness would have been worse than
   disclosing less.
4. **The replay cost is quoted at a named rate.** `REPLAY_USD_PER_MTOK = 3`, written into the sentence
   itself, because the pane's model is selectable and a bare dollar figure would be trusted for
   something it cannot be.
5. **A resumed session's earlier turns are NOT re-rendered in the pane's scrollback** — they are in the
   model's context. The pane clears the transcript and posts one notice saying what was picked up, what
   it cost and that it forked.
6. **A fourth probe answer, and it is why the disclosure is not optional.** The resumed conversation
   answered a question about a file's contents with **no tool call at all** — the bytes were already in
   the transcript, so nothing reached `canUseTool` and nothing reached the boundary hook.
7. **A trap found only in the window:** the renderer must clear the transcript **before** the resume
   round trip. Main pushes its notice during the call, so clearing afterwards deleted it and the
   session looked as though it had started silently. Nothing errored and no test caught it.
