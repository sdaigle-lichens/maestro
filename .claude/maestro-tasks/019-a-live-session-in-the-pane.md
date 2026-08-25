# A live session in the pane, read-only

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The first conversation the app can actually hold. One live, multi-turn session per open project,
rendered in a resizable right-hand pane that shifts the layout rather than covering it — on the
create-\* routes it takes the file-preview column, because once authoring has begun the conversation
is the more useful thing to have beside the form.

**This slice deletes the help chat.** Its panel, its context provider and its request kind all go.
(Its _flag set_ is already gone — `018` deleted `CLAUDE_ASK_FLAGS` and `BuiltRequest.flags`, because
with `acceptEdits` gone there is no flag-level difference between an authoring invocation and an
asking one.) Two conversational surfaces would mean two transcripts and two consent models, and
the chat's whole design rests on re-sending capped history in every prompt precisely because it has
no session. The one thing the pane inherits is the help skill the chat asks for by name, now
declared as a session skill rather than named in a prompt string — note that `Skill` is **not** in
`SESSION_TOOLS` today, so this slice adds it.

**It is read-only, and that is what makes it safe to ship before permission prompts exist.** The
write scope starts empty and only a later slice can grow it. The session can read the open project
and the resolved marketplace and nothing else; anything outside is denied by a pre-tool boundary
check with a reason the model can adapt to.

### What `018` already built, and what it deliberately did not

Read `apps/maestro/src/core/agent-sdk.ts` and `write-scope.ts` before starting — a run is already an
SDK session, so several things this task used to imply were new are not.

- **The permission engine exists.** `decideWrite` in `src/core/write-scope.ts` is the whole decision,
  pure and exhaustively tested, and `startAgentSession()` hands it to the SDK as `canUseTool`. An
  empty write scope is already a working state: `writable: []` refuses every write with a reason
  saying the run was started to answer rather than to author. Do not build a second engine for the
  pane — `020` builds the _UI_ on this one.
- **The permission callback bounds writes only, and cannot bound reads.** `decideWrite` returns
  `allow` for `Read`/`Glob`/`Grep` without ever looking at the path, and that is deliberate: reads
  are auto-approved by the permission system and never raise a prompt, which is the entire reason
  `017` had to disclose the read scope up front. So the boundary check in the criteria below is
  genuinely the `PreToolUse` hook layer from `SESSION-PANE-PLAN.md` — the one that returns
  `permissionDecision: "ask"` to _route_ an out-of-scope read into the prompt UI — and not an
  extension of `write-scope.ts`. Reaching for `decideWrite` first is the obvious wrong turn, because
  it looks like it already handles every tool. Along with the streaming-input pump, this is the
  largest piece of new ground in the slice.
- **The tool set is a constant to extend, not to invent.** `SESSION_TOOLS` and
  `SESSION_DISALLOWED_TOOLS` are exported from `agent-sdk.ts`. `AskUserQuestion` and `Skill` are
  absent because the form path is headless; the pane is what makes them answerable, so this slice is
  where they arrive.
- **The detached spawn and the three-part teardown exist.** `claude-run.ts` supplies
  `spawnClaudeCodeProcess` (`spawnClaudeChild`) and tears down with `query.close()` → SIGTERM to the
  process **group** → SIGKILL after a grace. Reuse that shape; it is verified against real processes.
- **`startAgentSession()` is a single-prompt session, not a multi-turn one.** It takes a `prompt`
  string, so it gives a one-shot query with no way to add a turn. The streaming-input pump is genuinely
  new work — but it is a sibling of that function, over the same options, not a second SDK importer:
  `agent-sdk.ts` is still the ONLY module in the app that imports the SDK, and it must stay that way.
- **Reads were not widened.** `018` passes **no `additionalDirectories`**; the read scope is the run's
  cwd. "The open project and the resolved marketplace" therefore needs `additionalDirectories` for the
  first time here, and `ClaudeReadDirectory` already carries the provenance to render it.
- **`settingSources: []` has a consequence worth knowing before you disclose anything.** A session
  loads no filesystem settings, so **`CLAUDE.md` files are not auto-loaded** — the SDK requires
  `settingSources` to include `'project'` for that. The model can still `Read` them, and the pane
  should expect to be told to. `[]` does not drop the managed (administrator) policy tier.
- **A fake `claude` on `PATH` cannot serve as a test double** — it cannot speak the SDK's stdio
  protocol. Test through an injected session, as `ClaudeRunDeps` does.

Structural decisions that are not details:

- The session lives in the main process, one per window, retargeted on project switch and disposed
  on quit — the same ownership shape as the log tail.
- Conversation state lives above the router outlet, not in the panel. The top bar remounts on every
  navigation, so a transcript held in the panel would be discarded the moment the user opened
  another route, and the handle on a run in flight would go with it.
- Input must be a stream the app yields into, not a single string. A string prompt gives a one-shot
  query with no way to add a turn and no working Stop. Deciding this later means rewriting the
  message pump.
- A user turn is stamped as human-authored. The session treats an unattributed turn differently, and
  this is what makes "the user writes the prompts, not the renderer" enforceable rather than
  merely intended.
- The read loop ends on the session's own result message, not on the first quiet moment.

The read scope is not a new idea by the time you get here: `017` added `ClaudeReadScope` /
`ClaudeReadDirectory` / `SettingsPort` to `src/core/contracts.ts`, derived by
`src/core/read-scope.ts` and rendered by `components/read-scope.tsx`. Extend those shapes for the
pane rather than inventing a second notion of "what this session can see" — including for the
header, which needs to show the same thing the confirmation already shows.

Reuse the existing humanizer for rendering tool calls. Do **not** reuse the log view's instance
segmentation: it reads a hook-written file with different shapes and correlates by agent, and
forcing a live message stream through it will mislead.

## Acceptance criteria

- [ ] A multi-turn conversation runs in the pane, per project, with streamed output and a working Stop mid-turn
- [ ] The pane is resizable, shifts the layout rather than overlaying it, and takes the preview column on create routes
- [ ] The help chat and its request kind are deleted; the help skill is still reachable by name
- [ ] The session can read the open project and the resolved marketplace; a read outside both is denied with a visible reason
- [ ] The session cannot write anywhere — the write scope is empty and there is no path to add to it yet, and a refused write carries `decideWrite`'s reason rather than a new one
- [ ] Navigating between routes mid-turn loses neither the transcript nor the ability to stop the run
- [ ] Switching projects ends the session and starts nothing against the new project implicitly
- [ ] Closing the window mid-turn leaves no surviving process
- [ ] Tool calls render humanized rather than as raw payloads

## Blocked by

- `018-run-create-authoring-on-the-agent-sdk.md`
