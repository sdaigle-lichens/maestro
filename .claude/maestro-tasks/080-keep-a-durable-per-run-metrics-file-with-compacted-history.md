# Keep a durable per-run metrics file with compacted history

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Maestro's per-session logs are deleted when a session ends, so nothing outlives a session except postmortems.log and the written Post-Mortem sections in task files. Add a per-project metrics file that outlives sessions. It is git-ignored and recorded automatically by the runtime when a workflow run finishes.

Each run record holds:
- the workflow;
- the related maestro-task filename, if any;
- the agents and skill steps that ran;
- the HANDOFF outcomes;
- loop-backs (which condition edge, how many times);
- human-review stops and their outcome;
- duration;
- context use as recorded today;
- whether the run was a team meeting.

Retention: the most recent N runs (default 10, configurable) stay as full records. When a run falls out of that window, fold it into running totals keyed by workflow and by agent: run count, success/failure counts, loop-back and human-review rates, average duration and context use, and first-seen/last-seen dates. Because the totals have one entry per workflow and per agent, the file's size stays bounded without a byte limit. Folding is lossy by design: a folded run loses its task link.

Post-Mortem prose stays in the task files. A full record only references its task file, so readers can follow it to that task's Post-Mortem section.

The maestro-team-meeting evidence digest reads the metrics file: the full recent runs as detail, the totals as trends. Proposals can then cite numbers across sessions instead of only the current session's log.

## Acceptance criteria

- [ ] A finished workflow run appends a full record to a per-project metrics file that outlives the session and is git-ignored.
- [ ] Only the most recent N runs (default 10, configurable) are kept in full. Older runs are folded into totals per workflow and per agent, so the file stays bounded.
- [ ] Folding is correct and idempotent: totals equal the sum of the folded runs, and re-running compaction changes nothing.
- [ ] Two sessions recording runs at the same time can't lose or corrupt records (atomic write or lock).
- [ ] Post-Mortem text is not copied into the metrics file. Full records reference their task filename.
- [ ] The team-meeting evidence digest includes the recent runs and the totals.
- [ ] Tests drive the real hooks against temp projects: recording, folding past N, the concurrent-write safety, and the digest picking the data up.
- [ ] The plugin version is bumped, and the developer concept skills document the metrics file and its retention.

## Blocked by

None — can start immediately

## Post-Mortem

- **Problem:** The backend step rebuilt the plugin libs but left the repo's tracked mirrors under `.claude/scripts` stale, so the parity test failed until the test step found it and backend was resumed to refresh them.
  **Fix:** none
- **Problem:** `TaskCreate`/`TaskUpdate` were unavailable, so the task graph and mark-task-done node were never created and steps were routed by hand.
  **Fix:** none
