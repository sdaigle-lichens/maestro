---
name: maestro-architecture
description: "Explains the Maestro runtime end-to-end: how a project goes from maestro.json to a live orchestrator, how the UserPromptExpansion/SubagentStart/PreToolUse/SessionEnd hooks behave at runtime — including the Step 0 readiness check, which is a hook rather than a step the orchestrator executes, and which copy of a hook fires when the plugin and a project-local install both register it, how skills + condition-edge handoffs are injected, the HANDOFF routing contract and the three-tier resolution (project file, global sqlite store, bundled seed) behind each route's handoff_details protocol, how a route's payload travels on an agent channel (`.claude/channels/<receiver>/<sender>.1.md`) rather than through the orchestrator's own context, the run_id stamp that guards a delivery's freshness, the orchestrator skill's managed regions and its optional config-driven Step 1 gates and Step 4 task-routing nudge (`046` — both injected dynamic context, the same third delivery channel beside hooks and template prose), the dual-registered hook that auto-enables that nudge on a session's first `/to-maestro-tasks` invocation (`047`), the separate always-on Step 4 prompt asking once about `/maestro-post-mortem` after a rough session (`049` — static template prose, not script-injected, not config-gated), and the config + session state on disk: maestro.json, plus the PER-SESSION directory <project>/.claude/maestro_sessions/<session_id>/{log.jsonl,session.json,tasks.json} (`064`) that replaced the three flat per-project files, and how a caller resolves which session it is (payload session_id -> CLAUDE_CODE_SESSION_ID -> null). Use when the user is working inside apps/maestro or plugins/maestro and asks how Maestro works at runtime, what the orchestrator does, why a subagent did/didn't get its skills, how handoffs route, where a route's handoff_details payload shape comes from and how to add or change one, why a channel payload wasn't delivered or was delivered late, why /maestro ran (or skipped) the confidence and design gates, why a condition-edge loop-back resumed an agent instead of spawning a fresh Task, why a resumed subagent's injected context is five blocks shorter than a first run's (`040`), why a hand-edited config's duplicate agent type is reported as a banner, a `/maestro-update` warning and an install-report line rather than repaired (`041`), why two concurrent Claude Code sessions in the same project no longer overwrite each other's log, active workflow, run_id or task coverage (`064`), or which maestro file is authoritative. For what the install writes and what a purge deletes, see the installing-maestro skill."
metadata:
  type: concept-skill
  version: "1.19"
  last-update: d83231be731d77a77ad7bf6bfbc0b47c24647a08
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
    ⇒ exit 2, and the invocation never happens.
        │
        ▼
Orchestrator (.claude/skills/maestro/SKILL.md):
  (no Step 0 — it is not a step any more; the hook above is the whole of it)
  Step 1  custom checks (OPTIONAL gates). The template holds three lines amounting to "do what
          the injected line says"; the injected `maestro-step1-gates.cjs` line supplies the
          step itself. A freshly seeded project: "no gates enabled, continue to Step 2".
  Step 2  classify request → node .claude/scripts/maestro-set-session-workflow.cjs "<workflow>"
                              └─ writes { workflow, generated_instances } → THIS session's
                                 maestro_sessions/<session_id>/session.json
  Step 3  execute the workflow: the success path from the Maestro:HANDOFFS table,
          TaskCreate per step, Task() each agent step
  Step 4  mark the task done (the mark-task-done node), then the OPTIONAL task-routing nudge
          (`046`) and the always-on /maestro-post-mortem question (`049`)
        │
        ▼ (each Task → subagent)
SubagentStart hook  (matcher ".*")  → maestro-inject-agent-context.js
  • reads active workflow from this session's session.json + the instance from maestro.json
  • FIRST run of this agent_id: injects skills + condition-edge routing + per-route payload
    protocol + report format;  RESUMED run: one reminder line instead
  • if the active workflow can't be resolved → prepends a ⚠️ warning (skills may be unioned/wrong)
  • channel delivery and the ⚠️ warning fire either way — a payload may be new since the agent's
    last run, and a warning is about now
        │
        ▼
Subagent runs, ends with a HANDOFF: line
        │
        ▼
Orchestrator reads HANDOFF:  → `success` continues the success path; a matching label routes back
                               to that node (resuming that agent when it already ran this session)
        │
   (every tool call, all agents)
        ▼
PreToolUse hook (matcher ".*") → maestro-session-log.js → appends one line to this session's log.jsonl
        │
        ▼
SessionEnd hook → maestro-session-cleanup.sh (plugin) / .cjs (project copy)
                  → deletes ONLY THE ENDING SESSION'S directory, sweeps .claude/channels/,
                    keeps maestro.json and the orchestrator skill.
```

## Where the detail lives

| Sub-concept | Covers |
| --- | --- |
| `sub-concepts/hooks.md` | Every hook: event, matcher, script, exact effect. Why there is no `SessionStart`. The two copies of every script and which one wins. The Step 0 traps. |
| `sub-concepts/session-state.md` | `maestro.json` and the per-session directory (`064`): the file table, `log.jsonl`'s entry kinds, and how a caller resolves which session it is. |
| `sub-concepts/handoff-contract.md` | The four blocks `SubagentStart` injects, the three-tier `handoff_details` resolution, and what the orchestrator does with a `HANDOFF:` line. |
| `sub-concepts/channels.md` | `.claude/channels/` (`036`): how a route's payload travels, the `run_id` stamp, retirement and the 14-day sweep. |
| `sub-concepts/step-gates.md` | Injected context as a third delivery channel: the Step 1 gates (`032`), the Step 4 task-routing nudge (`046`/`047`), and the post-mortem prompt that is NOT part of it (`049`). |
| `sub-concepts/agent-resume.md` | Why a condition-edge loop-back resumes an agent instead of spawning one (`039`), and why a resumed run's injection is five blocks shorter (`040`). |

## Common questions — where to look

| Question | Look at |
| --- | --- |
| Why didn't a subagent get its skills? | active workflow in this session's `maestro_sessions/<id>/session.json` (was `maestro-set-session-workflow.cjs` run?); the instance's `agent` must equal the subagent's `name`; the skill must be a real project skill |
| Why are the wrong skills injected? | likely no/mismatched active workflow → union across workflows (the injected `⚠️ warning` says so) |
| How do I change the orchestrator's behavior? | edit `.claude/skills/maestro/SKILL.md` **outside** the `Maestro:*` markers — the `STEPS`/`PRINCIPLES` regions are re-synced from the plugin template on every install/update; to change those for good, edit `templates/maestro/SKILL.md` in the plugin |
| My edit to the orchestrator's steps disappeared | it was inside a managed region and got re-synced. Move it outside the markers, or change the template |
| The handoff table is stale | run `/maestro-update` (re-renders from `maestro.json`) |
| How do I turn Maestro off? | `/maestro-uninstall` (removes the bash-validation hook + session files); `--purge` to also remove the orchestrator skill + scripts |
| How did this session go / what could have gone better? | `/maestro-post-mortem` — `maestro-post-mortem.js` digests the invoking session's `log.jsonl` (read-only; `--session <id>` picks another, and with no id resolvable it lists the available sessions instead of digesting an arbitrary one) and the skill couples it with the main session's context to flag avoidable work, false checks, bad assumptions, and handoff issues, then proposes fixes. Run mid-session (the log is wiped at `SessionEnd`). |
| Where's the install logic? | the `installing-maestro` skill — `installRuntime()`/`uninstallRuntime()` in `src/core` for the app, `plugins/maestro/scripts/maestro-{install,uninstall}.js` for the terminal path |
| How do I edit the graph without a session? | Open the project in the Maestro desktop app (`apps/maestro`) → `/workflows` for the canvas, `/rules` for rule placement. A save renders the orchestrator and applies rules in the same call. |
| A handoff payload wasn't delivered, or looks stale | check `.claude/channels/<receiver>/<sender>.1.md` — undelivered if still there, retired to `.claude/channels/.consumed/<receiver>/` if already read. Compare its stamped `run_id` (first line) against this session's own `session.json`; a mismatch means it will be *mentioned*, not inlined, until a matching run consumes it. Full mechanism: `sub-concepts/channels.md`. |
| Why did a condition edge resume an agent instead of spawning a fresh one? (`039`) | `maestro-resume-target.cjs` found a `kind:"handoff"` log entry for that bare agent type this session and printed its `agent_id`. It prints nothing (cold `Task`) when there is no completed run yet, or when the active workflow maps that agent type to more than one distinct instance. |
| Why did a resumed subagent get so much less injected context than a first run? (`040`) | Working as designed — `hasCompletedRun()` found a `kind:"handoff"` entry for that `agent_id` already, so the skills/routing/protocols/report were skipped for a one-line reminder. Channel delivery and the `⚠️` warning still fire normally. See `sub-concepts/agent-resume.md`. |
| Why does a hand-edited config's duplicate agent type show up as a banner / stderr warning / install report line? (`041`) | `apps/maestro/src/core/config-validate.ts`'s `duplicateAgentTypes(cfg)` — a pure validator reporting two **placed** instances in one workflow sharing a bare agent, run from three call sites (the app's config load, `/maestro-update`, and `install.ts`) and never auto-repairing. See `maestro-config-model` (apps/maestro's `.claude/skills`) for where each call site computes it. |

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
  falls back to `node "$CLAUDE_PROJECT_DIR/.claude/scripts/maestro-resolve-skill-path.cjs" "<name>"`
  when the Skill tool answers "Unknown skill" — it prints the `SKILL.md` path when the id is a
  project skill living elsewhere in the tree, or nothing when it isn't a project skill at all (a
  typo, a plugin skill), and the orchestrator is told to `Read` a printed path directly rather than
  treat empty output as an error. Same resolver `maestro-inject-agent-context.js` uses for
  `loaded_skills`/`referenced_skills` — see `installing-maestro`'s manifest sub-concept for the
  shared `skill-resolve.ts` walk behind both.
