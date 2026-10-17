# Give docs-only work a route when it turns up a code change

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

A post-mortem from the code-graph repo (epic absorb-concept-skills, task 007, report r005) found a routing gap in Maestro, and this task evaluates and fixes it.

**What happened.** Task 007 was 'retire superseded plugin commands and document the full plugin surface'. The orchestrator classified it as the Documentation workflow, which has a single scribe node and one edge (main-session → scribe). The scribe's reference sweep found user-facing message strings in application source (four files in packages/code-graph/src and packages/lsp/src) that still pointed to the removed commands. The scribe agent definition forbids touching application code, so it correctly stopped and returned a condition (partial success). The Documentation workflow has no route for that condition, so the main session improvised a backend dispatch: a second full subagent run (32 tool calls) outside any workflow path.

**Contributing cause.** The ticket was written by to-maestro-tasks. Its description listed only docs targets ('other skills, docs, CLAUDE.md, README'), while an acceptance criterion ('no file in the repo still points users at …') implied source changes. The orchestrator classified on the description.

**Same class seen before.** Task 003 in the same epic (report r001) found that the backend agent cannot write tests, so a 'ported tests pass' criterion was unmeetable until the test step ran. Both are role boundaries that force an unplanned loop because the ticket or the workflow did not anticipate them.

**Seen again, with a clear ticket.** Task 017 in the same epic (report r015) was "let a subagent scribe enrich small target sets inline and use core-first on first touch". It was mostly skill (SKILL.md) edits, but its description also named code: reword `thinCoreMessage` in packages/code-graph/src/scribe/core.ts and update its test, bump three version files, regenerate the bundle. The orchestrator still routed it as the Documentation workflow (@scribe only). The scribe did only the skill file-map row and returned HANDOFF: partial, and the main session had to dispatch @backend outside the workflow again. Unlike 007, the description did state the code changes, so fix A alone wouldn't have prevented this. The classifier seems to weigh the title and the dominant file type (skills = docs) over the code work listed in the body. That favours B, and it's a reason to reconsider C (or a lighter form of it: "any code, test, version or build step in the description → not Documentation").

**Proposed fixes to evaluate (A + B).**
- **A. Ticket writing (to-maestro-tasks guidance).** When a task sweeps references or names across the repo, the ticket must say explicitly whether user-facing strings in source are in scope, and its description must agree with repo-wide acceptance criteria, so classification picks a workflow that can change code.
- **B. Documentation workflow.** Add a condition edge from the scribe to the backend for 'needs a code change', returning to the scribe or the reviewer afterwards, so a docs task that discovers code follows a defined route instead of an improvised one. Decide whether this belongs in the default Documentation workflow that Maestro seeds into projects (so projects like code-graph get it on /maestro-update) or only in this repo.

Rejected for now: C, a classification rule in the orchestrator prose ('repo-wide criteria imply source may change'), because it overlaps B and touches prose every session runs on. Reconsider it if A and B prove insufficient.

## Acceptance criteria

- [x] A decision is recorded on A and on B (adopt, adapt or reject, with the reason)
- [x] If A is adopted, the to-maestro-tasks skill tells ticket writers to state source-string scope for repo-wide sweeps and to keep the description consistent with repo-wide criteria
- [x] If B is adopted, the Documentation workflow has a condition route from the scribe to a code-capable agent and back, validated by the workflow tooling, and seeded projects receive it through /maestro-update — n/a, B rejected
- [x] The decision states whether the r001 case (backend cannot write tests) is covered or needs its own follow-up
- [x] The decision covers the r015 case (a ticket that states code work still routed as Documentation) and says whether C, or a lighter classification rule, is now adopted

## Decisions

- **A — adopted.** to-maestro-tasks Step 4 now tells ticket writers to put every kind of change the criteria need (source strings for repo-wide sweeps, code, tests, version bumps, build steps) in `whatToBuild`, and to state a later-step criterion as an end state. Covers 007; does not cover r015, whose description already named the code.
- **Unrouted condition — added (not in the original A/B/C).** In 007 and r015 the scribe's `HANDOFF: partial` matched no edge, `handoff-issues` printed nothing, and the orchestrator improvised. The SubagentStop hook now records an `unrouted` issue (`checkRoute` in `handoff-check.ts`) when a non-success label has no condition edge in the recorded workflow, and the orchestrator template says to stop and ask the user. Reaches existing projects through `/maestro-update` (plugin 0.11.26).
- **r001** — not a routing gap (the default workflow already runs @test after @backend); A's third bullet covers the ticket side. No follow-up.
- **Lighter C — adopted (covers r015).** Orchestrator Step 2 now says to pick a workflow whose agents can make every change the request names (code, tests, version bumps, a build or regenerate step), and that a mostly-docs request that also names code is not Documentation. It is in the managed STEPS region, so existing projects get it through `/maestro-update` (plugin 0.11.27). The full C ("repo-wide criteria imply source may change") stays rejected: A puts that signal in the description, where this rule reads it.
- **B — rejected for now.** With lighter C, a docs request that names code no longer routes to Documentation; with the unrouted check, a Documentation run that discovers code stops and asks the user instead of improvising. B would also reach new projects only, since `/maestro-update` never edits an existing workflow. Revisit if the unrouted stop fires often for Documentation.

## Blocked by

None — can start immediately
