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
