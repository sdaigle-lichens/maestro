# The HANDOFF contract

The subagent has no static knowledge of its handoffs — the `SubagentStart` hook
(`maestro-inject-agent-context.js`) injects, per its active-workflow instance, four blocks on a
**first** run of an `agent_id` (a resumed run gets one line instead — see `agent-resume.md`):

1. **Skills**, in two kinds. `loaded_skills` are auto-loaded (`Skill` tool) before working — the
   imperative "load each one first" block. `referenced_skills` are surfaced as _available_: the
   agent loads one only if the task involves the logic that skill describes (it reads each skill's
   description to decide), otherwise ignores it. A skill that is `loaded` for any matched instance
   is dropped from the referenced list (loaded wins). **An id that resolves outside the repository
   root's `.claude/skills` gets an appended note (`061`)**: the Skill tool only indexes the root
   plus installed plugins, so a monorepo skill discovered elsewhere in the tree answers "Unknown
   skill" there. The hook resolves each injected id with `resolveProjectSkillPath`/`isRootSkillPath`
   (`apps/maestro/src/core/skill-resolve.ts`) and, for any that land outside the root, tells the
   agent to `Read` the file directly instead — an id that resolves inside the root keeps the plain
   wording. See `installing-maestro` for the shared tree walk this reuses.
2. **Routing lines** — the `HANDOFF:` labels this node may emit: `success` (when a success edge
   leaves the node, resolved _through_ non-agent nodes like `human review` to the next agent) plus
   each labeled `condition` edge. Unlabeled condition edges are skipped — they aren't routable.
3. An instruction to **end its final message with exactly one `HANDOFF: <label>`** (`success`, or
   the exact condition label).
4. **The `handoff_details` payload protocol per route** — see below.

The route walk itself is `handoffRoutes()` in `lib/maestro-session.cjs`, shared with the
install-time sync.

## The payload protocol, resolved across three tiers

The protocol is the JSON shape the sender must **write to its channel file**,
`.claude/channels/<receiver>/<sender>.1.md` (**`036`**; before it, the shape of a `handoff_details`
field in the final-message JSON, forwarded by the orchestrator — that forwarding is gone). Since
`033` the shape itself is resolved by one pure `resolveHandoff()` (`src/core/handoff-resolution.ts`)
that the hook and the app both call:

| Tier | Source | Editing surface |
| --- | --- | --- |
| 1 | the project file `.claude/handoffs/<sender>/<receiver>.md` | `/agents`' **Interactions** pane (also drops that pair's `syncedFrom`) |
| 2 | the machine-wide row in `~/.claude/maestro-handoff-defaults.sqlite` | `/templates`' **Handoffs** tab |
| 3 | the `SEED_HANDOFFS` constant (`src/core/handoff-seeds.ts`), shipped **inside** `lib/maestro-session.cjs` | none — a compiled-in constant, edited in source |

The seed tier is a real source, not a synonym for the global one: the sqlite bundle is `require`d in
a try/catch, so on a `node` older than 22.5 the seed is what still answers.

**A middle tier only exists if its bundle is where the running copy of the hook can `require` it** —
until `035` neither `lib/maestro-handoff-defaults.cjs` nor `lib/maestro-report-defaults.cjs` was
copied into `.claude/scripts/lib/`, so the project's own copy of this hook fell past the global row
in silence (to the seed for handoffs; to *nothing* for a report, which has no seed) while the
plugin's copy, running beside the whole `lib/`, answered correctly — making the arbitration winner
decide what an agent was told. Both are `STATIC_ASSETS` now; a project on a pre-`0.4.4` runtime
still behaves the old way until it re-installs.

Both ends of a route are **bare** agent names (`maestro:test` → `test`), which is what makes the id
`"<sender>/<receiver>"` map straight onto the project file's path. This is the whole communication
layer: agent files no longer carry their own handoff shapes. A route with no seed and no override
just gets the routing line, no payload. See `global-stores` and `agents-view` in
`apps/maestro/.claude/skills`.

Protocol templates live **only** in the agent template files, never in `maestro.json` — keeping the
app/skill byte-identical `maestro.json` invariant intact. The hook reads them as a side input,
exactly as it reads session state.

## What the orchestrator does with the line

The orchestrator (`templates/maestro/SKILL.md`, Step 5) reads the `HANDOFF:` line: `success`
continues the workflow's success path; a label matching a condition edge routes back to that edge's
target node — resuming the target agent when `maestro-resume-target.cjs` finds it a completed run
this session (`039`, see `agent-resume.md`), otherwise dispatching a fresh `Task` exactly as the
success path always does. A missing/unknown line is treated as `success` but flagged.

**It never sees the payload (`036`).** The sender wrote it straight to the receiver's channel file,
and the receiver's own `SubagentStart` inlines it — the orchestrator's job is routing only. The one
place the orchestrator still touches a channel file is a **skill step** in the success path: a skill
node has no `SubagentStart` of its own, so if it needs the upstream payload the orchestrator reads
`.claude/channels/<downstream receiver>/<upstream sender>.*.md` itself, **without retiring it** —
retiring is `SubagentStart`'s job alone, so a read here starves nobody; the downstream agent still
gets its own delivery.

**Condition edges from a `human review` node are the exception — orchestrator-driven, not
HANDOFF-driven.** A human-review node has no subagent, so nothing emits a `HANDOFF:` line for it.
Instead the orchestrator itself, at the human-review hard stop, reads the user's feedback: on
approval it continues the success path; on a correction request it dispatches the change as a `Task`
to the agent a `condition` edge points at (e.g. `human requested code corrections` → `@backend`),
rather than editing code in its own context. The seeded `default`/`tdd` workflows wire these edges
automatically (`buildWorkflow` in `maestro.ts`: default → impl agent(s), split per-agent for
fullstack; tdd → `@test`, since the human reviews the test plan before impl runs).

## Things that bite

- **Anything `.md` under `agents/` is discovered as an agent.** A frontmatter-less `.md` inside the
  agents tree gets registered as a phantom agent (e.g. `…:refactor:handoffs:backend`) with **All
  tools**, which is why handoff protocols were never kept there. Since `033` they are not files in
  the plugin at all: `plugins/maestro/templates/handoffs/**` is **deleted** and
  `readHandoffProtocol()` no longer exists. **To add a sender/receiver pair *that Maestro ships*,
  add a key to `SEED_HANDOFFS` in `apps/maestro/src/core/handoff-seeds.ts`** (a pair only *this
  machine* needs is a Create on `/templates`' Handoffs tab instead — a global row, no rebuild), then
  re-run `pnpm --filter maestro build:plugin-libs` — editing the source without rebuilding leaves
  the hook reading the old bundle. Editing an *existing* seed body additionally needs its previous
  text in `PRIOR_SEEDS`, or every machine that has already opened the global store keeps serving the
  old one, silently.
