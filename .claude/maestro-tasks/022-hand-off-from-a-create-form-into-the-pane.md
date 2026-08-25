# Hand off from a create-* form into the pane

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The two halves meet. A create-\* submit still scaffolds deterministically and still opens the
confirmation — that ordering is untouched, because the artifact being on disk before Claude is
mentioned is what makes cancelling harmless. What changes is that finishing the artifact can now
continue **in the pane**, as a conversation you steer, instead of only as a run you watch.

**This is the only thing that can grow the write scope**, and how it does so is the point. The
session opens with an empty write scope; a submitted form adds exactly one directory — the one the
create resolution returned and the confirmation displayed. Every writable directory therefore traces
to a form the user filled in and a scaffold that already wrote a file there. Not a dialog they
clicked through: an artifact they made, minutes ago.

That shape already exists on the form path and should be carried over rather than re-derived: since
`018`, `ClaudeInvocation.writable` is exactly `targets.map(t => t.path)` — the paths the confirmation
displayed — and `decideWrite` in `src/core/write-scope.ts` is the check, where a directory means
"anything under it" and a file means only itself. `runPreviewedClaude` has no argument by which a
caller could widen it, and the pane's accumulator must keep that property: the only input is a
completed preview.

Each addition is announced inline in the transcript at the moment it happens and listed in the pane
header, so the scope is readable at a glance rather than inferred. Submit a second form and it grows
by one more. Nothing else can add to it.

**Seed the conversation without spending a model call.** The handoff appends context — what was
scaffolded, where it landed, what its frontmatter says, whether it is already a git repository
(`ScaffoldResult.repo`, since `016`), what is left to write — as a transcript entry that does not
trigger a turn. The user's first typed message is the first thing that costs anything. This also
means the model starts knowing what has already been decided, so it does not re-ask for a name the
form captured. Leave the repository state out and a pane session will helpfully offer to `git init` a
directory that already is one.

Because writes are now confined to the artifact's own directory, the per-write prompt on this path
is close to ceremonial: the model cannot propose a write the user has not already approved by
submitting the form. That is intended. The prompts worth the user's attention are the ones for
anything outside it.

**Note what that sentence means after `020`, because the direction reversed.** The per-write prompt
already exists: `020` made a write the empty scope refuses into a question the user can answer
per-call, rather than a flat refusal. So a granted directory does **not** turn a refusal into a
prompt — it turns a **prompt into a silent allow**. `decideWrite` returns `{ behavior: "allow" }` for
a path inside the scope, `decidePaneCall` reports that as `{ outcome: "settled" }`, and nothing
reaches the user at all. The user-visible win of this slice is therefore the prompts that **stop
appearing** inside the artifact's own directory, and the acceptance criterion below reads that way:
a write inside the granted directory succeeds without asking, while a write outside it still raises
the same prompt `020` built and can still be allowed once without growing the scope.

**The read scope has to survive the handoff too.** Since `017` the create confirmation carries a
`ClaudeReadScope` — the directories the run can read, each with its origin and settings tier — and
the pane it hands off into must carry that across rather than dropping it. A handoff that moves only
the write target leaves the user having consented to a read scope the session then never shows them
again. Note what that scope contains after `018`: a run loads **no filesystem settings**
(`settingSources: []`), so it is the run's cwd plus whatever the managed (administrator) policy tier
contributes, and no `additionalDirectories` — user-, project- and local-tier entries are simply not
there any more. The pane's own scope is wider, so the handoff is a **widening** and should read as
one on screen rather than silently replacing one list with another.

### What `019` already built, and what it deliberately did not

- **The pane's read scope is already wide, and wider than this task assumed.** Not "the resolved
  marketplace" but **the open project plus every local marketplace** — with no create-form handoff in
  `019` there was no single marketplace to name, so main resolves them all itself with
  `listMarketplaces()` (the `source: "directory"` entries of
  `~/.claude/plugins/known_marketplaces.json`). They are passed as `additionalDirectories` and
  disclosed with `origin: "app"`. So the widening this slice performs is usually **already done**:
  expect the target marketplace to be readable before the handoff, and make the on-screen story
  about the **write** scope rather than pretending the read scope just grew.
- **No name and no path crosses the process boundary for that list.** `scaffold.ts`'s rule — _a
  renderer describes an artifact and never nominates a directory_ — is enforced literally in `019`.
  A handoff must keep it: pass a completed preview token, never a resolved path.
- **`session:start` takes no argument today.** The cwd comes from main's own project state, and
  `session:say` is the only way into the conversation — it always spends a turn. Both the handoff
  entry point and the append-without-a-turn seeding (`shouldQuery: false`) are genuinely new ground
  in this slice.
- **There is no write-scope accumulator to extend.** The pane reaches `decideWrite` with
  `writable: []`, so every write is refused with "started to answer, not to author". This slice
  builds the accumulator; the engine and the refusal message it must keep are already there. `020`
  did **not** build one either — it lets a user wave a single call through, and the scope is `[]`
  again on the next one. That premise is intact: this slice is still the only thing that can grow it.
  The literal `writable: []` to replace is in `startPaneSession`'s `canUseTool` in
  `src/core/agent-sdk.ts`, where it is passed to `decidePaneCall`.

### What `023` shipped, and why the write half of this slice is untouched by it

`023` made the **read** scope mutable mid-session and deliberately stopped there, so the premise
above survives verbatim — but four things underneath it moved, and building the accumulator on the
old shapes will produce a header and a boundary that disagree.

- **A grant is not a write scope, and cannot become one by accident.** `PaneVerdict`'s new
  `grantable` flag is true **only** in the read-boundary branch: a refused write keeps Allow once /
  Deny / Stop and never grows a grant button, because widening writes is this slice's job and nobody
  else's. The `writable: []` literal is still there, still the only thing to replace.
- **`readable` is a FUNCTION now (`readable()`), not an array captured at session start.** A grant
  has to reach the hook and the disclosure both, so nothing may hold a snapshot. The write
  accumulator needs the same property for the same reason — a form submitted mid-session must reach
  the live `canUseTool`, not the list it closed over when the pane opened.
- **`ReadScopeOrigin` has a fourth value, `"session"`**, and `SessionInfo` carries `grants:
  SessionGrant[]`. So the header already renders a growing, per-origin list with per-entry controls;
  the write scope should join that surface rather than opening a second panel beside it. `023`'s
  three-step discipline is the one to copy: widen the enforcement input, tell the SDK, and re-derive
  the disclosure — pushed as the new `{ kind: "scope" }` `SessionEvent`, which is also where an
  announced write-scope addition belongs if it is not a transcript entry.
- **`session:revoke` exists, and it is the shape a revocable write scope would take.** It carries a
  path and is safe only because it can exclusively **remove** an entry main already holds. A channel
  that could add one would hand the renderer the directory nomination `scaffold.ts` spent this whole
  app forbidding — which is why the handoff must still pass a completed preview token, never a
  resolved path.

The existing headless finish stays available. The two paths differ in who is driving, not in what
they are allowed to do — and since `018` that is literally true rather than aspirational: the
headless finish is itself an SDK session running the same `decideWrite` over the same `writable`
list. Keep it that way; the moment the pane path grows its own notion of "what may be written", the
sentence stops being checkable.

## Acceptance criteria

Settled in a real window over three probe passes — 13 mechanics assertions, 11 against a live
model, 6 against the headless path — plus 443 unit tests. Each item says how, because two of them
are about something that must NOT happen and saying "verified" about an absence is worth spelling
out.

- [x] A create-\* submit can hand off into the pane, and still shows its confirmation first, with the
      artifact already on disk — **verified live.** The form was driven in the packaged build; at
      the moment the confirmation appeared, `SKILL.md` existed with the frontmatter the live preview
      had shown. The dialog now offers two buttons over the same single-use token: **Run** and
      **Continue in the pane**, with the directory the second one would open rendered beside them.
- [x] The handoff adds exactly one directory to the write scope, announced in the transcript and
      listed in the header — **verified live.** One `notice` naming the directory and the form that
      opened it, and one entry in the pane's scope panel (`data-count="1"`), which `main` and the
      renderer both derive from the same list.
- [x] A second submit grows the scope by one more; nothing else in the app can add to it — **verified
      live.** Two submits → two entries. A `maestro-task` preview carries `handoff: null` and
      `session:handoff` refuses its token outright (its write target is the whole project); a
      replayed token is refused by `claimInvocation`; and the wire carries no path at all.
- [x] The seeded context does not trigger a model turn and costs nothing until the user types —
      **verified live, and it needed a fix.** The session's own event stream after a handoff is
      `context`, `notice`, `scope` and nothing else. It was `context, notice, scope, turn` first
      time: a `shouldQuery: false` append is answered with its own `result` message
      (`total_cost_usd: 0`, no assistant text), which was being reported as a turn — claiming
      something ran, and clearing the renderer's `busy`. `startPaneSession` now counts outstanding
      user turns and drops a zero-cost result that answers none of them.
- [x] The model does not re-ask for fields the form already captured — **verified live**, and more
      strongly than expected: told to "go ahead", the session read the seeded frontmatter, rewrote
      the body (304 → 2 989 bytes) and left the `description:` the user approved byte-identical. In
      an earlier probe it also rejected an instruction of the probe's own as an injection against
      the seeded task, which is the seed carrying real weight rather than decorating the transcript.
- [x] A write inside the granted directory succeeds **without** raising a prompt; a write outside
      every granted directory still raises `020`'s prompt, and allowing it once does not grow the
      scope — **verified live, and this one also needed a fix.** Inside: `Edit` on the skill body,
      no `permission` event, no refusal. Outside: `Write` on the project's `README.md` raised the
      prompt with the path, no grant button, and a reason naming the scope that exists rather than
      `020`'s "nothing has given this session write access"; Deny left no file, Allow-once wrote it
      and left the scope at one entry. The fix was the SEED'S WORDING — it first said writes outside
      were "refused, or come back to the user as a question", and the session declined to attempt
      one at all, explaining it could not bypass the app's boundary. That silently deletes `020`, so
      the seed now says plainly that a write elsewhere asks and can be allowed.
- [x] The existing headless finish still works and produces the same artifacts — **verified live.**
      Same form, **Run** instead: outcome `ok` in 26.7s, body written, frontmatter untouched, and no
      session started and no write scope granted by any of it.
- [x] Switching projects clears the accumulated write scope along with the session — **verified
      live.** After a switch: `id: null`, `writable: []`, `writes: 0`. There is no revoke for a
      write scope entry and none is owed — a grant answers a question the session asked, a write
      scope entry answers a form the user submitted, and ending the session is how it is withdrawn.

## What diverged from the plan

Four things, each recorded because a later task builds on this surface.

- **The channel is `session:handoff`, taking a preview TOKEN**, which is the shape the plan asked
  for ("pass a completed preview token, never a resolved path") made literal. `HandoffContext` rides
  on `ClaudeInvocation` beside `writable`, built by `claude-preview.ts` from the same
  `resolveCreateTarget` the scaffold wrote with.
- **The scope entry is the artifact's own directory, except where the artifact owns none.**
  `CreateTarget` gained `dir`, and it is `""` for a project-target subagent — one `.md` file inside
  `.claude/agents/`, a directory it shares with every other agent in the project. That case grants
  the FILE. Every other shape grants a directory, so "exactly one directory" holds wherever there is
  one to grant.
- **Anything writable is also readable.** `readable()` in `startPaneSession` includes the write
  scope, and the disclosure lists a handed-off directory as `origin: "app"` only when nothing
  already in scope contains it. A session that may write a file it may not read is asked about the
  read half of every edit, which is the prompt this slice exists to remove.
- **Telling the CLI about the directory is LAZY, because the SDK has no control request for it.**
  `updatedPermissions` rides on a permission answer and nowhere else, and a handoff has no answer to
  ride on. `startPaneSession` therefore carries the `addDirectories` update on the first allow that
  lands inside a newly-opened directory (`unannounced`), once, with `destination: "session"`.

## Blocked by

- `020-permission-prompts-in-the-pane.md`
