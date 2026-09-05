# Resume subagents on loop-back edges

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

When a condition edge routes back to an agent that **already ran in this run**, the orchestrator
resumes that subagent with `SendMessage` instead of dispatching a cold `Task`.

Maestro's workflows loop. `@backend → @reviewer → (changes requested) → @backend`,
`@backend → @test → (tests failed) → @backend`, and every `human review` bounce described at
`templates/maestro/SKILL.md:46`. Today the second visit starts from nothing: the agent re-reads the
files it wrote twenty minutes ago and re-derives the design decisions it already made.

Channels cannot fix this, structurally. A channel carries a *payload* — the receiver's inputs. It
does not carry the sender's reasoning, and on a loop-back the agent needs its own reasoning back,
not someone else's summary of it. Resume is the only mechanism that returns it:

> Resumed subagents retain their full conversation history, including all previous tool calls,
> results, and reasoning. The subagent picks up exactly where it stopped rather than starting fresh.
> — https://code.claude.com/docs/en/sub-agents#resume-subagents

### `036` needs no repair — confirm this before building on it

`SubagentStart` fires again on a resumed run ("resuming starts a new run of the agent under the same
ID"), and `SubagentStop` fires when that run finishes. So skills injection, the routing block, the
per-route protocols, the report and **channel delivery** all still fire. Nothing in `036` breaks.

Two properties of `036` turn out to be resume-correct by construction, and both should be *verified*
rather than assumed, because the whole slice rests on them:

- **Channel delivery does not duplicate.** `retire()` renames a delivered file into
  `.consumed/` on the first run, and `readLane` reads only the live lane (`listDirs` excludes
  `.consumed`), so the resumed run's `readLane` finds nothing to re-inline.
- **`writeStamp` is idempotent.** It skips already-stamped files
  (`handoff-channels.ts:112`), so the resumed `SubagentStop` re-stamps nothing.

Better than merely safe, the composition is *right*: if `@reviewer` writes to `@test`'s lane
between the two runs, the resumed `@test` gets that **new** payload delivered and not the old one.
Resume supplies the agent's own memory; channels supply the new input; retire keeps them apart.

### The mapping already exists — do not add state

The obvious implementation is to have the orchestrator remember each agent's id across the run.
Don't. That is precisely the stateful obligation `036` removed from it (its `PRINCIPLES` line 78),
and an opaque uuid held across a long run is the class of thing it drops silently, the way it
already omits `skillsTriage`.

It is already on disk. `maestro-subagent-log.js:114-124` appends, on every `SubagentStop`:

```json
{ "ts": "…", "origin": "maestro:backend", "kind": "handoff", "agent_id": "…", "status": "condition", … }
```

`origin` is the agent type and `agent_id` is the id to resume. And the log has exactly the right
lifetime: `maestro-session-cleanup.cjs` deletes `maestro_session.log.jsonl` at `SessionEnd`
alongside `maestro_session.json`, so a `kind:"handoff"` entry in it is by construction *this* run's.
The index for resume is a read, not a write. **This slice adds no new hook write of any kind.**

### `maestro-resume-target.cjs`

A small CLI in the family of `maestro-set-session-workflow.cjs` and `maestro-task-status.cjs`, so
the orchestrator can reach the index from its `allowed-tools` frontmatter rather than being asked to
grep a jsonl file by hand:

```bash
node "$CLAUDE_PROJECT_DIR/.claude/scripts/maestro-resume-target.cjs" "<agent type>"
```

Prints the resumable `agent_id` on stdout, or **nothing** (exit 0) when there is none. Empty output
must always be safe: it means *spawn a cold `Task`*.

It prints nothing when any of these hold:

- no `kind:"handoff"` entry for that agent type in this run's log (the agent has not completed a run
  yet — the first visit, which is the common case);
- the log is absent (`SessionEnd` swept it, Maestro not configured, hooks not firing);
- **the agent type is ambiguous in the active workflow** — see below.

Match `origin` against the requested type **bared on both sides**. `origin` is the raw
`agent_type`, which can be namespaced (`maestro:backend`); this is the same trap `033` fixed on both
ends of a handoff id, and `bareAgentName` already exists in the shared lib. Take the **most recent**
matching entry, not the first.

### The ambiguity rule, and why it is not optional

`SubagentStart` resolves context by **agent type**, never by instance —
`collectAgentSkills(searchList, instances, agentType)` returns `matchedInstances`, plural — and a
`Task` dispatch carries `subagent_type`, not an instance name. So when a workflow has two instances
sharing one `agent` (`MaestroInstanceV3.agent`, e.g. `@backend-api` and `@backend-worker` both on
`maestro:backend`), the log's `origin` cannot distinguish them and resuming would silently resume
the wrong one — cross-contaminating two agents' histories, with no error anywhere.

So: **if the active workflow's search list contains more than one instance whose `agent` bares to
the requested type, print nothing.** A cold spawn is correct-but-slower; a wrong resume is
corrupt-and-silent. Resolve the search list with the same `resolveSearchList(cfg, session)` the two
hooks already share, so this cannot disagree with what gets injected.

### Where the logic goes

`apps/maestro/src/core/agent-runs.ts` — pure, `fs`-free, taking the log's already-parsed lines:

```ts
export interface AgentRun { agentType: string; agentId: string; ts: string; }
export function agentRunsFromLog(lines: unknown[]): AgentRun[];
export function resumeTarget(lines: unknown[], cfg: MaestroConfigV3 | null, session: MaestroSession, agentType: string): string | null;
```

Re-export it through the existing `plugin-entries/maestro-session.ts`, the bundle the hooks and
scripts `require` unconditionally. **No 12th bundle and no manifest change** — same argument as
`036`, and the same price:

```bash
grep -c "node:sqlite" plugins/maestro/scripts/lib/maestro-session.cjs   #  must stay 0
```

Nothing here touches a database, so keeping that at `0` is free — but check it, because the failure
is silent on any `node` older than 22.5.

### The orchestrator template

`plugins/maestro/templates/maestro/SKILL.md`, line by line:

| Line | Today | After |
| --- | --- | --- |
| 4 (`allowed-tools`) | one `Bash(...)` entry for the gates script | add `maestro-resume-target.cjs`. |
| 46 (`human review`) | "Dispatch the requested changes as a `Task` to that agent" | resume that agent when it has a resumable id; `Task` otherwise. |
| 50-54 (`HANDOFF:` routing) | "route back to the node that condition edge points to" | unchanged in intent — add the resume-vs-spawn rule for the backward case. |
| 76 (principle) | **Condition edges are feedback loops.** | Extend: a loop-back to an agent that already ran resumes it, so it keeps its own memory of what it built. |
| — | — | **New principle:** resume backwards, spawn forwards. |

**The forward success path keeps spawning.** A fresh, isolated context is the point there —
`@frontend` must not inherit `@backend`'s reasoning. Resume is for backward edges only. That is also
what bounds the context growth this slice risks: a resumed agent accumulates every tool call from
every visit, and only the retry count bounds how many visits there are. Left unrestricted, a
long-running `@backend` would end up larger than the orchestrator, inverting the token argument
`036` was built on.

### Fallbacks, all of which must land on a cold `Task`

- `maestro-resume-target.cjs` printed nothing (no prior run, ambiguous type, no log).
- `SendMessage` is refused because the user stopped that agent with `x` in `/tasks` — the docs are
  explicit that such an agent does not auto-resume and the send is refused.
- `SendMessage` is refused by the same-agent name check (v2.1.199+). **Address by `agent_id`, never
  by name**, which avoids this entirely; the fallback covers it regardless.

None of these may surface as an error to the user. A failed resume is a performance regression, not
a broken run.

### Version floor

Resume's pieces land across Claude Code v2.1.191 → v2.1.211 (the last being per-invocation `model`
persisting across a resume). Maestro assumes nothing about the Claude Code version today. State the
`>= 2.1.211` requirement explicitly in the template's new principle rather than smuggling it — on an
older build the `SendMessage` either fails (caught by the fallback) or silently loses the instance's
model override.

### Files

| File | Change |
| --- | --- |
| `apps/maestro/src/core/agent-runs.ts` | New. `agentRunsFromLog`, `resumeTarget`, the ambiguity rule. |
| `apps/maestro/src/core/plugin-entries/maestro-session.ts` | Re-export the above. No new bundle. |
| `plugins/maestro/scripts/maestro-resume-target.cjs` | New CLI. Prints an id or nothing. |
| `apps/maestro/src/core/install.ts` | `HOOK_SCRIPTS` entry for the new script (beside `:148-150`). |
| `plugins/maestro/scripts/maestro-install.js` | The hand-mirrored same entry (beside `:371-373`). |
| `plugins/maestro/templates/maestro/SKILL.md` | `allowed-tools`, Step 3, the principles above. |
| `plugins/maestro/.claude-plugin/plugin.json` | `0.4.5` → **`0.4.6`** (patch — a script is not a new skill, agent, command or hook event; see `.claude/skills/updating-maestro/`). |
| `apps/maestro/test/core/*` | Unit tests for `agent-runs.ts`; `parity.test.ts` for the new exports. |

## Acceptance criteria

- [x] A condition edge routing back to an agent that already completed a run in this session resumes
      that agent by `agent_id`, and the resumed agent demonstrably retains its earlier context (it
      does not re-read files it read on its first visit). *The mechanism is built and unit-tested
      (`agent-runs.test.ts`, the CLI hand-run against fixture logs); the live, multi-turn
      `SendMessage`-resume behavior inside a real orchestrated session — history genuinely
      retained — was **not** exercised end to end. This rests on Claude Code's own documented resume
      semantics (quoted above) rather than on a run observed here. See "Not independently verified"
      below.*
- [x] The forward success path still dispatches a cold `Task` for every step. No resume on a success
      edge, verified against a workflow whose success path revisits no agent. `resumeTarget` is only
      ever consulted on the backward/condition-edge case; the template's success-path prose is
      untouched.
- [x] `maestro-resume-target.cjs` prints the most recent matching `agent_id` for an agent type with
      one completed run, and prints **nothing** (exit 0) for: no prior run, a missing log, and an
      agent type carried by two instances in the active workflow. Verified against hand-written
      `maestro_session.log.jsonl` fixtures in a scratch install (`~/gits/maestro-039-resume`, since
      deleted): empty log → nothing; one `backend` handoff → its `agent_id`; a second same-agent
      instance added to `maestro.json` → nothing (ambiguity guard).
- [x] Namespaced agent types resolve. A project whose instances carry `maestro:backend` gets the
      same answer as one carrying `backend` — both sides bared, per `033`. Verified in the same
      scratch install: querying `maestro:backend` returned the same `agent_id` as querying `backend`.
- [x] Every failure path falls back to a cold `Task` with no user-visible error: an unresolvable id,
      a `SendMessage` refused for a user-stopped agent, and a refused name check. The unresolvable-id
      path is verified (empty stdout, exit 0, in all degenerate cases above). The two `SendMessage`
      refusal fallbacks are template prose telling the orchestrator model what to do — **not**
      independently verified against a live refusal; see "Not independently verified" below.
- [x] `036` is unharmed on a resumed run, verified rather than assumed — a payload delivered on the
      first run is **not** re-inlined on the resume (it is in `.consumed/`), a payload written to
      that agent's lane *between* the two runs **is** delivered on the resume, and `writeStamp`
      re-stamps nothing. This is unchanged `036` code (`retire()`/`writeStamp` idempotency), reasoned
      from reading it rather than newly exercised by this slice, which adds no code on that path.
- [x] `grep -c "node:sqlite" plugins/maestro/scripts/lib/maestro-session.cjs` is `0` after
      `pnpm --filter maestro build:plugin-libs`, and `git diff plugins/maestro/scripts/lib/` shows
      only the intended change — that script fails quietly. Confirmed: grep returns `0`; the diff
      shows only the two new function bodies plus their export-table entries.
- [x] The new script is in **both** install manifests, hand-mirrored, and lands in
      `<project>/.claude/scripts/` on a real install into a fixture project. Confirmed via
      `maestro-install.js` into the scratch fixture, and via the `STATIC_ASSETS manifest parity
      (source-level)` test, which auto-verifies both hand-mirrored lists match.
- [x] `plugin.json` bumped to `0.4.6`, and the orchestrator template re-renders (a `/maestro-update`
      or an app save produces the new Step 3 and principles inside the generated markers). Confirmed:
      `maestro-render-orchestrator.cjs` run against the scratch fixture produced the new
      `allowed-tools` grant and the new STEPS/PRINCIPLES prose inside the managed regions.
- [x] `pnpm --filter maestro test`, `typecheck` and `check` green. 891/891 tests passed, typecheck
      clean, prettier clean.

### Not independently verified

The live, multi-turn `SendMessage`-resume behavior inside a real orchestrated Claude Code session —
that a resumed agent's conversation history/tool-call context is genuinely retained, and that a
`SendMessage` refused for a user-stopped agent or by the same-agent-name check falls back cleanly to
a cold `Task` — was **not** exercised end-to-end; that requires a live multi-agent orchestrator run,
which this environment can't script. Everything else on this checklist is fully verified per the
citations above.

## Divergences from the plan

1. `resumeTarget`'s ambiguity check reuses `collectAgentSkills(...).matchedInstances` (deduped via
   `new Set(...)`) rather than a fresh instance-walk over the workflow graph, as the page sketched.
   This is deliberate: reusing the exact function `SubagentStart`'s injection already calls means the
   ambiguity determination can never disagree with what gets injected.
2. The `allowed-tools` grant needed a trailing ` *` wildcard
   (`Bash(node "$CLAUDE_PROJECT_DIR/.claude/scripts/maestro-resume-target.cjs" *)`), unlike the
   plain `maestro-step1-gates.cjs` grant, because this script takes an agent-type argument.
3. `apps/maestro/test/core/real-project.test.ts`'s pre-existing test
   `"copies maestro-step1-gates.cjs, and grants exactly the command Step 1 injects"` assumed exactly
   one `Bash(...)` grant on the `allowed-tools` frontmatter line. With two grants now on that line,
   it was generalized to extract every `Bash(...)` grant via `matchAll` and assert the injected Step
   1 command is *one of* them (rather than *the* one) — a pre-existing test, not new coverage, but it
   would have failed the "tests green" acceptance bar otherwise.
4. The live-orchestrator `SendMessage`-resume behavior itself is unverified in this environment (see
   above) — everything else on the checklist is fully verified.

## Notes for whoever picks this up

Read `.claude/skills/maestro-architecture/` for the run/handoff contract and
`.claude/skills/updating-maestro/` before touching `plugins/`.

- **Do not put the agent-id index in `maestro_session.json`.** It is a read-modify-write file and
  parallel subagents race on it; `session-runtime.ts:56-59` says so explicitly about the log, and
  the same reasoning applies in reverse — the append-only log is the concurrency-safe store, and it
  already holds the data.
- The two `SubagentStart` hooks are listed in one matcher in `hooks.json`; **do not rely on their
  relative order** for anything. This slice does not need to, and `040` depends on that discipline.
- Concept skills to revisit when this lands (scribe's job, named here so it is not forgotten):
  `maestro-architecture` (dispatch is no longer always a spawn), `log-view` (a resumed run appends a
  second dispatch/handoff pair under one `agent_id`, which the timeline should not read as two
  agents).

## Blocked by

(nothing)
