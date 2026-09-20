# Deriving instances and correlating by `agent_id`

`buildInstances` in `src/renderer/src/utils/session-log.ts` (pure, no Node imports) walks entries in
order and starts a **new segment whenever `origin` changes**. Everything else on an `Instance` —
`input`, `offeredSkills`, `delivered` — is correlated by `agent_id` **bounded by position in the log**
(`042`), because segment membership alone gets it wrong.

## Segmentation

- The same agent appearing after a main-session interlude becomes a **separate step** (correct — it's a
  second invocation). Before `039` this also meant a fresh `agent_id`, since each invocation was a cold
  `Task`; a **resumed** run (`SendMessage` to an agent with a completed run this session) still segments
  into a separate step, but now shares its `agent_id` with the run it resumed.
- The main session itself segments into multiple "Main Session" steps when subagents interleave (normal
  for sequential Maestro dispatch).
- Parallel subagents would fragment — they'd interleave their tool-call lines into many steps — but
  Maestro runs agents sequentially, so this is normally not an issue in practice. `agent_id`
  correlation keeps input↔output paired correctly even in edge-case interleaving.

## Status, label, output

Populated from the first `kind:"handoff"` entry found within the segment (matching `origin`); a
`kind:"transition"` entry instead sets `status:"transition"` and keeps its message as `output`.

## The `(p, h)` window

**Input** is correlated by `agent_id`, bounded by position in the log (`042`): resolve the segment's own
handoff index `h` (or, when the segment has no handoff — an in-flight or killed agent — the end of THAT
SEGMENT, which for a genuinely in-flight agent is the end of the log; not `entries.length`
unconditionally, or a killed agent's card would reach forward and claim the dispatch of a later run of
the same type) and the previous handoff index `p` — the nearest handoff for that same `agent_id` sitting
before `h`, `-1` when there is none — then take the *latest* `dispatch` entry for that `agent_id` whose
index falls in `(p, h)`, not the last one in the whole file.

Fallback: if the segment's handoff has no `agent_id` (or there is no handoff at all), search for a
`dispatch` entry matching by `agent` type instead, over the same `(p, h)` window — `p`/`h` here come
from `lastEndByOrigin`, tracking the end of the previous segment sharing that `origin`, since there's no
`agent_id` to key off in this branch.

## Deliveries use the same window (`037`, bounded by `042`)

Every `channel_delivery` entry in `entries[]` is grouped up front into a
`Map<agent_id, {index, delivery}[]>` (entries preserved in log order), because a `channel_delivery`
entry's `origin` is hardcoded `"main_session"` by the injector and lands in whichever main_session
segment happens to be current at write time — **never** in the receiving instance's own segment.
Segment membership therefore cannot be used to attach a delivery; only `agent_id` can.

For each non-main-session instance, the SAME id that already resolved `input`/`offeredSkills` looks the
map up, filtered to entries whose index falls in that instance's own `(p, h)` window — so a delivery
logged between two runs of a resumed agent lands on the later run's card only, never both. An
`agent_id` matching no instance is simply never pulled out of the map — nothing crashes, nothing
attaches to an arbitrary instance; it is just absent from every card. This is why `delivered` is
populated in the *same* per-instance loop as `input`/`offeredSkills`, not a separate pass.

## Things that bite

- **A resumed run (`039`) puts two `dispatch`/`handoff` pairs under one `agent_id`.** A condition-edge
  loop-back that resumes an agent with a completed run this session (see `maestro-architecture`'s
  Runtime lifecycle) keeps the SAME `agent_id` across both invocations — `SubagentStart`/`SubagentStop`
  fire again, so `maestro-subagent-log.js` appends a second `dispatch`/`handoff` pair correlated to it.
  Before `042`, `dispatchByAgentId` was a plain `Map` filled by one forward pass (last-write-wins), so
  BOTH segments — including the first run's own — read back the resumed run's `input`/`offeredSkills`,
  and `deliveredByAgentId` (pushing onto an array, so no data loss but no separation either) meant both
  cards rendered every delivery logged under that `agent_id`. The fix is the `(p, h)` window above,
  applied to the dispatch lookup, the name-based fallback and the delivery filter alike — the log is
  append-only, so a run's own boundary is already implicit in file order; no new hook state (no run
  counter, no id change) was needed. Segmentation itself was never affected (still one card per `origin`
  change) — it was only `input`/`offeredSkills`/`delivered` that could misattribute across a resumed
  agent's two cards.
- **A `channel_delivery` entry's `origin` tells you nothing about who received it (`037`).** It is
  always `"main_session"`, hardcoded by the injector, exactly like a `dispatch` entry — so grouping log
  entries by segment would put every delivery on a Main Session card, never on the agent it was
  delivered to. The only correct correlation key is `agent_id`, shared with the receiving instance's own
  dispatch/handoff. If a delivery is ever missing from the card it plainly belongs on, check that its
  `agent_id` actually matches that instance's `handoff?.agent_id ?? dispatch?.agent_id` before
  suspecting the render layer.
- **`humanizeLog` returns `null` for bare `Agent`/`Task(...)` lines.** These PreToolUse entries capture
  the tool dispatch from the main session, but the richer `kind:"dispatch"` entry from
  `maestro-subagent-log.js` covers the same event more informatively. The nulls are intentionally
  filtered in `session-log-view.tsx`. Do not "fix" them.
- **`session-log.ts` must remain node-free.** It is renderer code. All `fs`/`path` work belongs in
  `src/main/`; `test/isolation.test.ts` fails the build on a `node:` builtin, a `@repo/claude-fs`
  import, or an import of the `src/core/index.ts` **barrel** anywhere outside `src/main/` — the barrel
  re-exports `fs` and `child_process`, so type-only imports must name `src/core/contracts.ts` instead.
