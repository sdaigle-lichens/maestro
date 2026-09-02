# Asking a person

`canUseTool` returns a promise. When only a person can answer, the host **parks** it, pushes a
question to the renderer, and resolves it when the answer comes back.

## `permission-registry.ts` — the parked promises

Three lines of intent and four requirements that are individually easy to miss, which is why they
live in one module with tests rather than inline in the session:

- **Idempotent per request id.** A request whose response was lost across a transport gap **is
  dispatched again** — by `reinitialize()`, and by any `initialize` to a running session, whose
  response carries `pending_permission_requests` the SDK re-dispatches. Returning the existing
  promise is correct; parking a second one leaks an entry the UI has nothing left to answer with,
  and the tool call never returns.
- **A redelivery after the answer still needs the answer.** The prompt is off screen by then, so a
  fresh park would wait forever. Settled answers are remembered, bounded by `SETTLED_CAP`.
- **Every exit resolves everything outstanding, as a deny.** Window close, project switch, quit.
  **There is no backstop below this** — permission prompts do not time out, and an unresolved ask is
  a permanently wedged session holding a detached child process.
- **Nothing resolves to `undefined`.** The SDK reads a missing answer as "the host replied out of
  band" and then writes no `control_response` at all.

**One registry, two kinds of ask.** A structured question is nothing like a permission request on
screen and identical to one here — same parking, same idempotence, and above all **drained by the
same `denyAll`**. A second registry beside it would be a second thing to remember on teardown, and
the one that gets forgotten wedges the session just as hard.

## `session-permission.ts` — settle it, or ask

**Not a fourth permission engine.** It calls `decideWrite` and `decideBoundary` unchanged and adds
the third answer neither can give: _the answer comes from the user_. `PaneVerdict` is `settled`
(carrying the SDK-shaped decision itself, so `agent-sdk.ts` routes and never decides) or `ask`.

An `ask` carries **two sentences with two audiences**, and collapsing them costs one of them:
`reason` is what the prompt shows a person, `denyReason` is what the model is told if they refuse
without typing anything — `decideWrite`'s own refusal, which is written to steer a model back to
useful work and reads oddly in a dialog.

`grantable` is true for **exactly one branch**: a read the boundary stopped. Not a write — the write
scope grows in one place only, a create-\* form handed off with its completed preview, so every
writable directory traces to an artifact the user made rather than a button they pressed while being
asked about something else. Not a network call — there is no path in it to grant.

`PANE_ASK_TOOLS` (`WebFetch`, `WebSearch`) always ask: neither touches the filesystem, so neither
scope module has an opinion, and an outbound request is how the project's contents leave the machine.
`describeCall` renders **the complete URL, query string included** — `example.com` and
`example.com/collect?body=<the user's file>` are otherwise the same prompt, and only one is worth
denying. Nothing is ever rendered as a JSON blob: a prompt nobody can read is answered with a
reflexive Allow.

`autoRefusal` is the **fourth refusal route** and shares no code with the other three — the CLI's own
permission system (a deny rule, or the mode) refuses before `canUseTool` and reports only a
`permission_denied` stream event. `decision_reason_type` names the deciding component (`rule`,
`mode`, `classifier`, `asyncAgent`) and is carried through rather than folded into the sentence.
It is lifted out of the read loop because it cannot be provoked from a window without an
administrator policy file.

## Granting takes two halves

A grant needs `grant()` **and** `updatedPermissions`, and neither substitutes for the other: the hook
runs first and would otherwise route the path into a prompt forever, and the CLI's permission system
runs after and would otherwise refuse what the hook waved through. **Revoking works because the hook
is the authority** — the SDK has no API for withdrawing a `PermissionUpdate`, but a path the hook no
longer recognises is prompted for again on the next call. Grants live in the session closure, die
with it, and are written nowhere.

## `session-question.ts` — the carve-out

`AskUserQuestion` reaches `canUseTool` like anything else — even where a rule would auto-approve it,
because by definition it needs a human — but "Claude wants to use a tool — Allow / Deny" is the wrong
sentence for "which of these three shapes do you want". `agent-sdk.ts` branches on the tool name
first, so `session-permission.ts` never sees one.

**The answer travels back through `updatedInput`, the one field this app otherwise refuses to
expose** — a permission answer carries a decision and no payload; this carries the tool's own input
with the user's choices written into it. The carve-out is made _checkable_ rather than trusted: the
renderer sends a **selection** (which question, which labels) and never an input object;
`answerQuestions` rebuilds the payload from the questions **the model asked**; and a label that was
not among the options offered is **refused, not filtered out** — silently dropping it would send the
model an answer to a question nobody asked. So the payload is built entirely from strings the model
wrote, and the renderer's only contribution is which were picked.

`describeQuestions` reads the call defensively and drops anything unanswerable — no text, or fewer
than two options. An empty result is the caller's signal to refuse outright with `QUESTION_REFUSAL`:
a question nobody can answer parks a promise only teardown will resolve.

Files: `src/core/permission-registry.ts`, `src/core/session-permission.ts`,
`src/core/session-question.ts`. Tests: one of the same name per module under `test/core/`.
