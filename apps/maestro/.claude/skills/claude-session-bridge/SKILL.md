---
name: claude-session-bridge
description: "Explains how the Maestro desktop app runs Claude: the preview→token→run pipeline that is the app's whole security design, the live Agent SDK session in the pane, the four routes by which a tool call can be refused, and the pure modules that bound what a session may read, write, spend and ask (read-scope, write-scope, session-scope, session-budget, permission-registry, session-question, session-resume, session-handoff). Use when working inside apps/maestro and asking how a run is started, why a run was refused a read or a write, where a permission prompt comes from, how a budget ceiling is lifted, how a session resumes a terminal conversation, or why a module here must not import fs or child_process."
metadata:
  type: concept-skill
  version: "2.0"
  last-update: ff24b375eadb31a3b2628a3070bc8631a08063fa
---

# Claude session bridge

Everything in the Maestro app that causes a Claude process to exist goes through this cluster in
`apps/maestro/src/core`, plus one owner in the main process. Both of its entry points now run on
the **Agent SDK** — `claude-run.ts` stopped spawning `claude -p` at task `018` — so what separates
them is not the spawn path but the **authorisation**:

|                  | One-shot run                                                    | Pane session                                          |
| ---------------- | --------------------------------------------------------------- | ----------------------------------------------------- |
| Started by       | `runPreviewedClaude(token, …)`                                  | `startSession` / `resumeSession` in main              |
| Its prompt is    | built by `claude-preview.ts`, shown, then authorised by a token | typed by the user, verbatim                           |
| Tools / skills   | `SESSION_TOOLS` / `SESSION_SKILLS`                              | `PANE_TOOLS` / `PANE_SKILLS` (adds `AskUserQuestion`) |
| Can ask a person | no — allow or deny only                                         | yes — the host parks the promise                      |
| Teardown         | `cancelClaudeRun(token)`                                        | `endSession(webContentsId)` — the pane holds no token |

The invariant the whole cluster is built around: **the module that builds a prompt cannot start a
process, and the module that starts a process cannot build a prompt.** `claude-preview.ts` issues a
one-time token; `claude-run.ts` takes a token _and nothing else_. The pane restates it from the
other side: main never composes a prompt, so the only prompts there are ones the user **wrote**.

That is a claim about the import graph, and it is **enforced by tests, not by convention** — see
[The invariants are asserted](#the-invariants-are-asserted). Adding an `fs` or `child_process`
import to one of these modules defeats the design; the test is what makes it fail loudly.

## Files

**The one-shot pipeline** — see [run-pipeline](sub-concepts/run-pipeline.md).

| File                     | Lines | What it owns                                                                                           |
| ------------------------ | ----- | ------------------------------------------------------------------------------------------------------ |
| `core/claude-preview.ts` | 540   | Builds the prompt for all 6 request kinds, reports CLI availability, issues the token. Spawns nothing. |
| `core/claude-tokens.ts`  | 150   | The token contract. The security design in one file.                                                   |
| `core/claude-run.ts`     | 308   | Claims a token, drives an SDK session, owns the detached process group.                                |
| `core/claude-cli.ts`     | 179   | Locating the `claude` binary, and the `PATH` a GUI launch does not have.                               |

**The SDK, and the pane's owner** — see [agent-sdk](sub-concepts/agent-sdk.md).

| File                     | Lines | What it owns                                                                                                      |
| ------------------------ | ----- | ----------------------------------------------------------------------------------------------------------------- |
| `core/agent-sdk.ts`      | 2185  | The app's **only** importer of the SDK. `startAgentSession`, `startPaneSession`, `nodeSettings`, the smoke check. |
| `main/claude-session.ts` | 1056  | One live session per window. Composes no prose and resolves no CLI path.                                          |

**The pure modules.** No `fs`, no spawn, no SDK — which is what lets `claude-preview.ts` import
them while remaining unable to spawn, and what lets every decision below be unit-tested without a
window. Each has a test of the same name under `test/core/`.

| File                          | Lines | Answers                                                                              |
| ----------------------------- | ----- | ------------------------------------------------------------------------------------ |
| `core/read-scope.ts`          | 266   | What a run _will_ be able to read, before it starts, with each path's origin.        |
| `core/write-scope.ts`         | 151   | May this one tool call write?                                                        |
| `core/session-scope.ts`       | 268   | Did this read stay inside the disclosed directories — and what could a person grant? |
| `core/session-budget.ts`      | 266   | What may it spend, and how is a ceiling continued past?                              |
| `core/session-permission.ts`  | 331   | Settle it, or ask a person? Composes the two above; decides nothing itself.          |
| `core/permission-registry.ts` | 123   | The parked promises, and every way they end.                                         |
| `core/session-question.ts`    | 196   | `AskUserQuestion` — same wire, different meaning.                                    |
| `core/session-resume.ts`      | 313   | Which stored conversations may be offered, and what must be disclosed first.         |
| `core/session-handoff.ts`     | 118   | What a create-\* form says to the session it hands off into.                         |

## How a tool call is decided

**Four routes can refuse one, and they share no code.** An agent debugging "why was this refused"
is usually looking at the wrong one:

1. **`canUseTool`** — the SDK asks the host. `decideWrite` for the headless run; `decidePaneCall`
   for the pane, which returns `settled` (allow, or a deny not worth asking about) or `ask`.
2. **The `PreToolUse` hook** — fires for _every_ call, **before** the permission flow, and is where
   the bound on **reads** lives (`decideBoundary`). `canUseTool` cannot do this job: reads are
   auto-approved and never reach it.
3. **A person**, answering a prompt the host parked. Allowing a write grants that one call and
   nothing more; allowing a read may also grant a directory for the session's lifetime.
4. **The CLI's own permission system** — a deny rule or the permission mode, refusing before
   `canUseTool` is ever called. It surfaces only as a `permission_denied` stream event, and
   `autoRefusal` turns it into a transcript entry. This is the route a user's own configuration
   takes, and the one they can least diagnose.

`decidePaneCall`'s ordering is the design: always-ask tools (`WebFetch`/`WebSearch`) first, then
the read boundary **over read-only tools only**, then `decideWrite`. Letting the boundary answer
for writes too would replace `decideWrite`'s reason with a different one, and a refused write is
required to keep its own — the model reads that sentence and acts on it.

## Things that bite

- **`write-scope.ts` returns `allow` for `Read` without looking at the path**, and adding a check
  there _looks like the fix and is not_: reads never reach `canUseTool`, so the check would never
  run. The read bound is `session-scope.ts`, applied by the hook.
- **The two fall-throughs are opposite, deliberately.** `decideWrite` denies what it does not
  recognise (it is the whole decision for a call). `decideBoundary` allows it (it is a path check
  running in front of a permission model that still applies). Making them agree breaks one of them.
- **Never resolve a `canUseTool` promise to `undefined` or `null`.** The SDK reads that as "the
  host answered out of band" and writes no `control_response` at all — the tool call hangs forever
  with nothing on screen. Every arm of `ParkedAnswer` is a real result and the fall-through is a
  deny.
- **Every exit must drain the registry.** Nothing times out anywhere below `permission-registry.ts`;
  an unresolved ask is a permanently wedged session holding a detached child. `denyAll` is called
  from window close, project switch and quit.
- **A permission prompt and a structured question arrive on the same wire.** `agent-sdk.ts` branches
  on the tool name _first_ so `session-permission.ts` never sees an `AskUserQuestion`. Routing one
  there renders "Claude wants to use a tool — Allow / Deny" for what is actually a choice of options.
- **`session-runtime.ts` and `session-log.ts` are not this concept**, despite the prefix. They are
  the hook-written files under `<project>/.claude/` — see `maestro-architecture` and `log-view`.
- **Tokens are shared with the usage-stats reader.** `ccusage.ts` and `claude-run.ts` use one store,
  and `claimInvocation` takes an `InvocationPurpose` for that reason. Claiming without it would let
  a stats preview spawn `npx` while every message on screen said Claude.

## The invariants are asserted

`test/isolation.test.ts` holds four **reviewed lists** — deliberately short enough to read, so a
widening arrives as a diff to a line with a paragraph of reasoning above it, not as an import
nobody looked at. When a change here fails one, the list is the thing to think about; editing it to
go green is the failure mode it exists to catch.

| The list                                               | Currently                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| Modules that resolve the CLI path                      | `agent-sdk.ts`, `claude-preview.ts`                                |
| Modules that claim a token (purpose pinned per module) | `ccusage.ts`, `claude-run.ts`                                      |
| Modules that import `child_process`                    | those two, plus `discovery.ts`, `git.ts`, `install.ts`, `rules.ts` |
| `--permission-mode acceptEdits`                        | nowhere in the app                                                 |

`test/core/claude.test.ts` walks `claude-preview.ts`'s **transitive** import graph and fails if a
spawn reaches it. That is why the settings cascade is handed in as a `SettingsPort` rather than
imported: resolving it lives in `agent-sdk.ts`, which can spawn.

**The design record is `.claude/maestro-tasks/`.** Tasks `007`, `008`, `013`, `015` and `017`–`026`
are this cluster, one slice each, and the code comments cite them by number. They carry the
measurements the comments assert. Comments also cite `SESSION-PANE-PLAN.md` — **it was never
committed and does not exist**; do not go looking for it.

## Relationships

- [`create-skills-architecture`](../create-skills-architecture/SKILL.md) — the four create-\* flows
  are this bridge's main caller; `session-handoff.ts` is the seam where a form becomes a conversation.
- [`maestro-config-model`](../maestro-config-model/SKILL.md) — the project a run's scopes are derived
  against.
- [`global-stores`](../global-stores/SKILL.md) — `update-skill-tags` previews from the tag store and
  writes back through a fenced block in the pane's reply.
- `maestro-architecture` (repo root `.claude/skills/`) — the _other_ way Claude runs in Maestro:
  hooks inside a session the app never started. Nothing in this cluster runs there.

## Sub-concepts

- [Run pipeline](sub-concepts/run-pipeline.md) — preview → token → run, and why it is three files.
- [Agent SDK integration](sub-concepts/agent-sdk.md) — the right package, the packaging traps, the
  tool and skill lists, and the environment the child gets.
- [Scope modules](sub-concepts/scopes.md) — read, write and session scope, and which answers what.
- [Budgets and ceilings](sub-concepts/budgets.md) — spend limits that can be continued past.
- [Asking a person](sub-concepts/asking-a-person.md) — the parked-promise registry, permission asks,
  grants, and structured questions.
- [Resume and handoff](sub-concepts/resume-and-handoff.md) — picking up a terminal conversation, and
  seeding one from a form.
