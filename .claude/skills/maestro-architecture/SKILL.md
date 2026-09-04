---
name: maestro-architecture
description: "Explains the Maestro runtime end-to-end: how a project goes from maestro.json to a live orchestrator, how the UserPromptExpansion/SubagentStart/PreToolUse/SessionEnd hooks behave at runtime — including the Step 0 readiness check, which is a hook rather than a step the orchestrator executes, and which copy of a hook fires when the plugin and a project-local install both register it, how skills + condition-edge handoffs are injected, the HANDOFF routing contract and the three-tier resolution (project file, global sqlite store, bundled seed) behind each route's handoff_details protocol, the orchestrator skill's managed regions and its optional config-driven Step 1 gates (injected dynamic context — a third delivery channel beside hooks and template prose), and the four config/state files (maestro.json, maestro_session.json, maestro_session.log.jsonl, maestro_session_tasks.json). Use when the user is working inside apps/maestro or plugins/maestro and asks how Maestro works at runtime, what the orchestrator does, why a subagent did/didn't get its skills, how handoffs route, where a route's handoff_details payload shape comes from and how to add or change one, why /maestro ran (or skipped) the confidence and design gates, or which maestro file is authoritative. For what the install writes and what a purge deletes, see the installing-maestro skill."
metadata:
  type: concept-skill
  version: "1.8"
  last-update: 19a84d56fa22146635222ccb1662e152cdbadb1c
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
          the injected line says"; !`node .claude/scripts/maestro-step1-gates.cjs` supplies the
          step itself. A freshly seeded project: "no gates enabled, continue to Step 2".
  Step 2  classify request → node .claude/scripts/maestro-set-session-workflow.cjs "<workflow>"
                              └─ writes { workflow, generated_instances } → maestro_session.json
  Step 3  execute the workflow: the success path from the Maestro:HANDOFFS table,
          TaskCreate per step, Task() each agent step
  Step 4  mark the task done (the mark-task-done node)
        │
        ▼ (each Task → subagent)
SubagentStart hook  (matcher ".*")  → maestro-inject-agent-context.js
  • reads active workflow from maestro_session.json + the instance from maestro.json
  • injects additionalContext: the instance's loaded_skills (auto-load first) + referenced_skills (load only if relevant) + condition-edge labels
  • condition edges → tells the subagent to end with a `HANDOFF: <label>` / `HANDOFF: success` line
  • if the active workflow can't be resolved → prepends a ⚠️ warning (skills may be unioned/wrong)
        │
        ▼
Subagent runs, ends with a HANDOFF: line
        │
        ▼
Orchestrator reads HANDOFF:  → `success` continues the success path; a matching label routes back to that node
        │
   (every tool call, all agents)
        ▼
PreToolUse hook (matcher ".*") → maestro-session-log.js → appends one line to maestro_session.log.jsonl
        │
        ▼
SessionEnd hook → maestro-session-cleanup.sh (plugin) / .cjs (project copy)
                  → deletes all three ephemeral files: maestro_session.json,
                    maestro_session.log.jsonl, maestro_session_tasks.json
                  → and nothing else. maestro.json and the orchestrator skill are kept.
```

## The four files

| File                         | Path                                           | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Written by                                                                             | Lifecycle                                                     |
| ---------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `maestro.json`               | `<project>/.claude/maestro.json`               | **Source of truth** (`version: 3`). Every hook + the renderer read this. `success_path` is **not** stored here.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | App + skill (byte-identical)                                                           | Committed; edited via canvas or by hand (+ `/maestro-update`) |
| `maestro_session.json`       | `<project>/.claude/maestro_session.json`       | Ephemeral session state: `{ workflow, generated_instances }`. Tells `maestro-inject-agent-context.js` which workflow is active.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `maestro-set-session-workflow.cjs`, `maestro-inject-agent-context.js`                  | Ephemeral; **gitignored**; deleted at `SessionEnd`            |
| `maestro_session.log.jsonl`  | `<project>/.claude/maestro_session.log.jsonl`  | Ephemeral **append-only** log. Four entry kinds: (1) plain tool-call `{ts, origin, log}` (PreToolUse); (2) `kind:"dispatch"` `{ts, origin:"main_session", agent, agent_id, input, offered_skills?, log}` (SubagentStart); (3) `kind:"handoff"` `{ts, origin, agent_id, status, label, output, log}` (SubagentStop **with** an `agent_type`); (4) `kind:"transition"` `{ts, origin:"transition", output, log}` (SubagentStop with **no** `agent_type` — a boundary that isn't a workflow handoff at all, kept neutral instead of masquerading as an `unknown` handoff). Append-only so parallel subagents don't race. The desktop app **live-tails** this file from its main process and pushes lines to the renderer over `window.maestro.log` — the hooks stay append-only and network-free, and the tail is read-only and entirely separate from the write path. | `maestro-session-log.js` (PreToolUse) + `maestro-subagent-log.js` (SubagentStart/Stop) | Ephemeral; **gitignored**; deleted at `SessionEnd`            |
| `maestro_session_tasks.json` | `<project>/.claude/maestro_session_tasks.json` | Ephemeral task-coverage tracker: `{ steps: ["@backend", "human review", ...] }`. Records which success-path steps already have a `TaskCreate` in this session. Read-modify-write is safe (only the main orchestrator calls `TaskCreate`, no parallel race).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `maestro-validate-tasks.js` (PostToolUse)                                              | Ephemeral; **gitignored**; deleted at `SessionEnd`            |

`success_path` is derived by `successPathSteps` in `lib/maestro-session.cjs` — never persisted in `maestro.json`, only rendered into the orchestrator's `Maestro:HANDOFFS` table (`→` separator, `human review` label).

## Hook reference (plugins/maestro/hooks/hooks.json)

| Event           | Matcher      | Script                            | Effect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------- | ------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `UserPromptExpansion` | `maestro` | `maestro-step0.js` | The orchestrator's Step 0, run by the harness instead of by the model. Fires when the user TYPES `/maestro`, before the expansion reaches the model. `continue` ⇒ no output at all (the case it exists for); `update` ⇒ the instruction on plain stdout, which this event adds to context; `install` ⇒ **exit 2, blocking the expansion**. The forked-agent check rides along and only ever speaks when something diverged. |
| `PreToolUse`    | `Skill`      | `maestro-step0.js`                | The same check for the other entrance — the model invoking the maestro skill through the `Skill` tool, where no expansion happens. Identical answers, except that PreToolUse does **not** add plain stdout to context, so the instruction travels as `hookSpecificOutput.additionalContext`. No-op for every other skill. |
| `SubagentStart` | `.*`         | `maestro-inject-agent-context.js` | Inject the matched instance's skills (two blocks: `loaded_skills` to auto-load + `referenced_skills` to load only if relevant), its `HANDOFF:` routing lines (success + condition labels), and the per-route `handoff_details` payload protocol, resolved across three tiers (`.claude/handoffs/<sender>/<receiver>.md` → `~/.claude/maestro-handoff-defaults.sqlite` → the seed constant bundled into `lib/maestro-session.cjs`). The route walk itself is `handoffRoutes()` in that same bundle, shared with the install-time sync. No-op when the agent maps to no instance, so a broad matcher safely covers custom agents too.                                                                                                                                                                                                                                          |
| `SubagentStart` | `.*`         | `maestro-subagent-log.js`         | Append a `kind:"dispatch"` entry to `maestro_session.log.jsonl`: the subagent's `agent_type`, `agent_id`, the full spawning message (`input`), and `offered_skills` (`{loaded, referenced}` — the skills `maestro-inject-agent-context.js` surfaces, resolved via the **shared** `resolveSearchList` + `collectAgentSkills` in `lib/maestro-session.cjs` so the logged set can't drift from the injected one). `/session-log` diffs `offered_skills` against the agent's reported `skillsTriage` to flag silently-dropped skills. Runs alongside `maestro-inject-agent-context.js`; order irrelevant. No-op when `maestro.json` is absent. |
| `SubagentStop`  | `.*`         | `maestro-subagent-log.js`         | If the stop carries an `agent_type` (a real workflow agent): append a `kind:"handoff"` entry — parses the subagent's `HANDOFF:` label from `last_assistant_message` → `status` (`"success"` / `"condition"` / `"unknown"`), stores the full final message as `output`, correlated to the dispatch entry by `agent_id`. If it has **no** `agent_type` (a subagent stop that isn't a workflow handoff): append a `kind:"transition"` entry (`origin:"transition"`, the message as `output`) instead, so a non-workflow boundary doesn't fall back to a misleading `unknown` handoff. No-op when `maestro.json` is absent.                    |
| `PreToolUse`    | `.*`         | `maestro-session-log.js`          | Append a tool-call line to `maestro_session.log.jsonl`. No-op when `maestro.json` is absent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `PostToolUse`   | `TaskCreate` | `maestro-validate-tasks.js`       | Validate that the created task matches a step in the active workflow's success path. Tracks created steps across the session in `maestro_session_tasks.json` (ephemeral, deleted at `SessionEnd`). Warns via `additionalContext` + `systemMessage` when a task doesn't match any workflow node or when a success-path step was skipped (e.g. `human review`). No-op when `maestro.json` is absent or no active workflow.                                                                                                                                                                                                                   |
| `SessionEnd`    | ``           | `maestro-session-cleanup.sh`      | Delete the three ephemeral session files (`maestro_session.json`, `maestro_session.log.jsonl`, `maestro_session_tasks.json`) from `<cwd>/.claude/`. That is its entire job. `maestro.json` and the orchestrator skill are deliberately preserved. No-op when the payload carries no `cwd`.                                                                                                                                                                                                                                                                                                                                                 |

There is **no `SessionStart` hook**. It existed only to serve the retired container, reference-counting live sessions so teardown could wait for the last one; nothing replaced it — the desktop app is an ordinary application the user opens, so there is nothing to start, refcount, or tear down. `UserPromptExpansion` is registered again, but for an unrelated job: the container-era entries launched a web form and blocked the prompt until a result file appeared, whereas `maestro-step0.js` answers a question about this project and gets out of the way.

**Every one of these scripts exists in two places, and neither copy updates on its own.** The six hook scripts above (`maestro-step0.js`, `maestro-inject-agent-context.js`, `maestro-subagent-log.js`, `maestro-session-log.js`, `maestro-validate-tasks.js`, `maestro-session-cleanup.sh`) run from `${CLAUDE_PLUGIN_ROOT}/scripts/` — which resolves into the **version-keyed marketplace cache**, so an edit reaches a project only after a `plugin.json` version bump and re-pull. The installer also copies them into `<project>/.claude/scripts/` as `.cjs`, and those copies only refresh on (re)install or `/maestro-update`. `maestro-set-session-workflow.cjs`, `maestro-render-orchestrator.cjs`, `maestro-task-status.cjs` and `maestro-step1-gates.cjs` (`032`) exist **only** as project copies. Which copy of a hook actually fires when both are registered is `projectOwnsHook`'s call — see Things that bite. Both staleness rules: `updating-maestro`.

**`maestro-session-cleanup` exists twice, on purpose.** The plugin's `.sh` fires from `hooks.json`; the `.cjs` is what the installer copies into `<project>/.claude/scripts/` for a project that registers hooks locally. They do the same thing. The `.cjs` is node because the `.sh` shells out to `python3` to parse the hook payload, which a project cannot assume is installed. It is also the **one hook script with no arbitration guard**: both copies just `rm -f` the same three ephemeral files, so a double fire is unobservable and a third implementation of the arbitration in bash would cost more than the no-op. `templates/maestro/SKILL.md` reaches existing installs too: `/maestro-install` and `/maestro-update` re-sync its **managed regions** (`Maestro:STEPS`, `Maestro:PRINCIPLES`) into `.claude/skills/maestro/SKILL.md` on every run, so a template edit propagates on the next update — but only _inside_ those markers. Content the template adds **outside** a managed region still reaches new installs only.

**Injected context is a third delivery channel, and it is the only one that can abort the
invocation.** A hook pushes context in from outside the skill; the template's prose carries it
statically inside the body. Step 1 uses neither: the body holds a `` !`command` `` line, and Claude
Code runs that command and substitutes its **stdout** before the model ever sees the prompt.

**The injected line is the whole of Step 1, not a flag the body branches on**, and that is the
point of using this channel at all. `maestro-step1-gates.cjs` prints the full instruction for the
resolved state — which skills, in what order, with the `Skill` tool in the orchestrator's own
context, and what to do about a low score — while the template holds only "do exactly what the line
above says" plus the fallback below. The reasoning is `maestro-check-runtime.cjs`'s, verbatim: a
branch table in `SKILL.md` is re-read at the top of **every** orchestration including the default
one, and prose that re-derives a decision made in code is prose that can disagree with it. An
earlier draft split them — a terse `Gates: run /confidence-check.` in the script and the bullets in
the template — and it is the wrong shape for both reasons.

Four consequences, all load-bearing:

- **The command needs a grant, and the grant is not optional.** A permission check answering
  anything but `allow` aborts the whole invocation — the model never sees the orchestrator at all.
  It is granted by `allowed-tools` in the *template's frontmatter*, which is a **grant**, not a
  restriction (`disallowed-tools` is the restriction field), so it does not narrow the
  orchestrator's access to `Task`/`TaskCreate`/`Skill`/`Read`. Deliberately **not** a
  `permissions.allow` entry in the project's `settings.json` — see `installing-maestro`.
- **A non-zero exit aborts it too.** Which is why `maestro-step1-gates.cjs` exits 0 unconditionally,
  writes nothing to stderr, and has no failure branch: every degenerate input resolves to the
  continue-to-Step-2 line instead.
- **Exactly one line, however long.** Each of the four is several sentences on a single
  newline-terminated line — it keeps the contract trivially assertable and lets the body say "the
  line above". `install.test.ts` pins the *properties* (one line, only the enabled gates named, in
  order, always sending the orchestrator on to Step 2, four distinct answers) rather than the
  wording, which is prose and expected to be reworded.
- **A missing script does not degrade — it kills `/maestro`.** The command is a single clause with
  no `|| true`, so `node` on an absent file exits 1. `maestro-check-runtime.cjs` therefore carries a
  presence check (`SKILL_INVOKED_SCRIPTS` — the scripts the orchestrator names by
  `$CLAUDE_PROJECT_DIR` path: `maestro-step1-gates.cjs`, `maestro-set-session-workflow.cjs`,
  `maestro-task-status.cjs`) and answers `update` when one is absent. That nag is the only thing
  between a half-installed project and an aborted invocation.

If the harness has `disableSkillShellExecution: true`, the line is replaced with the literal
`[shell command execution disabled by policy]`. **This is the one thing the script cannot speak
to** — its own output never arrived — so it is the one thing the template must still say for
itself: a missing, empty or policy-replaced line means this project has no Step 1, go to Step 2.
Keep that sentence in the template however much else moves into the script.

## The HANDOFF contract

The subagent has no static knowledge of its handoffs — the `SubagentStart` hook injects, per its active-workflow instance:

1. **Skills**, in two kinds. `loaded_skills` are auto-loaded (`Skill` tool) before working — the imperative "load each one first" block. `referenced_skills` are surfaced as _available_: the agent loads one only if the task involves the logic that skill describes (it reads each skill's description to decide), otherwise ignores it. A skill that is `loaded` for any matched instance is dropped from the referenced list (loaded wins).
2. **Routing lines** — the `HANDOFF:` labels this node may emit: `success` (when a success edge leaves the node, resolved _through_ non-agent nodes like `human review` to the next agent) plus each labeled `condition` edge. Unlabeled condition edges are skipped — they aren't routable.
3. An instruction to **end its final message with exactly one `HANDOFF: <label>`** (`success`, or the exact condition label).
4. **The `handoff_details` payload protocol per route** — the JSON shape the receiving agent expects. Since `033` this is **three tiers**, decided by one pure `resolveHandoff()` (`src/core/handoff-resolution.ts`) that the hook and the app both call: the project file `.claude/handoffs/<sender>/<receiver>.md`, else the machine-wide row in `~/.claude/maestro-handoff-defaults.sqlite`, else the `SEED_HANDOFFS` constant (`src/core/handoff-seeds.ts`) that ships **inside** `lib/maestro-session.cjs`. The seed tier is a real source, not a synonym for the global one: the sqlite bundle is `require`d in a try/catch, so on a `node` older than 22.5 the seed is what still answers. **A middle tier only exists if its bundle is where the running copy of the hook can `require` it** — until `035` neither `lib/maestro-handoff-defaults.cjs` nor `lib/maestro-report-defaults.cjs` was copied into `.claude/scripts/lib/`, so the project's own copy of this hook fell past the global row in silence (to the seed for handoffs; to *nothing* for a report, which has no seed) while the plugin's copy, running beside the whole `lib/`, answered correctly — making the arbitration winner decide what an agent was told. Both are `STATIC_ASSETS` now; a project on a pre-`0.4.4` runtime still behaves the old way until it re-installs. Both ends of a route are **bare** agent names (`maestro:test` → `test`), which is what makes the id `"<sender>/<receiver>"` map straight onto the project file's path. This is the whole communication layer: agent files no longer carry their own handoff shapes. A route with no seed and no override just gets the routing line, no payload. Since `034` the top two tiers each have an editing surface in the desktop app — `/templates`' **Handoffs** tab writes the global row, `/agents`' **Interactions** pane writes the project override for one route (and drops that pair's `syncedFrom`) — so a protocol no longer has to be changed by hand-editing a file or the sqlite store. The seed tier has none: it is a compiled-in constant, edited in source. See `global-stores` and `agents-view` in `apps/maestro/.claude/skills`.

The orchestrator (`templates/maestro/SKILL.md`, Step 5) reads the `HANDOFF:` line: `success` continues the workflow's success path; a label matching a condition edge routes back to that edge's target node. A missing/unknown line is treated as `success` but flagged. It then **forwards the emitted `handoff_details` payload** verbatim into the routed-to subagent's `Task` prompt.

**Condition edges from a `human review` node are the exception — orchestrator-driven, not HANDOFF-driven.** A human-review node has no subagent, so nothing emits a `HANDOFF:` line for it. Instead the orchestrator itself, at the human-review hard stop, reads the user's feedback: on approval it continues the success path; on a correction request it dispatches the change as a `Task` to the agent a `condition` edge points at (e.g. `human requested code corrections` → `@backend`), rather than editing code in its own context. The seeded `default`/`tdd` workflows wire these edges automatically (`buildWorkflow` in `maestro.ts`: default → impl agent(s), split per-agent for fullstack; tdd → `@test`, since the human reviews the test plan before impl runs).

Note: protocol templates live **only** in the agent template files, never in `maestro.json` — keeping the app/skill byte-identical `maestro.json` invariant intact. The hook reads them as a side input, exactly as it reads session state.

## Common questions — where to look

| Question                                               | Look at                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Why didn't a subagent get its skills?                  | active workflow in `maestro_session.json` (was `maestro-set-session-workflow.cjs` run?); the instance's `agent` must equal the subagent's `name`; the skill must be a real project skill                                                                                                                       |
| Why are the wrong skills injected?                     | likely no/mismatched active workflow → union across workflows (the injected `⚠️ warning` says so)                                                                                                                                                                                                              |
| How do I change the orchestrator's behavior?           | edit `.claude/skills/maestro/SKILL.md` **outside** the `Maestro:*` markers — the `STEPS`/`PRINCIPLES` regions are re-synced from the plugin template on every install/update; to change those for good, edit `templates/maestro/SKILL.md` in the plugin                                                        |
| My edit to the orchestrator's steps disappeared        | it was inside a managed region and got re-synced. Move it outside the markers, or change the template                                                                                                                                                                                                          |
| The handoff table is stale                             | run `/maestro-update` (re-renders from `maestro.json`)                                                                                                                                                                                                                                                         |
| How do I turn Maestro off?                             | `/maestro-uninstall` (removes the bash-validation hook + session files); `--purge` to also remove the orchestrator skill + scripts                                                                                                                                                                             |
| How did this session go / what could have gone better? | `/maestro-post-mortem` — `maestro-post-mortem.js` digests `maestro_session.log.jsonl` (read-only) and the skill couples it with the main session's context to flag avoidable work, false checks, bad assumptions, and handoff issues, then proposes fixes. Run mid-session (the log is wiped at `SessionEnd`). |
| Where's the install logic?                             | the `installing-maestro` skill — `installRuntime()`/`uninstallRuntime()` in `src/core` for the app, `plugins/maestro/scripts/maestro-{install,uninstall}.js` for the terminal path                                                                                                                    |
| How do I edit the graph without a session?             | Open the project in the Maestro desktop app (`apps/maestro`) → `/workflows` for the canvas, `/rules` for rule placement. A save renders the orchestrator and applies rules in the same call.                                                                                                                   |

## Things that bite

- **Step 0 is a hook and nothing else, so a project that never gets the hook is never checked — silently.** The orchestrator template no longer carries a readiness step at all: `Maestro:STEPS` runs straight from "How to orchestrate" into Step 1, and nothing in it mentions `maestro-check-runtime.cjs` or `maestro-agent-forks.cjs`. That is the point (the healthy path costs zero tokens), but it means the check has exactly two entrances — a **typed** `/maestro` (`UserPromptExpansion`) and a `Skill` tool call (`PreToolUse`). A project whose installed runtime predates `maestro-step0` and has not run `/maestro-update`, or an invocation arriving by any other route, gets **no check and no warning that none happened**. A deliberate, accepted trade: do not "fix" it by putting the bash calls back into the template. `maestro-check-runtime.cjs`'s CLI still prints the same JSON for a **person** debugging by hand.
- **Deleting `maestro-session-cleanup` deletes nothing loudly.** It is the only thing that removes the ephemeral session files, and none of them are load-bearing for the _next_ session — a stale `maestro_session.json` just pins the wrong active workflow, a stale log just grows. Nothing errors. If session state starts looking impossibly old, check that this hook is registered and that its `cwd` is arriving.
- **Two things can register Maestro's hooks, and the plugin's copy stands down per hook.** A project installed from the app's `/maestro` route has them in its own `.claude/settings.json`; the `maestro` plugin registers the same ones globally from `hooks.json`. Both firing used to log every tool call twice and inject every subagent's context twice; `projectOwnsHook` (`src/core/hook-arbitration.ts`) now arbitrates it at runtime — the plugin's copy exits 0 for any hook the project registers itself, and covers the rest. It is keyed on the **registration**, not on the twin file existing, so a non-purging uninstall hands the hooks back to the plugin rather than turning Maestro off. Full rule: `installing-maestro`'s hook-arbitration sub-concept. The guard only reaches a machine on a plugin version bump, so a stale cached plugin still double-fires.
- **`maestro.json` is the single source of truth.** Hand-edit it then run `/maestro-update` to re-render the orchestrator.
- **`maestro/SKILL.md` has managed regions, and they _do_ get overwritten.** `Maestro:STEPS` and `Maestro:PRINCIPLES` are plugin-owned: `/maestro-install` and `/maestro-update` re-sync them from `templates/maestro/SKILL.md` on every run, which is how template improvements reach existing installs. `Maestro:HANDOFFS` is rendered from `maestro.json` and carried across a sync. **Everything outside the markers is yours and never touched** — put customisations there, not inside a region. The region list is `MANAGED_REGIONS` in `scripts/lib/maestro-skill-regions.cjs`; widening a region shrinks the space users can customise, so add regions rather than swallowing the whole file.
- **Pre-regions installs get migrated, not synced.** A `SKILL.md` with no `Maestro:STEPS` marker can't be synced in place (there's nothing to anchor to), so the installer backs it up to `SKILL.md.bak` and writes the template, reporting `orchestratorSkill.action === "migrated"`. Both install skills are told to surface that and offer to re-apply prose from the `.bak`. This happens once per project.
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
- **Step 1's gates are a per-project setting and they default to OFF** (`032`). `maestro.json`'s
  `gates: { confidence_check, use_design_check }` is resolved at invocation time by
  `maestro-step1-gates.cjs`, whose one line of stdout is injected into the body and carries the
  whole step — which gates to run, in what order, and how. All four combinations are valid and none nests inside another. A
  seeded config has both `false`, and **every** degenerate case — no config, corrupt JSON,
  `version !== 3`, `gates` absent or not a plain object, a non-boolean value, any throw — resolves
  to the continue-to-Step-2 line, quietly, with exit 0. The checkboxes live on the desktop app's `/maestro` page;
  there is no migration, so a project installed before `032` simply has no `gates` field and skips.
  `/confidence-check` and `/use-design-check` are still bundled in this plugin
  (`plugins/maestro/skills/{confidence-check,use-design-check}`), but the orchestrator no longer
  references them "if available" — it runs what the injected line names, and is told to say so
  rather than invent one if a named gate isn't installed.
- **`use-design-check` means two different things and only one of them is a gate.** The seeded
  **Refactor** workflow has a `skill:use-design-check` **node** in its success path — that is
  Step 3's inline-skill mechanism, driven by `workflows`, and it is untouched by the `gates` field.
  Turning both gates off does not remove it. `seed.ts` used to call it "the always-present gate
  skill" in a comment; that was corrected in `032` because it invited exactly this confusion.
- **Session logs are append-only by design.** Don't switch `maestro_session.log.jsonl` back to a read-modify-write JSON array — parallel subagents would lose entries.
- **Anything `.md` under `agents/` is discovered as an agent.** A frontmatter-less `.md` inside the agents tree gets registered as a phantom agent (e.g. `…:refactor:handoffs:backend`) with **All tools**, which is why handoff protocols were never kept there. Since `033` they are not files in the plugin at all: `plugins/maestro/templates/handoffs/**` is **deleted** and `readHandoffProtocol()` no longer exists. **To add a sender/receiver pair *that Maestro ships*, add a key to `SEED_HANDOFFS` in `apps/maestro/src/core/handoff-seeds.ts`** (a pair only *this machine* needs is a Create on `/templates`' Handoffs tab instead — a global row, no rebuild), then re-run `pnpm --filter maestro build:plugin-libs` — editing the source without rebuilding leaves the hook reading the old bundle. Editing an *existing* seed body additionally needs its previous text in `PRIOR_SEEDS`, or every machine that has already opened the global store keeps serving the old one, silently.
