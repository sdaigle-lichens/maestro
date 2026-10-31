# Keep a scribe gap report until a scribe acts on it

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

A skill gap a working agent reports to the scribe lane is lost if the scribe that receives it doesn't act on it. Make a gap survive until some scribe run actually handles it.

What happens today (apps/maestro/src/core/handoff-channels.ts): an agent writes `.claude/channels/scribe/<agent>.1.md` holding a `{"skill_gaps":[...]}` json block. Its SubagentStop stamps a run_id, and the next scribe SubagentStart inlines the file and `retire`s it into `.claude/channels/.consumed/scribe/`. SessionEnd's `sweep` then deletes everything under `.consumed/`. Task 111 (epic code-graph-cutover, report r006) hit this. A gap reported in agents-view run 1 was inlined into run 2's scribe, which was busy with its own documentation task and never ran update-single-concept-skill on it. The file was retired, and the gap is gone at SessionEnd.

The fix's shape is yours to choose. Keep it to the scribe lane's skill-gap reports; other lanes' handoff payloads keep today's deliver-once semantics. Some directions to weigh:
- the scribe lane is not retired on delivery, and the scribe acknowledges the gaps it handled (say, by naming them in its report or deleting the file);
- unhandled gaps are carried into a durable, append-only gaps file the scribe drains;
- delivery is retired as today, but sweep keeps scribe-lane files under `.consumed/` until they age out.

Whichever you pick:
- a scribe run must not see the same handled gap again;
- the 14-day `CHANNEL_AGE_CAP_MS` still bounds anything never handled;
- from code-graph 0.3.14, a gap's `missing` may read `enrich only: <name> (<filepath>), … — found by search "<query>"`. The scribe handles these by enriching those vertices, with no SKILL.md edit and no stamp. Treat that as handled too, and don't detect "handled" through a skill re-stamp. Maestro must not parse the `missing` text. code-graph's manager confirmed three cases:
  - the scribe's report names update-single-concept-skill, with no changed skill and no new version, which is normal;
  - a "left to enrich" remainder still counts as handled, because the next search that hits those vertices re-reports them;
  - a concept with no graph stops with nothing to enrich, and that also counts as handled;
- maestro must not depend on code-graph: the gap format is maestro's own, and code-graph only writes it.

Follow the publishing rules: edit src/core, run `pnpm --filter maestro build:plugin-libs`, copy changed libs to `.claude/scripts/lib/`, run the parity test, and bump the maestro plugin's patch version. Update the skills that describe the channel lanes (maestro-architecture and any sub-concept naming retire/sweep), and the scribe prompt or report default if the acknowledgement lives there.

Another session may have uncommitted changes to `.claude/maestro.json` and `plugins/maestro/.claude-plugin/plugin.json` (0.11.27). Check `git diff` before bumping, and bump on top of whatever is there. Never touch plan.md or merge-proposal.md at the repo root.

## Acceptance criteria

- [ ] A test reproduces the 111 sequence, failing before the fix and passing after: an agent writes a scribe gap, the next scribe run receives it and doesn't handle it, the session ends, and a later scribe run still receives it.
- [ ] A gap the scribe handled is not delivered again, covered by a test.
- [ ] Other lanes' deliver-once behaviour is unchanged, and the existing channel tests pass.
- [ ] A never-handled gap is still removed after CHANNEL_AGE_CAP_MS.
- [ ] Libs rebuilt, mirrors copied, parity test green, maestro plugin patch version bumped, and `pnpm verify` passes.
- [ ] The channel-lane documentation in the dev skills describes the new behaviour.

## Blocked by

None — can start immediately

## Post-Mortem

- **Problem:** The first pass treated any `skill_gaps` array as a gap report, empty ones included. Every seeded reviewer→scribe and refactor→scribe payload carries `skill_gaps: []`, so all of them lost deliver-once. Neither the design nor @test's first tests used the real seed shapes; the reviewer caught it, which cost a full @test → @backend loop-back.
  **Fix:** none
- **Problem:** Renaming gap reports at stamp broke `payloadWrittenSince`, which only looked at `<sender>.1.md`. A resumed sender then got a false missing_payload. The design didn't check who else reads the write slot.
  **Fix:** none
- **Problem:** @scribe ended with `HANDOFF: done`, which tdd has no route for, so the orchestrator stopped for the user (the same issue as task 114).
  **Fix:** none
- **Problem:** The `SKILL_GAPS_HANDLED` instruction exists only in the injected delivery context. A resumed scribe gets no `additionalContext`, so it is never told how to acknowledge. The scribe agent prompt and report default should carry it, but that change was out of scope.
  **Fix:** none
- **Problem:** @scribe couldn't refresh the code graph: `extract` fails because ts-morph is not installed (`code-graph deps install`). maestro-architecture, log-view and plugin-libs-parity are unstamped.
  **Fix:** none
