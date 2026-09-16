# Per-session Maestro session state

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Every piece of Maestro's ephemeral session state is currently **one fixed file per project**, so two
Claude Code sessions running against the same project corrupt each other — silently, in three
different ways:

- `maestro_session.log.jsonl` — both sessions interleave into it, and either one's `SessionEnd`
  deletes it out from under the other. Worse, `resumeTarget()` matches a bare agent TYPE across the
  whole file, so a condition-edge loop-back in session A can resume **session B's `agent_id`** —
  precisely the "a wrong resume is corrupt and silent" failure `agent-runs.ts`'s own header warns
  about.
- `maestro_session.json` — B's `maestro-set-session-workflow.cjs` overwrites A's active workflow, so
  A's next `SubagentStart` injects **B's workflow's skills**. Both sessions also share one `run_id`,
  so channel stamps cross-pollinate.
- `maestro_session_tasks.json` — one session's `TaskCreate` coverage is read as the other's.

Give each session its own directory instead, holding all three files:

```
<project>/.claude/maestro_sessions/
  .gitignore              ← contains "*", written on first create
  <session_id>/
    log.jsonl             ← was maestro_session.log.jsonl
    session.json          ← was maestro_session.json  { workflow, generated_instances, run_id }
    tasks.json            ← was maestro_session_tasks.json
```

A directory per session rather than `<session_id>.jsonl` because all three files move together; the
log alone would leave the other two defects in place.

**Resolving "which session am I" is one concern with two sources, and this is the load-bearing fact
of the whole task** — it was verified empirically, not assumed:

1. `payload.session_id`, when the caller is a hook with a stdin payload. **A subagent's hook payload
   carries the MAIN session's `session_id`**, confirmed by probing `PreToolUse` (main),
   `SubagentStart`, the subagent's own `PreToolUse`, and `SubagentStop` — all four identical. One
   workflow run is therefore one directory, and a subagent's tool calls land in it.
2. The `CLAUDE_CODE_SESSION_ID` environment variable, for the scripts that run with no stdin at all.
   Verified set at every one of those four probe points and **equal to the payload's `session_id`**
   every time, so the fallback is consistent with the authoritative source rather than merely
   available.
3. Neither → `null`, and every caller degrades safely (below).

Do not key anything on `CLAUDE_CODE_CHILD_SESSION`; it is set in the main session too.

That resolution, the id's validation, the directory creation and the path shapes all belong behind
one small module — the writers' call sites should not change at all. In particular
`appendSessionLog(claudeDir, entry, payload?)` keeps its exact three-argument signature: it already
takes the payload for `ctx_pct`, and resolving the session from that same payload means all five
existing writers gain per-session routing without a diff at the call site.

An id is **validated, never sanitised**: accept `^[A-Za-z0-9_-]{1,128}$` and treat anything else as
"no session". Sanitising a bad id into a legal one could collide with a real session's directory,
which is worse than not writing.

**The callers that need changing, and how each degrades when no id resolves:**

| Caller | Change | No id resolves |
| --- | --- | --- |
| `maestro-session-log.js` (PreToolUse) | route via the module | silent no-op, exit 0 |
| `maestro-subagent-log.js` (SubagentStart/Stop) | route via the module; `run_id` now per-session | silent no-op, exit 0 |
| `maestro-inject-agent-context.js` (SubagentStart) | reads its own session's log + session.json | full injection (today's safe direction) |
| `maestro-validate-tasks.js` (PostToolUse) | its own session's tasks.json | skip validation, exit 0 |
| `maestro-set-session-workflow.cjs` | writes its own session's session.json | exit 0, report plainly |
| `maestro-task-status.cjs` | its own session | today's empty answer |
| `maestro-step1-gates.cjs` / `maestro-step4-gate.cjs` | **now DO write their `kind:"phase"` marker**, via the env var | skip the write — the existing accepted limitation, now the fallback rather than the normal path |
| `maestro-resume-target.cjs` | reads **only** its own session's log | print nothing (cold `Task`) — never read another session's log |
| `maestro-post-mortem.js` | defaults to its own session; gains `--session <id>` | list the available sessions and say which to pass |
| `maestro-session-cleanup.sh` / `.cjs` (SessionEnd) | remove **only its own** session directory | remove nothing |

The two gate scripts keep their one-line-stdout / no-stderr / exit-0 contract unmodified — the phase
write stays inside the existing `logPhase()` try/catch, which already cannot touch stdout.
`ctx_pct`/`ctx_model` remain absent on those two entries: that needs `transcript_path`, which the
environment variable does not give.

`SessionEnd` must also delete the three legacy flat files if present, and `uninstall`/`--purge` must
remove the whole `maestro_sessions/` directory as well as the legacy names.

**The `.gitignore` inside `maestro_sessions/` is not belt-and-braces, it is the mechanism.**
`GITIGNORE_ENTRIES` in `install.ts` lists three filenames and is only ever appended at install time,
so every project installed before this ships would leak the new directory into git until someone
re-installs. A `.gitignore` containing `*`, written by the module when it creates the directory,
ignores the directory's contents and itself, needs no re-install, and works everywhere. Add the
manifest entry too, for new installs.

This touches the plugin's hook scripts and the generated plugin-entries bundle they require — keep
the generated `.cjs` bundle in sync via `build:plugin-libs` and read its diff, keep the plugin's
marketplace copy and the project-local script copies consistent, and bump the plugin's version
(**patch** — nothing about the published surface grows).

**Out of scope, deliberately, with the failure each one leaves standing:**

- **Channel lane collisions.** `laneFor()` is `.claude/channels/<receiver>/<sender>.1.md` with no
  session dimension, and the `.1` is literal in the `SEED_HANDOFFS` bodies agents are told to write
  to. Two concurrent sessions running the same sender→receiver route overwrite each other's payload;
  the per-session `run_id` this task introduces then makes the survivor look like a foreign run, so
  it is *mentioned* rather than inlined. Net effect: one payload lost, one not delivered. Fixing it
  means changing the agent-facing write path and `PRIOR_SEEDS`, which is its own task.
- `ctx_pct` on the two gate scripts' phase entries (see above).
- Garbage collection of a session directory left behind by a crash with no `SessionEnd`.

## Acceptance criteria

- [ ] Two Maestro-orchestrated terminal sessions running concurrently against the same project keep
      wholly independent state: neither one's log, active workflow, `run_id`, or task coverage is
      visible to or overwritten by the other, and neither one's `SessionEnd` deletes or truncates
      any part of the other's.
- [ ] A condition-edge loop-back resolves a resume target from its own session's log only — given a
      log directory containing another session's completed run of the same agent type, that other
      session's `agent_id` is never returned.
- [ ] Session-id resolution prefers the payload's `session_id`, falls back to the
      `CLAUDE_CODE_SESSION_ID` environment variable, and yields `null` when neither is present; each
      caller degrades exactly as tabulated above, always exiting 0.
- [ ] An id outside `^[A-Za-z0-9_-]{1,128}$` — including `..`, a path separator, an absolute path,
      and the empty string — is rejected rather than sanitised, and nothing is created on disk.
- [ ] The two Step 1/Step 4 gate scripts still print exactly one line on stdout, write nothing to
      stderr and exit 0 unconditionally, and now write their `kind:"phase"` marker to the resolving
      session's log — skipping it only when no id resolves.
- [ ] `maestro-post-mortem.js` digests the invoking session by default and honours `--session <id>`;
      with no id resolvable it lists the available sessions instead of digesting an arbitrary one.
- [ ] `SessionEnd` removes only the ending session's directory plus any legacy flat files;
      `/maestro-uninstall` and `--purge` remove `maestro_sessions/` entirely.
- [ ] `maestro_sessions/` is git-ignored in a project that was installed **before** this change and
      has not been re-installed since.
- [ ] Plugin-entries changes are rebuilt into the generated bundle with the diff read, the plugin
      marketplace copy and the project-local installed copy stay consistent, and `plugin.json`'s
      version is bumped by a patch.
- [ ] Test coverage includes: payload id wins over environment id; environment id used when there is
      no payload; neither present produces no write and no throw; the rejection cases above; two ids
      writing two independent directories; `SessionEnd` for one id leaving a sibling untouched; and
      `resumeTarget` never crossing sessions.

## Blocked by

None — can start immediately
