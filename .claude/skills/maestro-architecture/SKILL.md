---
name: maestro-architecture
description: "Explains the Maestro runtime end-to-end: how a project goes from maestro.json to a live orchestrator, how the UserPromptExpansion/SubagentStart/PreToolUse/SessionEnd hooks behave at runtime — including the Step 0 readiness check, which is a hook rather than a step the orchestrator executes, and which copy of a hook fires when the plugin and a project-local install both register it, how skills + condition-edge handoffs are injected, the HANDOFF routing contract and the three-tier resolution (project file, global sqlite store, bundled seed) behind each route's handoff_details protocol, how a route's payload travels on an agent channel (`.claude/channels/<scope>/<receiver>/<sender>.1.md`, scoped per task or session since `144`) rather than through the orchestrator's own context, the run_id stamp that guards a delivery's freshness, the orchestrator skill's managed regions and its optional config-driven Step 1 gates and Step 4 task-routing nudge (`046` — both injected dynamic context, the same third delivery channel beside hooks and template prose), the dual-registered hook that auto-enables that nudge on a session's first `/to-maestro-tasks` invocation (`047`), the separate always-on Step 4 prompt asking once about `/maestro-post-mortem` after a rough session (`049` — static template prose, not script-injected, not config-gated), and the config + session state on disk: maestro.json, plus the PER-SESSION directory <project>/.claude/maestro_sessions/<session_id>/{log.jsonl,session.json,tasks.json} (`064`) that replaced the three flat per-project files, and how a caller resolves which session it is (payload session_id -> CLAUDE_CODE_SESSION_ID -> null). Use when the user is working inside apps/maestro or plugins/maestro and asks how Maestro works at runtime, what the orchestrator does, why a subagent did/didn't get its skills, how handoffs route, where a route's handoff_details payload shape comes from and how to add or change one, why a channel payload wasn't delivered or was delivered late, why /maestro ran (or skipped) the confidence and design gates, why a condition-edge loop-back resumed an agent instead of spawning a fresh Task, why a resumed subagent's injected context is five blocks shorter than a first run's (`040`), why a hand-edited config's duplicate agent type is reported as a banner, a `/maestro-update` warning and an install-report line rather than repaired (`041`), why two concurrent Claude Code sessions in the same project no longer overwrite each other's log, active workflow, run_id or task coverage (`064`), how team-meeting mode changes what the hooks do for a participant (the session.json `meeting` flag, meeting_leftovers and the stamp skip), or which maestro file is authoritative. For what the install writes and what a purge deletes, see the installing-maestro skill."
metadata:
  type: concept-skill
  version: "1.34"
  last-update: c43ef107257513a8488d02d6fd93e454cddded0b
---

# Maestro Runtime Architecture

Maestro turns a project into a multi-agent workflow: the user manually invokes the **`/maestro`** skill, which classifies each request, runs whichever Step 1 gates the project has turned on (by default, none), picks a configured workflow, and dispatches subagents whose skills + handoff rules are injected at runtime from `.claude/maestro.json`.

This doc covers the **runtime** half — the part that only exists inside a Claude session. The **authoring** half is the Maestro desktop app (`apps/maestro`), documented in the `workflow-view` and `rule-view` skills. The two meet at `.claude/maestro.json` and nowhere else.

```
authoring (apps/maestro, no session)     runtime (this doc, session only)
  /workflows + /rules canvas      ──▶    .claude/maestro.json   ──▶   orchestrator + hooks
        saveConfig() writes it              (source of truth)          read it every session
```

That split is the whole point of the architecture. Everything on the left is deterministic node
code — reading files, writing JSON, rendering a table, moving rule files — and needs no model.
Everything on the right needs a live session because it fires _on session events_. There is no
longer any transport between the two: no container, no port, no `/tmp` channel file, no hook that
blocks waiting for a UI. A save is an IPC call in the desktop app; a hook is a script the session
runs.

## How the runtime gets there

Two paths write the same files and end at a rendered orchestrator over a seeded `maestro.json`: the
desktop app's `/maestro` route (`installRuntime()` in `src/core`, no session involved, and the path
to prefer) and `/maestro-install` for a machine without the app. Both copy the runtime scripts into
`<project>/.claude/scripts/`, register the hooks in the project's own `.claude/settings.json`,
ignore the session files from the repo-root `.gitignore`, and seed `maestro.json` **only when
absent**. Rendering is always a separate step afterwards, because the renderer consumes
`maestro.json` and writes into `maestro/SKILL.md`, so both must already exist — which is all
`/maestro-update` is.

`/maestro-uninstall` reverses the hook registration and clears the session files; `--purge` also
removes the orchestrator skill, the copied scripts and `maestro.json`.

**The full pipeline — the asset and hook manifest, the two implementations that must agree, how
staleness is decided, and what a purge deletes — is the `installing-maestro` skill.** What follows
here is what those files then *do* inside a session.

**What an install cannot do:** author a graph. It seeds one. Adding a workflow, moving a node,
promoting a skill from referenced to loaded, or assigning rules is the app's canvas or a hand-edit —
and the `rules` slice starts empty either way, since placing rule files is `maestro-apply-rules.js`'s
job.

## Runtime lifecycle (one session)

```
User invokes /maestro in a session
        │
        ▼
UserPromptExpansion hook (matcher "maestro") → maestro-step0.js
  • Step 0, before the expanded prompt reaches the model: readiness (maestro-check-runtime) + forked
    agents (computeAgentSync). Healthy ⇒ silent. Behind ⇒ one instruction as context. Not installed
    ⇒ exit 2, and the invocation never happens. Versions compare semantically (`087`,
    `runtime-version.ts`): a project NEWER than the plugin is not behind — `pluginBehind` + one
    notice ("update the plugin, never /maestro-update"), and the session continues.
        │
        ▼
Orchestrator (.claude/skills/maestro/SKILL.md):
  (no Step 0 — it is not a step any more; the hook above is the whole of it)
  Step 1  custom checks (OPTIONAL gates). The template holds three lines amounting to "do what
          the injected line says"; the injected `maestro-step1-gates.cjs` line supplies the
          step itself. A freshly seeded project: "no gates enabled, continue to Step 2".
  Step 2  classify request → node .claude/scripts/maestro-set-session-workflow.cjs "<workflow>"
                              └─ writes { workflow, generated_instances } → THIS session's
                                 maestro_sessions/<session_id>/session.json, and ends any
                                 team meeting in it (closeMeeting)
  Step 3  execute the workflow: the success path from the Maestro:HANDOFFS table,
          TaskCreate per step, Task() each agent step. No TaskCreate (`083`): the path is
          recorded with `maestro-task-status.cjs plan` / `plan-step` in session.json, and Step 4's
          `done` refuses while a planned step (manager and human review included) is unfinished. In a worktree
          run Step 4 offers a user-approved commit before ever mentioning merge, and every command
          handed to the user carries absolute paths (the session's cwd IS the worktree). Step 3
          (`104`): a denied agent channel write is not retried by resuming — the orchestrator writes
          the file from the agent's returned payload (see `sub-concepts/channels.md`).
  Step 4  mark the task done (the mark-task-done node; it no longer commits), then the OPTIONAL
          task-routing nudge (`046`)
  Step 5  post mortem: notes in the task file, and the always-on /maestro-post-mortem question (`049`)
  Step 6  report to the epic (only when `done` printed an epic report command, `084`)
  Step 7  end skills (injected `maestro-end-skills.cjs` line, `089`); Step 8 (worktree only) merge
        │
        ▼ (each Task → subagent)
SubagentStart hook  (matcher ".*")  → maestro-inject-agent-context.js
  • reads active workflow from this session's session.json + the instance from maestro.json
  • FIRST run of this agent_id: injects skills + condition-edge routing + per-route payload
    protocol + report format;  RESUMED run: one reminder line instead
  • REQUIRED-payload block on EVERY pass (`087`, `payloadRequirement`): names the channel file per
    payload route — with shapes on a first/cold run, file names only on a resume
  • if the active workflow can't be resolved → prepends a ⚠️ warning (skills may be unioned/wrong)
  • cold run: restores a pre-restart delivery after a resumable end first (`159`, see channels.md),
    then inlines + retires this run's lane files. RESUME (`088`): Claude Code DROPS the whole
    additionalContext, so nothing above reaches it — its lane files go by path in the orchestrator's
    SendMessage (resume-target's `deliver:` lines) and are retired at its own SubagentStop
  • lanes are read only in this session's own scope (`144`, .claude/channels/<scope>/)
  • scribe lane (`112`): a skill-gap report is inlined to every same-scope scribe, any run, kept until
    the scribe's SKILL_GAPS_HANDLED: line (its SubagentStop) or the 14-day sweep retires it
        │
        ▼
Subagent runs, writes its payload, ends with a HANDOFF: line (in its final text, or inside a
SubagentHandback/SendMessage tool call — the SubagentStop hook recovers it from the transcript)
        │   SubagentStop judges it: a stop with no hand-back call yet is an INTERIM stop (`160`), held
        │   in session.json pending_interim and judged by `handoff-issues`, not by the stop itself
        ▼
Orchestrator reads HANDOFF:  → `success` continues the success path; a matching label routes back
                               to that node (resuming that agent when it already ran this session)
                               `handoff-issues` lists any judged problem (missing label, unknown route, missing payload)
        │
   (every tool call, all agents)
        ▼
PreToolUse hook (matcher ".*") → maestro-session-log.js → appends one line to this session's log.jsonl
        │
        ▼
SessionEnd hook → maestro-session-cleanup.sh (plugin) / .cjs (project copy)
                  → on a FINAL end deletes ONLY THE ENDING SESSION'S directory; a resumable
                    `reason` keeps it and appends one `session_end` line to its log (`077`, `159`)
                  → sweeps .claude/channels/: a final end retires the own scope's .consumed/
                    outright, a resumable one only ages it out (`159`); everything else only
                    past 14 days (`144`). Keeps maestro.json and the orchestrator skill.
```

**Review gate (`130`, `132`).** A second `PreToolUse` hook, matcher `AskUserQuestion|SendMessage` (`maestro-human-review-gate.js` in the plugin, `.cjs` project copy), gates both review stops. The current step is the first unfinished step of `plan` in `session.json`. The review file is `.claude/maestro-tasks/<task>.review.md` for round 1 and `<task>.review-N.md` after that. Round = 1 + `plan.loopbacks` + review stops (human or manager) already done (`currentReviewStop`); `plan-step <label> pending` increments the optional numeric `plan.loopbacks` (any loop-back, not only one at a review).

| Stop | Denied until the round's review file exists | File sections |
| --- | --- | --- |
| `human review` | `AskUserQuestion` | `## Changed`, `## Did`, `## Deviations from the ticket`, on a re-review `## Corrections since the last round` |
| `manager review` | `AskUserQuestion` (escalation, fallback) and a `SendMessage` whose `to` (minus a trailing `[ref]`) is the active task's epic manager | the direction brief (below) |

To learn the manager's name the hook lazily `require`s `./lib/maestro-epic.cjs` (`epicOfTask`, `readEpicState`); a missing bundle (older install), no epic or no recorded manager leaves `SendMessage` ungated. The hook fails open: it allows the call when there is no plan, no `active_task`, or an unreadable state, so a session that never records a `plan` is not gated. Logic is in `src/core/human-review-gate.ts`, exported through the `maestro-session` bundle. Orchestrator template Step 3 always records the plan and writes the review file before asking or requesting. An install moves a gate registered under the old `AskUserQuestion` matcher to the new one (`updateHookMatchers`, both installers), since `addMissingHooks` keys on event + script and would keep it.

**Manager review (`132`).** A `manager review` step is no longer run as a human review, except on escalation or fallback. The worker (orchestrator template Step 3):

1. **Fallback check.** No `active_task`, `maestro-epic.cjs of` prints nothing, or the named manager is not live in `ListAgents` → run the stop as a `human review`, the brief as its review file. `review-request` also prints this fallback for a task in no epic or an epic with no manager recorded, and so does a failed send.
2. **Brief.** The round's review file as a short direction brief: `## Goal`, `## Deviations`, `## Decisions`, `## Touches` (by name, never a diff), `## Sibling impact`, `## Questions`. No commit or suite result (`150`): the test and reviewer steps own that. On the fallback and escalation paths the stop is a human review, so the worker also adds `## Verified` to the brief. A re-request after a redirect opens with `Round <N>` and quotes the redirect note, each point with how it was addressed; that round checks only that the redirect was addressed.
3. **Request.** `maestro-epic.cjs review-request --task <t> --file <f>` refuses a file that does not exist or is not that task's review file, logs a `review` inbox entry `mNNN` with its `round` (the ticket's request count + 1), and prints the ONE `SendMessage` line for the manager. The same file again while it waits is a re-send, not a new round. `show`/`reports` list it until a verdict exists or a newer request for the ticket supersedes it; `ack` refuses an `mNNN`.
4. **Verdict.** `maestro-epic.cjs review-verdict --task <t> <on-track|redirect|escalate>`, run by the manager when it decides and by the worker on the reply; the second caller gets the recorded verdict back. It logs a `verdict` entry with `verdict` and `effective`.

| Effective verdict | Worker does |
| --- | --- |
| `on-track` | `plan-step "manager review" done`, continues the success path |
| `redirect` | follows `manager requested direction change` to the producing agent with the note (which repeats the direction the manager added to the task file); the redirect leaves the stop unfinished, so it re-runs as the next round. No such edge → `escalate` |
| `escalate` | a `human review` inline at this stop, the manager's note added to the summary |

**The 1-redirect cap counts per ticket, not `plan.loopbacks`** (which counts every loop-back, a test one too). `MANAGER_REDIRECT_CAP = 1` in `epics.ts` (`150`, was 2); `reviewHistory` counts the ticket's `verdict` entries whose `effective` is `redirect`. With 1 recorded, the next redirect is logged `effective: "escalate"`, `capped: true`. The manager manages (`150`): it never reads the diff or code and never picks an implementation, redirects only for work contradicting the ticket, an epic decision or a sibling ticket (never style, tests, lint, commits or correctness), and records any direction in the task file. There is no `for @reviewer:` note. **A loop-back from a test or reviewer step does not reopen the check:** `plan-step <label> pending` (`planStepCommand` in `maestro-task-status.cjs`) resets every later step except a `manager review` already done and after the target; a stop named as the target still resets, and a redirect leaves the stop unfinished so it re-runs by itself. `plan.loopbacks` still increments, so review files keep distinct rounds. Code: `writeReviewRequest`, `recordReviewVerdict`, `reviewHistory` in `src/core/epics.ts`, exported through the `maestro-epic` bundle.

**Parallel tasks and the red-suite rule (`145`).** A task file may carry a `## Touched surfaces` section, written by `maestro-write-tasks.cjs` from the optional `touchedSurfaces` slice and placed before `## Blocked by`. An epic's `EPIC.md` holds a merge-plan table that `maestro-manager` records before it spawns workers. Neither is read by a hook. **No human review or reviewer round approves work while the full suite is red** (the manager review is exempt since `150`: it checks direction only): the human review file's `## Verified` (also added to a manager brief on the fallback and escalation paths) and the epic report from Step 6 each name the commit verified and the green suite on it.

## Where the detail lives

| Sub-concept | Covers |
| --- | --- |
| `sub-concepts/hooks.md` | Every hook: event, matcher, script, exact effect. Why the container-era `SessionStart` is gone and what the two current ones (`113` name, `141` heartbeat) do. The two copies of every script and which one wins. The Step 0 traps. |
| `sub-concepts/session-state.md` | `maestro.json` and the per-session directory (`064`): the file table, `log.jsonl`'s entry kinds, and how a caller resolves which session it is. |
| `sub-concepts/session-end-reasons.md` | Which SessionEnd `reason` values keep the session directory (resumable) and which remove it, how they were observed, the one rule both cleanup twins share (`077`), and the `session_end` log line a resumable end writes (`159`). |
| `sub-concepts/handoff-contract.md` | The four blocks `SubagentStart` injects, the three-tier `handoff_details` resolution, and what the orchestrator does with a `HANDOFF:` line. |
| `sub-concepts/channels.md` | `.claude/channels/` (`036`): how a route's payload travels, the per-task/session scope (`144`), the `run_id` stamp, retirement, the scribe lane's kept gap reports (`112`), the 14-day sweep, the restore of a delivery a restart cut off (`159`), and the absolute main-checkout paths a worktree session is shown plus the write guard's second base (`163`). |
| `sub-concepts/step-gates.md` | Injected context as a third delivery channel: the Step 1 gates (`032`), the Step 4 task-routing nudge (`046`/`047`), and the post-mortem prompt that is NOT part of it (`049`). |
| `sub-concepts/agent-resume.md` | Why a condition-edge loop-back resumes an agent instead of spawning one (`039`), why a resumed run's injection is five blocks shorter (`040`), and why a resume gets its payload by path because Claude Code drops its `additionalContext` (`088`). |
| `sub-concepts/team-meeting.md` | Team-meeting mode: the `session.json` `meeting` flag, what participants get and what's withheld, `meeting: true` log entries, the write guard's meeting dir, and how a meeting ends (`closeMeeting`, `meeting_leftovers`). |

## Common questions — where to look

| Question | Look at |
| --- | --- |
| Why didn't a subagent get its skills? | active workflow in this session's `maestro_sessions/<id>/session.json` (was `maestro-set-session-workflow.cjs` run?); the instance's `agent` must equal the subagent's `name`; the skill must be a real project skill |
| Why are the wrong skills injected? | likely no/mismatched active workflow → union across workflows (the injected `⚠️ warning` says so) |
| How do I change the orchestrator's behavior? | edit `.claude/skills/maestro/SKILL.md` **outside** the `Maestro:*` markers — the `STEPS`/`PRINCIPLES` regions are re-synced from the plugin template on every install/update; to change those for good, edit `templates/maestro/SKILL.md` in the plugin |
| My edit to the orchestrator's steps disappeared | it was inside a managed region and got re-synced. Move it outside the markers, or change the template |
| The handoff table is stale | run `/maestro-update` (re-renders from `maestro.json`) |
| A `loaded_skills` / node / start-skill entry names a skill that no longer exists | `/maestro-update` step 4 runs `maestro-stale-refs.cjs` (backed by `lib/maestro-skill-availability.cjs`) and reports dangling ids (including `skill-disabled` / `bundled-skills-disabled`, `142`: a skill the project switched off via `skillOverrides` "off", `enabledPlugins` false or `disableBundledSkills`, merged user < project `settings.json` < `settings.local.json`; one shared decision `skillDisabledReason` in `skill-availability.ts`, which the app's skill lists also use via `isSkillListed`/`readDisableRules`; unreadable settings fall back to "listed"); the same pass suggests plugins: a root `scribe.config.json` without `code-graph` enabled gets an enable hint, and a legacy `.claude/concept-skills.json` without `code-graph` enabled gets "install code-graph from its own marketplace, migrate via `/code-graph-install`". The design check a fresh seed names (the Step 1 design check: the Refactor workflow's lead and `/to-maestro-tasks`' start skill) is chosen by `seedSkillsFor` (`core/skill-availability.ts`) from `DESIGN_CHECK_CANDIDATES` (first available wins; today only `code-graph:use-code-architecture-design-check`), so a project without the plugin seeds no design check. Maestro itself hard-codes nothing else. |
| How do I turn Maestro off? | `/maestro-uninstall` (removes the Maestro hooks + session files); `--purge` to also remove the orchestrator skill + scripts |
| How did this session go / what could have gone better? | `/maestro-post-mortem` — `maestro-post-mortem.js` digests the invoking session's `log.jsonl` (read-only; `--session <id>` picks another, and with no id resolvable it lists the available sessions instead of digesting an arbitrary one) and the skill couples it with the main session's context to flag avoidable work, false checks, bad assumptions, and handoff issues, then proposes fixes. The digest has one row per `agent_id` (a resume's second dispatch entry is folded in; the last handoff wins), lists every non-success outcome under Problems, and infers an interim stop that was never finished as a missing HANDOFF from the log alone (`160`). Run mid-session (the log is wiped at `SessionEnd`). |
| Where's the install logic? | the `installing-maestro` skill — `installRuntime()`/`uninstallRuntime()` in `src/core` for the app, `plugins/maestro/scripts/maestro-{install,uninstall}.js` for the terminal path |
| How do I edit the graph without a session? | Open the project in the Maestro desktop app (`apps/maestro`) → `/workflows` for the canvas, `/rules` for rule placement. A save renders the orchestrator and applies rules in the same call. |
| A handoff payload wasn't delivered, or looks stale | check `.claude/channels/<scope>/<receiver>/<sender>.1.md` — undelivered if still there, retired to `.claude/channels/<scope>/.consumed/<receiver>/` if already read. Scope (`144`) is `task-<NNN>` from `session.json` `active_task`, else `session-<id8>`: a file in another scope, or in the legacy unscoped root, is never delivered to this session. Compare its stamped `run_id` (first line) against this session's own `session.json`; a mismatch means it will be *mentioned*, not inlined, until a matching run consumes it. A scribe gap report (`scribe/<sender>.<n>.md`, `112`) is the exception: delivered to every scribe until acknowledged. Full mechanism: `sub-concepts/channels.md`. |
| Why did a condition edge resume an agent instead of spawning a fresh one? (`039`) | `maestro-resume-target.cjs` found a `kind:"handoff"` log entry for that bare agent type this session and printed its `agent_id`. It prints nothing (cold `Task`) when there is no completed run yet, or when the active workflow maps that agent type to more than one distinct instance. |
| Why did a resumed subagent get so much less injected context than a first run? (`040`) | Working as designed — `hasCompletedRun()` found a `kind:"handoff"` entry for that `agent_id` already, so the skills/routing/protocols/report were skipped for a one-line reminder. And since Claude Code drops a resume's `additionalContext` entirely, the agent sees none of it — channel payloads reach a resume by path in the orchestrator's `SendMessage` (`088`). See `sub-concepts/agent-resume.md`. |
| A resumed agent says its channel file doesn't exist (`088`) | The orchestrator must name every `deliver: <file>` line from `maestro-resume-target.cjs` in its `SendMessage`; the file stays in the lane until that run's `SubagentStop` retires it (`session.json` `resume_deliveries`). A `missing:` line means the sender never wrote it — also queued as a `missing_payload` issue for `handoff-issues`. See `sub-concepts/agent-resume.md`. |
| A subagent got a "team meeting in progress" notice instead of its routing, or a write was blocked outside `meeting/` | this session's `session.json` has a `meeting` listing that agent type. Starting a workflow (`maestro-set-session-workflow.cjs`) or `maestro-team-meeting.cjs end` removes it. See `sub-concepts/team-meeting.md`. |
| Why does a hand-edited config's duplicate agent type show up as a banner / stderr warning / install report line? (`041`) | `apps/maestro/src/core/config-validate.ts`'s `duplicateAgentTypes(cfg)` — a pure validator reporting two **placed** instances in one workflow sharing a bare agent, run from three call sites (the app's config load, `/maestro-update`, and `install.ts`) and never auto-repairing. See `maestro-config-model` (apps/maestro's `.claude/skills`) for where each call site computes it. |

## Epics and the manager (`084`)

A task can belong to an **epic**: related tasks that several `/maestro` sessions run at once, coordinated
by a resumable `maestro-manager` session (a published skill, not a hook or an agent). What changes
inside a worker session, and only for a task that has an epic:

- **Claim records the session name, and the CLI fills it in (`113`).** The `maestro-session-name`
  hook names every Maestro session from its id (`maestro-<id8>` on the first `/maestro`,
  `maestro-mgr-<id8>` on the first `/maestro-manager`, or keeps a user-set custom title), stores it
  in `session.json` and applies it as `sessionTitle`, so it survives `claude --resume` (a fork gets a
  new id, hence a new name). `claim` and the epic CLI record that stored name in preference to a
  passed `--name`/`--from`/`--by`; the orchestrator never reads it from `ListAgents`. A nameless
  claim still works. The manager finds workers by name, never by address. Mechanism:
  `sub-concepts/session-state.md`.
- **Step 4's report.** Before the task is marked done, the orchestrator runs
  `maestro-epic.cjs report --task <active_task> --from <name> --file -` with the report on stdin. It
  writes `.claude/epics/<slug>/inbox/rNNN-<task>.md`, prints the manager's name, and the orchestrator
  sends ONE short SendMessage line. A task in no epic prints "belongs to no epic" and nothing else
  happens. A report written while no manager runs survives and is listed unacknowledged when a
  manager resumes; the manager's `ack` is the only delivery proof. If that SendMessage fails, the
  printed hint says to run ListAgents and ask the user before messaging a plausible match, never to
  treat one failed send as the manager gone (`102`). Since `113` a restarted manager keeps its name,
  so it runs `set-manager <slug>` (name optional; the CLI fills it in) only on opening or resuming an
  epic that may record an older name.
- **A manager's message is never the user's approval.** The orchestrator template's PRINCIPLES and
  the `maestro-manager` skill both say so: human review, commits, merges and pushes still prompt the
  user in the worker's own session. **Approval scope (`132`):** both also say a manager's on-track
  verdict continues the success path only; it is never the user's approval for commit, merge, push,
  or agent/skill/workflow changes.
- **Managers notify each other through notes (`085`).** A manager writes `maestro-epic.cjs note`
  into another epic's inbox first, then sends one SendMessage line; the receiver acks it like a
  report. Another manager's note is never the user's approval either.

Everything else (the tracker's `epic` field, the inbox, the write discipline, why session names,
what counts as affecting another epic) is in `task-queue`'s `sub-concepts/epics.md`.

## Live check

Whether Claude Code honours the review gate's PreToolUse deny on `SendMessage` and `AskUserQuestion`
was covered only by unit tests until the manager review step was run once for real in an epic worker
session (task `137`). Observations, filled in after that run:

- **Gate deny:** observed. The gate denied a `SendMessage` to the manager (`maestro-mgr-3a4fd839`)
  sent before the round's review file existed. The denial named the missing review file path and the
  exact `review-request` command to run next.
- **Review-request line:** observed. The line, recorded with `maestro-epic.cjs review-request`
  (`m001`, round 1), reached the manager's inbox; the send succeeded.
- **Verdict:** observed. `redirect` (the manager chose it deliberately to exercise round 2). The
  orchestrator followed the `manager requested direction change` edge back to @backend (resumed by
  `agent_id`), reset @backend and the manager review stop to pending, and passed the manager's note
  to @backend.
- **Redirect loop:** confirmed. The round-2 request said "Round 2", quoted the manager's note and
  used `.review-2.md` as its review file; `m002` got verdict `on-track`.
- **Surprises:** @backend could not write its channel file from the worktree (permission
  classifier), so the orchestrator wrote it as the worktree procedure describes (reported as an epic
  finding). Expected, by design: the manager recorded the verdict itself, and whoever runs
  `review-verdict` second gets the recorded verdict back ("already recorded").

### Task 154 run (four open checks)

- **AskUserQuestion at a human review (before the review file exists):** observed. At a human
  review stop with no review file, the orchestrator called `AskUserQuestion`. Claude Code honoured
  the PreToolUse deny and the question was not shown. The denial said: "Human review round 1: the
  review file is missing. Write `.claude/maestro-tasks/154-….review.md` first, with the sections
  `## Changed`, `## Did`, `## Deviations from the ticket` and, on a re-review, `## Corrections since
  the last round`. Then print the full summary as text above the question … and ask with
  AskUserQuestion …" (tail abbreviated).
- **Worktree channel write:** observed, write succeeded. Allow rule in effect: project
  `.claude/settings.json` `permissions.allow` `Write(/.claude/channels/**)` (no rule was removed; a
  settings change would be needed to isolate it, and none was made). A worktree agent wrote
  `.claude/channels/task-154/probe/worktree-probe.1.md`. One clean write is evidence, not proof:
  the denial is intermittent, so a single success does not show it is gone.
- **Add-step modal and workflow canvas:** OBSERVED BY THE USER, not the session. The user looked at
  the real desktop app window and reported yes to each of: the Agent, Skill and Review kinds; Human
  as the default review with Manager as the alternative; the wider modal; the modal resetting on
  open; the node actually being added (the user then undid it); and a `manager_review` node on the
  canvas. The session did not look at the window; it read the code only to know what to expect.
- **Resume a finished agent (tasks 151 and 153):** partly observed. The orchestrator resumed this
  finished agent by `agent_id` via `SendMessage` for a read-only re-verify run. (a) The
  `log.jsonl` handoff entry for the resumed run holds that run's own result (the re-verify text),
  not the first run's report: handoff record OK (task 153). (c) A re-verify-only run raised no
  warning: `handoff-issues` printed "no problems recorded". Finding, not fixed: this agent then
  re-sent its earlier full report as a second handoff entry. The agent did this, not a hook defect,
  but the latest record for the agent now holds the re-sent old report plus the re-verify note.
  (b) and (d) were not run here: the Documentation workflow's scribe has no HANDOFF route that
  expects a channel payload, so neither warning can fire. Both were run under
  `### Task 155 run (the two resumed-run payload warnings)` below.

### Task 155 run (the two resumed-run payload warnings)

Tests workflow: `@test` to `@reviewer`, payload `.claude/channels/task-155/reviewer/test.N.md`. One
`@test` agent, dispatched once and resumed twice by `agent_id` via `SendMessage`, with a throwaway
`probe-155.txt` (deleted, never committed). `handoff-issues` ran after each run. Session log:
`.claude/maestro_sessions/<session>/log.jsonl`.

- **Case 1, resumed agent writes its next-numbered payload (`test.2.md`):** observed, no warning.
  Dispatch `16:50:17.978Z kind:dispatch agent:maestro:test`; `Edit(.../probe-155.txt)` 16:50:21;
  `Write(.../.claude/channels/task-155/reviewer/test.2.md)` 16:50:23; handoff `status:success
  label:success` 16:50:26. `handoff-issues`: "no problems recorded". Run 1 (`test.1.md`, 16:49:49)
  was also clean.
- **Case 2, resumed agent edits a file and skips its payload: NOT warned at the time. Superseded by
  `### Task 156 run` below: the warning was raised and then dropped, and is fixed (0.13.23).** Dispatch `16:51:07.632Z`; `Edit(.../probe-155.txt)` 16:51:09; `SubagentHandback`
  16:51:10; handoff `status:success label:success` 16:51:11, output "Deliberately wrote no channel
  payload." No `Write` to `.claude/channels/`. `handoff-issues` at 16:51:35, and again after the
  reviewer step, printed "no problems recorded". Expected: a `missing_payload` warning for
  `.claude/channels/task-155/reviewer/test.N.md`. The unit tests for this check pass; the live run
  did not.
- **Cause (hypothesis at the time; resolved by `### Task 156 run`, where cause 1 was confirmed and 2 ruled out):**
  1. Most plausible: `dropResolvedMissingPayloads` (`resume-delivery.ts`, reached from
     `handoffIssuesCommand` in `maestro-task-status.cjs`) drops a recorded `missing_payload` when
     its file is found through `pendingResumeDeliveries`, keyed on the session `run_id` rather than
     the agent run. Run 1's `test.1.md` carries that run_id, so the missing file looks present.
     Dropping also deletes `handoff_issues`, which erases the trace.
  2. `scanRun`/`startsRun` (`handoff-label.ts`) reset `wroteFiles` on a run-boundary misdetection,
     so the stop hook (`maestro-subagent-log.js`, ~l.272-281) treats the run as re-verify only and
     skips the check.
  3. Unlikely: `payloadWrittenSince` counted an earlier file (`test.2.md`, mtime ~16:50:26).
  The log does not separate these. Decisive probe: rerun case 2 with a debug line recording
  `reverifyOnly` and `checkPayload`'s result, or check whether `session.json` `handoff_issues` is
  populated before `handoff-issues` runs. The channel files were retired at 16:52:54, so their
  mtimes cannot be re-read.
- The task 154 finding (a resumed agent re-sends its old report on a re-verify) did not recur.

### Task 156 run (the dropped missing-payload warning)

The Task 155 case 2 warning was raised by the stop hook and then dropped by `handoff-issues`. Not a
run-boundary misread: that suspect was ruled out for this shape.

- **Cause, confirmed:** `dropResolvedMissingPayloads` (`resume-delivery.ts`, called from
  `handoff-issues` in `maestro-task-status.cjs` and from `maestro-resume-target.cjs`) matched lane
  files by session `run_id` only. The first run's earlier-numbered `test.1.md` carries that run id,
  so it counted as proof that `test.N.md` was present. Confirmed first by a fixture that ran the
  installed hook and CLI scripts, then by the live repeat. The order was the reverse of the ticket's;
  the manager accepted that (m010).
- **Fix (plugin 0.13.23):** a lane file resolves a `missing_payload` only when its mtime is at or
  after the issue's `ts` (1 s slack, as the hook's own check). An unreadable mtime or an unparseable
  `ts` never resolves it. Both callers pass `writtenAt` built from `channelFileMtime`, exported
  through the `maestro-session` bundle.
- **Live repeat** (resumed `@test`, `agent_id` a787bb5d7646cd420, `test.1.md` already in the lane):

  | Resumed run | `handoff-issues` printed |
  | --- | --- |
  | edits a file, writes no payload | `NO PAYLOAD written for HANDOFF: success (agent_id a787bb5d7646cd420)` |
  | edits a file, writes `test.2.md` | `Maestro handoffs: no problems recorded.` |
  | re-verify only | `Maestro handoffs: no problems recorded.` |

  The probe file was deleted afterwards.
- **Fixed (`152`, plugin 0.13.24):** the same warning was listed twice. `maestro-subagent-log.js`
  appended to `handoff_issues` with no dedup when the stop hook fired twice for one resumed run. It
  now appends through `appendHandoffIssue`, which lists an issue once per `kind|agent_id|files`.

## Things that bite

Each sub-concept carries the traps specific to it. These cut across all of them:

- **`maestro.json` is the single source of truth.** Hand-edit it then run `/maestro-update` to
  re-render the orchestrator.
- **`maestro/SKILL.md` has managed regions, and they _do_ get overwritten.** `Maestro:STEPS` and
  `Maestro:PRINCIPLES` are plugin-owned: `/maestro-install` and `/maestro-update` re-sync them from
  `templates/maestro/SKILL.md` on every run, which is how template improvements reach existing
  installs. `Maestro:HANDOFFS` is rendered from `maestro.json` and carried across a sync.
  **Everything outside the markers is yours and never touched** — put customisations there, not
  inside a region. The corollary: content the template adds **outside** a managed region reaches new
  installs only. The region list is `MANAGED_REGIONS` in `scripts/lib/maestro-skill-regions.cjs`;
  widening a region shrinks the space users can customise, so add regions rather than swallowing the
  whole file.
- **Pre-regions installs get migrated, not synced.** A `SKILL.md` with no `Maestro:STEPS` marker
  can't be synced in place (there's nothing to anchor to), so the installer backs it up to
  `SKILL.md.bak` and writes the template, reporting `orchestratorSkill.action === "migrated"`. Both
  install skills are told to surface that and offer to re-apply prose from the `.bak`. This happens
  once per project.
- **A task's own `Skills to use` name can name a skill outside the repository root's
  `.claude/skills`, and the Skill tool won't find it (`061`).** The orchestrator template's Step 3
  falls back to `node .claude/scripts/maestro-resolve-skill-path.cjs "<name>"`
  when the Skill tool answers "Unknown skill" — it prints the `SKILL.md` path when the id is a
  project skill living elsewhere in the tree, or nothing when it isn't a project skill at all (a
  typo, a plugin skill), and the orchestrator is told to `Read` a printed path directly rather than
  treat empty output as an error. Same resolver `maestro-inject-agent-context.js` uses for
  `loaded_skills`/`referenced_skills` — see `installing-maestro`'s manifest sub-concept for the
  shared `skill-resolve.ts` walk behind both.
