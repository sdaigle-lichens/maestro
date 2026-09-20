# Hook reference

Registered in `plugins/maestro/hooks/hooks.json` (plugin copy) and in the project's own
`.claude/settings.json` (project copy).

| Event | Matcher | Script | Effect |
| --- | --- | --- | --- |
| `UserPromptExpansion` | `maestro` | `maestro-step0.js` | The orchestrator's Step 0, run by the harness instead of by the model. Fires when the user TYPES `/maestro`, before the expansion reaches the model. `continue` ⇒ no output at all (the case it exists for); `update` ⇒ the instruction on plain stdout, which this event adds to context; `install` ⇒ **exit 2, blocking the expansion**. The forked-agent check rides along and only ever speaks when something diverged. |
| `PreToolUse` | `Skill` | `maestro-step0.js` | The same check for the other entrance — the model invoking the maestro skill through the `Skill` tool, where no expansion happens. Identical answers, except that PreToolUse does **not** add plain stdout to context, so the instruction travels as `hookSpecificOutput.additionalContext`. No-op for every other skill. |
| `UserPromptExpansion` | `to-maestro-tasks` | `maestro-enable-task-routing.js` (`047`) | Fires when the user TYPES `/to-maestro-tasks`. Injects nothing — flips `maestro.json`'s `use_maestro_tasks` to `true` (a no-op if already `true`, or if the config is missing/corrupt). |
| `PreToolUse` | `Skill` | `maestro-enable-task-routing.js` (`047`) | The same check for the model invoking `to-maestro-tasks` through the `Skill` tool — shares this matcher's block with `maestro-step0.js`'s own `PreToolUse` entry, and arbitrates independently via its own `projectOwnsHook(__filename, ...)` call, so the two never interfere. No-op for every other skill, including `maestro` itself. |
| `UserPromptExpansion` | `maestro-post-mortem` | `maestro-post-mortem-context.js` | Fires when the user TYPES `/maestro-post-mortem`. Resolves the session's `active_task` and, if its file carries a `## Post-Mortem` section, prints it on plain stdout; also prints a tail of `.claude/postmortems.log` if present. No output at all when neither exists. |
| `PreToolUse` | `Skill` | `maestro-post-mortem-context.js` | The same check for the other entrance — the model invoking `maestro-post-mortem` through the `Skill` tool — shares this matcher's block with the two rows above, arbitrates independently via its own `projectOwnsHook(__filename, ...)` call, and travels as `hookSpecificOutput.additionalContext` instead of plain stdout. No-op for every other skill. |
| `SubagentStart` | `.*` | `maestro-inject-agent-context.js` | **First run of this `agent_id`**: injects the matched instance's skills, `HANDOFF:` routing lines paired with the channel file to write the payload to, and the report format — all four blocks detailed in `handoff-contract.md`. **Resumed run of the same `agent_id` (`040`)**: skips all four, one reminder line instead — see `agent-resume.md`. **A fourth, independent block (`036`)** delivers whatever is waiting in this agent's lane — see `channels.md`. That block, and the `⚠️` warning for an unresolvable active workflow, fire regardless of first-run/resumed. No-op when the agent maps to no instance, so a broad matcher safely covers custom agents too. |
| `SubagentStart` | `.*` | `maestro-subagent-log.js` | Append a `kind:"dispatch"` entry to the resolving session's `log.jsonl`: the subagent's `agent_type`, `agent_id`, the full spawning message (`input`), and `offered_skills` (`{loaded, referenced}` — the skills `maestro-inject-agent-context.js` surfaces, resolved via the **shared** `resolveSearchList` + `collectAgentSkills` in `lib/maestro-session.cjs` so the logged set can't drift from the injected one). `/session-log` diffs `offered_skills` against the agent's reported `skillsTriage` to flag silently-dropped skills. Runs alongside `maestro-inject-agent-context.js`; order irrelevant. No-op when `maestro.json` is absent. |
| `SubagentStop` | `.*` | `maestro-subagent-log.js` | If the stop carries an `agent_type` (a real workflow agent): append a `kind:"handoff"` entry — parses the subagent's `HANDOFF:` label from `last_assistant_message` → `status` (`"success"` / `"condition"` / `"unknown"`), stores the full final message as `output`, correlated to the dispatch entry by `agent_id`. **Also (`036`)**: mints/reads `run_id` (`ensureSessionRunId`) and calls `writeStamp(cwd, bareAgentName(agentType), runId)` — see `channels.md`. If it has **no** `agent_type` (a subagent stop that isn't a workflow handoff): append a `kind:"transition"` entry instead, so a non-workflow boundary doesn't fall back to a misleading `unknown` handoff. No-op when `maestro.json` is absent. |
| `PreToolUse` | `.*` | `maestro-session-log.js` | Append a tool-call line to the resolving session's `log.jsonl`. No-op when `maestro.json` is absent, and a **silent no-op** (exit 0) when no session id resolves — never a write to a shared path. |
| `PostToolUse` | `TaskCreate` | `maestro-validate-tasks.js` | Validate that the created task matches a step in the active workflow's success path. Tracks created steps across the session in **its own** session's `tasks.json` (`064`), so a concurrent session's coverage is no longer read as this one's; validation is skipped entirely (exit 0) when no session id resolves. Warns via `additionalContext` + `systemMessage` when a task doesn't match any workflow node or when a success-path step was skipped (e.g. `human review`). No-op when `maestro.json` is absent or no active workflow. |
| `SessionEnd` | `` | `maestro-session-cleanup.sh` | Delete **only the ending session's** `.claude/maestro_sessions/<session_id>/` plus the three pre-`064` flat files if an older runtime left them (`removeSessionState`, shared with the `.cjs` twin so the two cannot disagree). A sibling session's directory is never touched; with no session id resolvable, nothing is removed at all. **Also (`036`)**: `sweep()` `.claude/channels/` — see `channels.md`. `maestro.json` and the orchestrator skill are deliberately preserved. No-op when the payload carries no `cwd`. |

There is **no `SessionStart` hook**. It existed only to serve the retired container,
reference-counting live sessions so teardown could wait for the last one; nothing replaced it — the
desktop app is an ordinary application the user opens, so there is nothing to start, refcount, or
tear down. `UserPromptExpansion` is registered again, but for an unrelated job: the container-era
entries launched a web form and blocked the prompt until a result file appeared, whereas
`maestro-step0.js` answers a question about this project and gets out of the way.

## Two copies of every script

**Every one of these scripts exists in two places, and neither copy updates on its own.** The eight
hook scripts above (`maestro-step0.js`, `maestro-enable-task-routing.js` (`047`),
`maestro-post-mortem-context.js`, `maestro-inject-agent-context.js`, `maestro-subagent-log.js`,
`maestro-session-log.js`, `maestro-validate-tasks.js`, `maestro-session-cleanup.sh`) run from
`${CLAUDE_PLUGIN_ROOT}/scripts/` — which resolves into the **version-keyed marketplace cache**, so
an edit reaches a project only after a `plugin.json` version bump and re-pull. The installer also
copies them into `<project>/.claude/scripts/` as `.cjs`, and those copies only refresh on
(re)install or `/maestro-update`. `maestro-set-session-workflow.cjs`,
`maestro-render-orchestrator.cjs`, `maestro-task-status.cjs` and `maestro-step1-gates.cjs` (`032`)
exist **only** as project copies. Both staleness rules: `updating-maestro`.

**Two things can register Maestro's hooks, and the plugin's copy stands down per hook.** A project
installed from the app's `/maestro` route has them in its own `.claude/settings.json`; the `maestro`
plugin registers the same ones globally from `hooks.json`. Both firing used to log every tool call
twice and inject every subagent's context twice; `projectOwnsHook` (`src/core/hook-arbitration.ts`)
now arbitrates it at runtime — the plugin's copy exits 0 for any hook the project registers itself,
and covers the rest. It is keyed on the **registration**, not on the twin file existing, so a
non-purging uninstall hands the hooks back to the plugin rather than turning Maestro off. Full rule:
`installing-maestro`'s hook-arbitration sub-concept. The guard only reaches a machine on a plugin
version bump, so a stale cached plugin still double-fires.

**`maestro-session-cleanup` exists twice, on purpose.** The plugin's `.sh` fires from `hooks.json`;
the `.cjs` is what the installer copies into `<project>/.claude/scripts/` for a project that
registers hooks locally. They do the same thing. The `.cjs` is node because the `.sh` shells out to
`python3` to parse the hook payload, which a project cannot assume is installed. It is also the
**one hook script with no arbitration guard**: since `064` both copies call the **same**
`removeSessionState`/`resolveSessionId` out of `lib/maestro-session.cjs` (the `.sh` shells into
`node -e` to do it), so a double fire is unobservable and a third implementation of the arbitration
in bash would cost more than the no-op.

## Step 0 traps

- **Step 0 is a hook and nothing else, so a project that never gets the hook is never checked —
  silently.** The orchestrator template no longer carries a readiness step at all: `Maestro:STEPS`
  runs straight from "How to orchestrate" into Step 1, and nothing in it mentions
  `maestro-check-runtime.cjs` or `maestro-agent-forks.cjs`. That is the point (the healthy path costs
  zero tokens), but it means the check has exactly two entrances — a **typed** `/maestro`
  (`UserPromptExpansion`) and a `Skill` tool call (`PreToolUse`). A project whose installed runtime
  predates `maestro-step0` and has not run `/maestro-update`, or an invocation arriving by any other
  route, gets **no check and no warning that none happened**. A deliberate, accepted trade: do not
  "fix" it by putting the bash calls back into the template. `maestro-check-runtime.cjs`'s CLI still
  prints the same JSON for a **person** debugging by hand.
- **Step 0 does two checks in one run, and the second must never stop the workflow.**
  `maestro-step0.js` calls `checkRuntime()` for the readiness answer, then `computeAgentSync()`
  (`031`) — **directly**, out of `lib/maestro-agent-sync.cjs`, not by spawning
  `maestro-agent-forks.cjs` — for which agents this project forked from a global template have since
  fallen behind it. The fork half **writes nothing** (a forked agent's `.md` is usually committed,
  and a diff nobody asked for is hard to explain), never blocks, and speaks only when something
  diverged: it injects one line saying so and telling the model to carry on. `/maestro-update` is
  where that review is actually done. Only the readiness half can block, and only on `install`.
  Reaching an existing install needs a plugin re-pull **and** an update — the same version trap the
  arbitration guard shipped through. See `updating-maestro`.
