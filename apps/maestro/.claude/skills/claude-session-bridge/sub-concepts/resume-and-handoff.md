# Resume and handoff

Two ways a pane session starts holding something it did not just receive from the user. Both are
pure modules: the reading of the disk happened elsewhere, and these only decide and phrase.

## Resume — picking up a terminal conversation

`session-resume.ts` reads nothing itself: `fs` belongs to `agent-sdk.ts`, which asks the SDK for its
session store rather than walking `~/.claude/projects`. It owns two judgements and every sentence a
picker says.

**Which conversations may be offered** — a filter on the store's answer, not a search.
`resumableFrom` requires `cwd` to **equal** the open project (not be contained by it: a session run
in a subdirectory is one whose relative paths mean something else), and excludes the window's own
live session — Continue is that door, and resuming your own session would fork it beside itself. The
equality check is load-bearing because the store keys projects by a slug that flattens every `/` to
`-`, so `/home/a-b` and `/home/a/b` land in the same directory.

**What is disclosed before the user commits.** This is the part that is easy to skip and the reason
the module exists. A resumed transcript was produced under _the terminal session's_ rules — any
tools, any permission mode, possibly no permissions at all — so **it can already contain the contents
of files from anywhere on disk**, and the pane's boundary applies going **forward only**. Without the
list, "this session cannot leave the selected directory" is true of every future turn and quietly
false of the context it starts with. `resumeDisclosure` walks the transcript's own tool calls, marks
each path `inScope` against what the pane may read, and estimates the replay cost — the whole
conversation is replayed as uncached input on the first turn, against this session's ceiling.
`readNote` **says what the list cannot see**: a conversation can also carry text that was attached or
pasted, and no walk of recorded tool calls will find it.

Four things were measured for task `025` and are why the file is shaped this way:

- A resume does **not** restore the recorded session's `settingSources` — so `settingSources: []`
  holds across one, and no settings-file `ANTHROPIC_API_KEY` redirects the bill off the subscription.
- A resume does **not** restore its working directory or readable set; a `Read` of the recorded
  session's own cwd reached `canUseTool`.
- `forkSession: true` leaves the original transcript **byte-identical** and writes the fork into the
  _pane's_ project directory under a new id. That is the whole of "the terminal session's history is
  not written", and it is why `fork` is true for the picker and **false for a Continue** — a Continue
  is the same conversation one allowance later, and forking it would leave two records of one thing.
- The resumed conversation answered a question about a file's contents **with no tool call at all**.
  The bytes were already in the transcript. That is why the disclosure is not optional.

A resumed session starting with **no grants is correct, not an omission**: grants live on main's
per-window entry, die with every teardown, and are written nowhere, so there is nothing on disk to
restore. `RESUME_SCOPE_NOTE` says so — a path that conversation read freely will raise a prompt here.

## Handoff — seeding one from a form

`session-handoff.ts` is the other direction: what a create-\* form says to the session it hands off
into. **Two sentences, two audiences.** `handoffSeed` is read by the **model** — appended with
`shouldQuery: false`, so it costs nothing until the user types, and the conversation starts knowing
what the form already decided rather than re-asking for it. `handoffNotice` is read by the **user**:
the inline transcript line naming which directory just became writable, because a scope that grew
silently is a scope nobody consented to.

**Nothing new is invented here.** Every fact in the seed is one the user has already seen — the
artifact the scaffold reported, the frontmatter the form's live preview rendered, the repository
state, and the previewed prompt verbatim. That is what makes "the session starts from what you
approved" true rather than a claim about this function's good behaviour. The facts were read once, in
`claude-preview.ts`, at token time; `scaffoldedState` reads the **disk** rather than trusting the
renderer's `ScaffoldResult`, since a handoff built from a message would be a renderer describing what
a session may write.

One line in the seed is **measured, and the wording is the fix**: an earlier draft said writes outside
the scope were "refused, or come back to the user as a question", and the session read that as a wall
— asked for a file one directory up it declined to try, explaining it could not bypass the app's
boundary. The user can _allow_ a write, and the only way they get the chance is if the model attempts
it. So the sentence now says a write elsewhere pauses and asks, and to go ahead.

This is also the **only** way the write scope ever grows (`allowWrites`, called by `session:handoff`
off a claimed token). There is no channel by which a renderer could call it, and nothing it adds
survives `close()`.

Files: `src/core/session-resume.ts`, `src/core/session-handoff.ts`.
Tests: `test/core/session-resume.test.ts`, `test/core/session-handoff.test.ts`.
