---
name: maestro-architecture
description: "Explains the Maestro runtime end-to-end: how a project goes from maestro.json to a live orchestrator, what the install does, how the SubagentStart/PreToolUse/SessionEnd hooks behave at runtime, how skills + condition-edge handoffs are injected, the HANDOFF routing contract, and the four config/state files (maestro.json, maestro_session.json, maestro_session.log.jsonl, maestro_session_tasks.json). Use when the user is working inside apps/maestro or plugins/maestro and asks how Maestro works at runtime, what the orchestrator does, why a subagent did/didn't get its skills, how handoffs route, what the install/uninstall touches, or which maestro file is authoritative."
---

# Maestro Runtime Architecture

Maestro turns a project into a multi-agent workflow: the user manually invokes the **`/maestro`** skill, which classifies each request, runs gates, picks a configured workflow, and dispatches subagents whose skills + handoff rules are injected at runtime from `.claude/maestro.json`.

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

## Install pipeline

Two paths produce the same result, and both end at a rendered orchestrator over a seeded `maestro.json`.

**The desktop app** (`apps/maestro`, `/maestro` route) — `installRuntime()` in `src/core`. No session involved. This is the path to prefer; it also reports what changed on disk and detects the double-registration case below.

**`/maestro-install`** — the terminal path, for a machine with no desktop app:

```
User runs /maestro-install
        │  Step 1: analyze repo → implementation agent(s)
        │  Step 2 (fresh install only): scan .claude/skills/ (skill id = dir name; frontmatter
        │          optional) → best-fit map each project skill to a seeded agent (impl +
        │          test/reviewer/refactor/scribe) → single AskUserQuestion consent prompt →
        │          skill map {agent: [skillId]}  (empty / skipped on re-install)
        ▼
maestro-install.js [--impl-agents a,b] [--skill-map {…}]   (idempotent)
  1. templates/maestro/SKILL.md → .claude/skills/maestro/SKILL.md
       absent   → copied whole
       present  → Maestro:STEPS + Maestro:PRINCIPLES regions re-synced from the template;
                  content outside the markers (and the rendered Maestro:HANDOFFS table) preserved
       no markers (pre-regions install) → old file → SKILL.md.bak, template written  (action: "migrated")
  2. runtime scripts             → .claude/scripts/{maestro-set-session-workflow.cjs, maestro-render-orchestrator.cjs, maestro-task-status.cjs, bash-validation.sh, lib/maestro-session.cjs, lib/maestro-tasks.cjs, lib/maestro-skill-regions.cjs}  (always refreshed)
  3. merge PreToolUse Bash hook (bash-validation.sh) → .claude/settings.json  (preserves other keys)
  4. ensure repo-root             .gitignore  `# Maestro` section     (**/.claude/maestro_session{,.log,_tasks}.{json,jsonl} — covers every nested .claude/ in a monorepo, including root; no per-project .claude/.gitignore is written)
  5. seed .claude/maestro.json from defaultV3Config(implAgents, skillMap)  — ONLY when absent
        ▼
node .claude/scripts/maestro-render-orchestrator.cjs
        rewrites the Maestro:HANDOFFS table in maestro/SKILL.md from maestro.json
```

Step 5 requires `lib/maestro-seed.cjs`, generated from `defaultV3Config` in `src/core` — the _same_ function the app seeds a fresh canvas with, so both paths produce a byte-identical starting config (`JSON.stringify(cfg, null, 2)`, no trailing newline). The seed is guarded on absence: an existing `maestro.json` is the user's authored graph and is never overwritten.

Why render is a separate step from scaffold: the renderer _consumes_ `maestro.json` and writes into `maestro/SKILL.md`, so both files must already exist. `/maestro-update` does the same two things standalone — refresh the project-copied scripts from the plugin, then re-render — which is what you run after a hand-edit to `maestro.json` or after a plugin version bump.

`/maestro-uninstall` reverses step 3 (removes the bash-validation `PreToolUse` hook and any legacy `agent: "maestro"` left by older installs) and clears the session files; `--purge` also removes the orchestrator skill, the copied scripts, and `maestro.json`. The desktop app's `/maestro` route has both levels too, and names every file in a confirmation before a purge.

**What `/maestro-install` cannot do:** author a graph. It seeds one. Adding a workflow, moving a node, promoting a skill from referenced to loaded, or assigning rules is the app's canvas or a hand-edit — and the `rules` slice starts empty either way, since placing rule files is `maestro-apply-rules.js`'s job.

`bash-validation.sh` (step 2/3) is a PreToolUse Bash guard: it denies any Bash command that reads a `.env` secret file, allowing only `.env.example`. It's a project-copied runtime script, so its hook command is `$CLAUDE_PROJECT_DIR/.claude/scripts/bash-validation.sh` and the installer reuses an existing `Bash` matcher rather than clobbering user hooks.

## Runtime lifecycle (one session)

```
User invokes /maestro in a session
        │
        ▼
Orchestrator (.claude/skills/maestro/SKILL.md):
  Step 0  classify request → node .claude/scripts/maestro-set-session-workflow.cjs "<workflow>"
                              └─ writes { workflow, generated_instances } → maestro_session.json
  Step 1-3  confidence + design gates (/confidence-check, /use-design-check — IF available)
  Step 4  pick the success path from the Maestro:HANDOFFS table
  Step 5  TaskCreate per step; Task() each agent step
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
| `SubagentStart` | `.*`         | `maestro-inject-agent-context.js` | Inject the matched instance's skills (two blocks: `loaded_skills` to auto-load + `referenced_skills` to load only if relevant), its `HANDOFF:` routing lines (success + condition labels), and the per-route `handoff_details` payload protocol (from `templates/handoffs/<sender>/<receiver>.md`). No-op when the agent maps to no instance, so a broad matcher safely covers custom agents too.                                                                                                                                                                                                                                          |
| `SubagentStart` | `.*`         | `maestro-subagent-log.js`         | Append a `kind:"dispatch"` entry to `maestro_session.log.jsonl`: the subagent's `agent_type`, `agent_id`, the full spawning message (`input`), and `offered_skills` (`{loaded, referenced}` — the skills `maestro-inject-agent-context.js` surfaces, resolved via the **shared** `resolveSearchList` + `collectAgentSkills` in `lib/maestro-session.cjs` so the logged set can't drift from the injected one). `/session-log` diffs `offered_skills` against the agent's reported `skillsTriage` to flag silently-dropped skills. Runs alongside `maestro-inject-agent-context.js`; order irrelevant. No-op when `maestro.json` is absent. |
| `SubagentStop`  | `.*`         | `maestro-subagent-log.js`         | If the stop carries an `agent_type` (a real workflow agent): append a `kind:"handoff"` entry — parses the subagent's `HANDOFF:` label from `last_assistant_message` → `status` (`"success"` / `"condition"` / `"unknown"`), stores the full final message as `output`, correlated to the dispatch entry by `agent_id`. If it has **no** `agent_type` (a subagent stop that isn't a workflow handoff): append a `kind:"transition"` entry (`origin:"transition"`, the message as `output`) instead, so a non-workflow boundary doesn't fall back to a misleading `unknown` handoff. No-op when `maestro.json` is absent.                    |
| `PreToolUse`    | `.*`         | `maestro-session-log.js`          | Append a tool-call line to `maestro_session.log.jsonl`. No-op when `maestro.json` is absent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `PostToolUse`   | `TaskCreate` | `maestro-validate-tasks.js`       | Validate that the created task matches a step in the active workflow's success path. Tracks created steps across the session in `maestro_session_tasks.json` (ephemeral, deleted at `SessionEnd`). Warns via `additionalContext` + `systemMessage` when a task doesn't match any workflow node or when a success-path step was skipped (e.g. `human review`). No-op when `maestro.json` is absent or no active workflow.                                                                                                                                                                                                                   |
| `SessionEnd`    | ``           | `maestro-session-cleanup.sh`      | Delete the three ephemeral session files (`maestro_session.json`, `maestro_session.log.jsonl`, `maestro_session_tasks.json`) from `<cwd>/.claude/`. That is its entire job. `maestro.json` and the orchestrator skill are deliberately preserved. No-op when the payload carries no `cwd`.                                                                                                                                                                                                                                                                                                                                                 |

There is **no `SessionStart` hook and no `UserPromptExpansion` hook.** Both existed only to serve the retired container: one reference-counted live sessions so teardown could wait for the last one, the other launched a web form and blocked the prompt until a result file appeared. Nothing replaced them — the desktop app is an ordinary application the user opens, so there is nothing to start, refcount, or tear down.

`maestro-inject-agent-context.js`, `maestro-subagent-log.js`, `maestro-session-log.js`, `maestro-validate-tasks.js` and `maestro-session-cleanup.sh` all run from `${CLAUDE_PLUGIN_ROOT}/scripts/` — edits to them take effect immediately for every project. `maestro-set-session-workflow.cjs`, `maestro-render-orchestrator.cjs` and `maestro-task-status.cjs` run from the **project copy** in `.claude/scripts/`, so changes to them only reach a project on (re)install or `/maestro-update`.

**`maestro-session-cleanup` exists twice, on purpose.** The plugin's `.sh` fires from `hooks.json`; the `.cjs` is what the installer copies into `<project>/.claude/scripts/` for a project that registers hooks locally. They do the same thing. The `.cjs` is node because the `.sh` shells out to `python3` to parse the hook payload, which a project cannot assume is installed. `templates/maestro/SKILL.md` reaches existing installs too: `/maestro-install` and `/maestro-update` re-sync its **managed regions** (`Maestro:STEPS`, `Maestro:PRINCIPLES`) into `.claude/skills/maestro/SKILL.md` on every run, so a template edit propagates on the next update — but only _inside_ those markers. Content the template adds **outside** a managed region still reaches new installs only.

## The HANDOFF contract

The subagent has no static knowledge of its handoffs — the `SubagentStart` hook injects, per its active-workflow instance:

1. **Skills**, in two kinds. `loaded_skills` are auto-loaded (`Skill` tool) before working — the imperative "load each one first" block. `referenced_skills` are surfaced as _available_: the agent loads one only if the task involves the logic that skill describes (it reads each skill's description to decide), otherwise ignores it. A skill that is `loaded` for any matched instance is dropped from the referenced list (loaded wins).
2. **Routing lines** — the `HANDOFF:` labels this node may emit: `success` (when a success edge leaves the node, resolved _through_ non-agent nodes like `human review` to the next agent) plus each labeled `condition` edge. Unlabeled condition edges are skipped — they aren't routable.
3. An instruction to **end its final message with exactly one `HANDOFF: <label>`** (`success`, or the exact condition label).
4. **The `handoff_details` payload protocol per route** — the JSON shape the receiving agent expects, read from `templates/handoffs/<sender>/<receiver>.md` (dir names = agent `name`; project-local `.claude/handoffs/<sender>/<receiver>.md` overrides the bundled copy). These live **outside** the `agents/` tree on purpose (see Things that bite). This is the whole communication layer: agent files no longer carry their own handoff shapes. A route with no matching template just gets the routing line, no payload.

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
| Where's the install logic?                             | `installRuntime()`/`uninstallRuntime()` in `src/core` (the app's `/maestro` route), and `plugins/maestro/scripts/maestro-install.js` for the terminal path                                                                                                                                            |
| How do I edit the graph without a session?             | Open the project in the Maestro desktop app (`apps/maestro`) → `/workflows` for the canvas, `/rules` for rule placement. A save renders the orchestrator and applies rules in the same call.                                                                                                                   |

## Things that bite

- **Deleting `maestro-session-cleanup` deletes nothing loudly.** It is the only thing that removes the ephemeral session files, and none of them are load-bearing for the _next_ session — a stale `maestro_session.json` just pins the wrong active workflow, a stale log just grows. Nothing errors. If session state starts looking impossibly old, check that this hook is registered and that its `cwd` is arriving.
- **Two things can register Maestro's hooks, and both firing is a visible bug.** A project installed from the app's `/maestro` route has them in its own `.claude/settings.json`; the `maestro` plugin registers the same ones globally from `hooks.json`. With both, every tool call is logged twice and every subagent gets its context injected twice. `InstallStatus.pluginHooksActive` detects it and the `/maestro` route says so — it does not "fix" it, because the fix is in the user's global configuration.
- **`maestro.json` is the single source of truth.** Hand-edit it then run `/maestro-update` to re-render the orchestrator.
- **`maestro/SKILL.md` has managed regions, and they _do_ get overwritten.** `Maestro:STEPS` and `Maestro:PRINCIPLES` are plugin-owned: `/maestro-install` and `/maestro-update` re-sync them from `templates/maestro/SKILL.md` on every run, which is how template improvements reach existing installs. `Maestro:HANDOFFS` is rendered from `maestro.json` and carried across a sync. **Everything outside the markers is yours and never touched** — put customisations there, not inside a region. The region list is `MANAGED_REGIONS` in `scripts/lib/maestro-skill-regions.cjs`; widening a region shrinks the space users can customise, so add regions rather than swallowing the whole file.
- **Pre-regions installs get migrated, not synced.** A `SKILL.md` with no `Maestro:STEPS` marker can't be synced in place (there's nothing to anchor to), so the installer backs it up to `SKILL.md.bak` and writes the template, reporting `orchestratorSkill.action === "migrated"`. Both install skills are told to surface that and offer to re-apply prose from the `.bak`. This happens once per project.
- **The gate skills are optional.** `/confidence-check` and `/use-design-check` are now bundled in this plugin (`plugins/maestro/skills/{confidence-check,use-design-check}`), but the orchestrator still references them "if available" and degrades gracefully if a project hasn't installed them.
- **Session logs are append-only by design.** Don't switch `maestro_session.log.jsonl` back to a read-modify-write JSON array — parallel subagents would lose entries.
- **Anything `.md` under `agents/` is discovered as an agent.** This is why the `handoff_details` protocol templates live at `templates/handoffs/<sender>/<receiver>.md`, **not** under `agents/`: a frontmatter-less `.md` inside the agents tree gets registered as a phantom agent (e.g. `…:refactor:handoffs:backend`) with **All tools**. Keep handoff templates (and any other non-agent `.md`) out of `agents/`. If you add a new sender/receiver pair, drop the file under `templates/handoffs/<sender>/` — `readHandoffProtocol()` resolves it there (and at the project-local `.claude/handoffs/<sender>/` override).
