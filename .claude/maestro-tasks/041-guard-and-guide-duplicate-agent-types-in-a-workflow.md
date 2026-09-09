# Guard and guide duplicate agent types in a workflow

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Two instances of one workflow carrying the same `agent` (`@backend-api` and `@backend-worker` both
on `maestro:backend`) breaks four things silently. The canvas already prevents it. Nothing else
does, and the canvas offers no way forward when you legitimately want two.

### What breaks, and why it is one fault rather than four

Every failure traces to a single fact: **`SubagentStart` receives `agent_type`, never the instance.**
A `Task` dispatch carries `subagent_type`; no instance name exists anywhere in the hook payload. So
everything downstream keys on `bareAgentName(inst.agent)` and two instances collapse into one:

| # | Where | What happens |
| --- | --- | --- |
| 1 | `handoff-routes.ts:94-96` | Dedup keys on `` `${sender} ${label}` `` with `sender` the **bare agent**. `@backend-api --success--> @test` and `@backend-worker --success--> @reviewer` both key `backend success`; **first wins and the second route is silently discarded** — no `HANDOFF:` entry, no protocol injected, and `handoffPairs` never emits `backend/reviewer` so the install sync materializes no template for it. Which survives depends on node order in `maestro.json`. |
| 2 | `success-path.ts:97-105` | `loadedSet`/`referencedSet` accumulate across every matching node, so each instance is injected with the **union** of both instances' skills. `offeredSkills` in `maestro-subagent-log.js` logs the same union, so `/session-log`'s skillsTriage diff cannot flag it either. |
| 3 | `handoff-channels.ts` | `laneFor` is `<bare sender>.1.md`, so both write `.claude/channels/test/backend.1.md` and the second overwrites the first. Worse, `writeStamp` matches on the filename's sender segment, so one instance's `SubagentStop` stamps the other's file — the comment at `:96-99` promises this cannot happen, and it is true only across agent *types*, not instances. |
| 4 | `maestro-subagent-log.js` | Dispatch and handoff entries carry `origin: agentType`, so `/session-log` renders two instances as one agent and `generated_instances` records both names for a single run. |

Route loss (1) is the severe one: a wired edge disappears from the runtime with nothing reported
anywhere.

### The canvas already prevents this — say so, and keep it

`workflow-canvas.tsx:1054-1062` builds `placedAgentTypes` from the placed instances, `:1144` filters
those out of the picker's `availableAgents`, and `instance-picker.tsx:128-130` already puts the
reason on screen:

> Every available subagent is already placed in this workflow — a subagent can only appear once,
> since the runtime routes handoffs by agent type.

**Do not weaken or remove that guard.** It is correct, and it is scoped per workflow, which matches
how the hook resolves (`searchList` is the active workflow). This slice adds the two things around
it that are missing.

## Part 1 — validate the config, because the canvas is not the only writer

`maestro.json` is explicitly hand-editable: `CLAUDE.md` says so, and `/maestro-update`'s own
description is "use after hand-editing maestro.json". A hand-edit, a merge conflict resolution, or
any third-party write can produce the collision the canvas refuses to create, and today it reaches
the runtime with no complaint from anything.

Add a pure validator in `apps/maestro/src/core/config-validate.ts`:

```ts
export interface ConfigIssue { kind: string; workflow: string; detail: string; }
export function duplicateAgentTypes(cfg: MaestroConfigV3 | null): ConfigIssue[];
export function validateConfig(cfg: MaestroConfigV3 | null): ConfigIssue[];
```

`duplicateAgentTypes` reports, **per workflow**, any bare agent carried by more than one *placed*
instance — placed, not merely defined, since an unplaced instance costs nothing. `validateConfig` is
the aggregate seam so the next check has somewhere to go; do not invent other checks in this slice.

Surface it in the three places that read a config a human may have edited:

- **The app**, on config load: a dismissible banner naming the workflow and the agent, in the
  established style of `seeded-banner.tsx`. Not a modal, and it must not block editing — the user
  may be mid-repair.
- **`/maestro-update`**, which re-renders the orchestrator from `maestro.json`: report the issue
  before rendering. Render anyway — refusing to render leaves the project with a stale orchestrator,
  which is worse than a rendered one plus a warning.
- **The install path**, beside the existing sync summaries.

Report; never auto-fix. Renaming somebody's instance or deleting a node is not a repair the tool gets
to choose.

## Part 2 — make the picker's dead end a fork affordance

When every agent is placed, the picker says *"Add another subagent from the left panel, or reuse an
existing"* — and omits the one answer that actually works. **Forking is the supported way to get a
second distinct `backend`**, and it is the fix precisely because it produces a different `agent`
value, which dissolves all four failures at their shared root rather than papering over each.

The machinery already exists. `forkAgent(projectRoot, bundledDir, bundledPluginVersion, agentName,
newName?)` (`agent-fork.ts:100`) supports a **renamed** fork: it writes
`.claude/agents/<newName>.md`, rewrites the frontmatter `name:` via `renameAgentInFrontmatter` so two
files cannot both claim one identity (`:129`), copies the avatar/type/project-tag rows across
(`copyAgentAttributeRows`), and writes the provenance sidecar `031` needs to keep the fork in step
with its template. It already refuses a name collision (`:124-126`) and enforces kebab-case
(`:116-118`).

So the empty-state message becomes an offer: *fork `backend` as a new agent* → name field →
`agent:fork` with `newName` → the new agent becomes selectable and the instance is created on it.

Confirm — do not assume — that a freshly forked project agent appears in `config.agents_available`
(`workflows.tsx:407`) without a restart, and wire whatever refresh is needed. A fork the picker
cannot then select is a dead end with extra steps.

## Interaction with `039`

`039` refuses to resume when an agent type is ambiguous within the active workflow, and falls back
to a cold `Task`. That stays exactly as written — it is the runtime's last line of defence and must
not trust the config. What changes is that after this slice the ambiguity is genuinely rare: the
canvas prevents it, the validator reports it, and forking is the offered way out.

## Files

| File | Change |
| --- | --- |
| `apps/maestro/src/core/config-validate.ts` | New. `duplicateAgentTypes`, `validateConfig`, `ConfigIssue`. |
| `apps/maestro/src/core/index.ts` | Export them. |
| `apps/maestro/src/renderer/src/routes/workflows.tsx` | The banner; ensure a fresh fork reaches `agents_available`. |
| `apps/maestro/src/renderer/src/components/instance-picker.tsx` | The fork affordance in the all-placed empty state. |
| `plugins/maestro/scripts/maestro-render-orchestrator.cjs` | Report issues before rendering (render anyway). |
| `apps/maestro/src/core/install.ts` | Report issues beside the existing sync summaries. |
| `plugins/maestro/.claude-plugin/plugin.json` | **Patch bump** — behaviour change to an existing script, no new skill/agent/command/hook event. Take the next patch after whatever is current when this lands; do not assume a number here, `039` and `040` also bump. |

## Acceptance criteria

- [x] `duplicateAgentTypes` reports a workflow with two **placed** instances on one bare agent, and
      reports nothing for: one placed + one unplaced on the same agent, two instances on the same
      agent in **different** workflows, and namespaced-vs-bare spellings of the same agent
      (`maestro:backend` vs `backend`) which must compare equal.
- [x] The app shows a dismissible banner naming workflow and agent when a hand-edited config
      contains the collision, and editing is never blocked.
- [x] `/maestro-update` reports the issue **and still renders** the orchestrator.
- [x] Nothing auto-repairs a config — no instance renamed, no node removed, no agent reassigned.
- [x] The canvas guard is unchanged: with every agent placed, the picker still offers no duplicate,
      and `placedAgentTypes` still filters `availableAgents`.
- [x] From the all-placed empty state, a user can fork an agent under a new name and immediately
      create an instance on it — verified end to end in a packaged window per `test-maestro`,
      through to `.claude/agents/<newName>.md` existing with its frontmatter `name:` rewritten and a
      provenance record in `agent-forks.json`.
- [x] After that fork, the two instances no longer collide: distinct `HANDOFF:` routes are injected
      for each (route loss #1 gone), skills are no longer unioned (#2), and they write distinct
      channel lane files (#3). Assert these three directly — they are the point of the slice.
- [x] `pnpm --filter maestro test`, `typecheck` and `check` green.

All criteria met and verified — 919 tests passing. See "Divergences from the plan" below for where
the implementation departed from this page's Files table and why.

## Divergences from the plan

1. **`test/isolation.test.ts`'s `RENDERER_SAFE = ["contracts", "text"]` forced the validator's
   result to travel a different path than this page implied.** `config-validate.ts` could not be
   imported by `workflows.tsx` directly. `ConfigIssue` moved into `contracts.ts`;
   `duplicateAgentTypes` is computed in the MAIN process, inside `src/main/ipc.ts`'s `workflowsData`
   handler, and the result travels to the renderer as `configIssues: ConfigIssue[]` on
   `WorkflowsData` (`src/shared/ipc.ts`) and `MaestroConfigResult` (`src/renderer/src/utils/maestro.ts`).
   Touched four files this page's Files table never named: `contracts.ts`, `main/ipc.ts`,
   `shared/ipc.ts`, `utils/maestro.ts`.
2. **`config-issue-banner.tsx` is a new sibling component, not an extension of `seeded-banner.tsx`.**
   `seeded-banner.tsx` has no dismiss affordance and the two conditions are independent and can
   co-occur, so following "in the established style of seeded-banner.tsx" meant matching its visual
   style, not extending it.
3. **`apps/maestro/src/renderer/src/routes/maestro.tsx` was touched** (not in the Files table) to
   render `InstallReport.configIssues` in `ReportCard`, beside the existing `reportsSync`/
   `handoffsSync` bullets — required to actually surface what `install.ts` now returns.
4. **`handleAgentForked` had to be defined AFTER `handleSubmit` in `workflows.tsx`**, purely for
   test-ordering reasons: `test/isolation.test.ts`'s "saving refreshes loader data" test does a
   plain `src.indexOf(...)` string search asserting `router.invalidate()` comes after a specific
   line, and `handleAgentForked` also calls `router.invalidate()`. No behavior divergence, just
   placement.
5. Plugin version bumped `0.4.7` → `0.4.8` (patch) — behaviour change to
   `maestro-render-orchestrator.cjs`, no new skill/agent/command/hook event.
6. **The fork dropdown offers only non-project agents**, which this page's Part 2 never says.
   `forkAgent` throws on a project-tier agent (`agent-fork.ts:112` — "already a project agent —
   there's nothing to fork"), which is exactly why `/agents` hides its own fork button for those
   (`agent-card.tsx`'s `isProjectTier`). Offering every placed agent meant a first fork produced an
   agent that could not itself be forked, and a project whose agents are all project-tier got a
   dropdown where every option failed. `workflows.tsx` now derives `forkableAgentIds` (discovered
   agents whose `source !== "project"`) and threads it through `WorkflowCanvas` to the picker's new
   `forkableAgents` prop; with nothing forkable the block is hidden and the dead-end prose stops
   offering it. Pinned in `test/isolation.test.ts` ("the instance picker only offers forkable
   agents") — the failure is a confusing error, not a crash, so no render test would catch it.
7. **Two of this slice's own tests asserted less than their names claimed, and were tightened.**
   `duplicate-agent-fork-dissolves.test.ts`'s `#3` block compared
   `laneFor("/project", "backend", "scribe")` to itself and could not fail; it now resolves each
   lane from the fixture instance's own `agent` via `bareAgentName`, the way the runtime does, so
   it would break if lanes ever became instance-keyed. `config-validate-render.test.ts`'s
   healthy-config case was titled "reports nothing on stderr" but only checked stdout; it now
   asserts `stderr === ""`.
8. **The `saving refreshes loader data` pin now indexes over code rather than comments.** Its plain
   `indexOf("router.invalidate()")` matched the string inside a comment added near the top of
   `workflows.tsx`, failing a test about where a call sits. Stripping line comments before the
   search removes the false positive without weakening the ordering property — every real call is
   still counted, so divergence 4's placement constraint still holds.

## Notes for whoever picks this up

Read `.claude/skills/agent-fork-sync/` before touching the fork path — a fork created without a
provenance record is permanently unsyncable, and `031` depends on it.

- The four failures above are **stated from source, not reproduced**. Reproduce at least route loss
  (#1) against a hand-written two-instance config before building, so the validator is written
  against observed behaviour rather than this page's reading of it.
- Resist making the runtime instance-aware instead. It cannot be: the hook has only `agent_type`.
  Any design that needs the instance name at `SubagentStart` requires the orchestrator to smuggle it
  into the `Task` prompt for the hook to parse back out — a protocol it will get wrong silently.
- Concept skills to revisit when this lands (scribe's job): `maestro-config-model` (the constraint
  is now checked, not merely implied), `agents-view`/`agent-fork-sync` (forking is now a documented
  route out of the picker's dead end).

## Blocked by

(nothing)
