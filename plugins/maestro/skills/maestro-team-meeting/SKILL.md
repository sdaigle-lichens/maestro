---
name: maestro-team-meeting
description: "Holds a team meeting of this project's configured Maestro subagents: each one reviews the setup from its own role and proposes improvements to workflows, skills and skill placement, agents and their tools, rules, handoff templates, reports and gates. You moderate: one parallel proposal round, a second round only for agents whose proposals conflict, then a single batch of approvals before anything changes. Review mode looks at the setup as a whole; post-mortem mode resumes the agents that just ran a workflow so they can propose fixes from what actually happened. Use when the user asks for a team meeting, wants the agents to review or improve the Maestro setup, or wants an agent-driven retro after a run."
---

# Maestro Team Meeting

You are the moderator. Participants are the project's real subagents. They only **propose**. You
apply what the user approves. Participants never talk to each other; everything goes through
files in this session's meeting directory and through you.

While a meeting runs, the Maestro hooks treat each participant's runs as meeting turns, not
workflow steps:

- no HANDOFF routing, payload protocol or report format is injected;
- channel payloads are not delivered to participants, and nothing they write is stamped;
- their runs are not resume targets for a later loop-back;
- their file writes are confined to the meeting directory.

Bash cannot be confined. The notice each participant gets limits it to read-only checks.

`TM` below means `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-team-meeting.cjs"`. Every
command prints one line of JSON.

## Workflow

1. **Pick the mode.**
   - Use `post-mortem` when a workflow ran in this session and the user wants to learn from it.
   - Otherwise use `review`.
   - Pass `--participants a,b` only if the user named agents. The default for review is every agent placed on a workflow; for post-mortem it is every agent that completed a run this session.

2. **Start, then write the brief.**

   ```bash
   TM start --mode <review|post-mortem> "${CLAUDE_PROJECT_DIR:-.}"
   TM brief "${CLAUDE_PROJECT_DIR:-.}"
   ```

   - If `start` returns `ok:false`, stop. Tell the user its `reason`. A stale runtime needs `/maestro-update` first: the project's hook copies must know about meetings.
   - Keep `meeting.dir` and the `brief` and `slices` paths. Do not read the brief into your own context; the participants read it.

   **Agenda confirmation (user checkpoint 1).** Before round 1, show the user, in your own context:
   - the participants (`meeting.participants`);
   - a short summary of the evidence (the `evidence` counts from `brief`, plus what the digest covers);
   - the focus areas (default: skills and placement, handoffs, agents and tools, rules, gates, workflows).

   Ask with `AskUserQuestion`: go ahead, add or drop participants, narrow or widen the focus, or cancel.
   - Participant changes: run `TM start` again with the new `--participants` list, then `TM brief` again.
   - A narrowed or widened focus goes into the round-1 prompt as one extra line.
   - Cancel: run `TM end "${CLAUDE_PROJECT_DIR:-.}"` (a cancelled meeting is still closed properly), tell the user nothing changed, and stop.

3. **Round 1: all participants in parallel**, in a single message.
   - **Review mode:** spawn each participant with the `Agent` tool, using its agent type. Plugin agents are namespaced, e.g. `maestro:backend`.
   - **Post-mortem mode:** resume each agent that ran, so it keeps its memory of the run:
     - get its id with `node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/maestro-resume-target.cjs" "<agent type>"`, then `SendMessage` it;
     - spawn the agent fresh when that prints nothing.
   - Prompt: [references/participant-brief.md](references/participant-brief.md), round 1.
   - Keep each agent's id for round 2.

   **Mid-meeting checkpoint (user checkpoint 2).** After round 1, read each participant's round file
   with `TM conflicts` (its `filed` list) and the files themselves, and show the user one short line
   per participant: how many proposals and what they are about. This happens in your context;
   participants never talk to the user. Ask with `AskUserQuestion`:
   - **Continue**: go to step 4.
   - **Redirect a participant** with extra guidance: `SendMessage` that participant once, with the
     guidance and the instruction to rewrite its own `round-1/<agent>.json` (the full list). It is one
     more turn, under the same meeting rules and notice, with the meeting still open. Then show the
     positions again.
   - **Stop**: run `TM end "${CLAUDE_PROJECT_DIR:-.}"`, tell the user nothing was applied, and stop. Do not tally.

4. **Find conflicts.**

   ```bash
   TM conflicts "${CLAUDE_PROJECT_DIR:-.}"
   ```

   - If a participant has no file, or its file is in `errors`, `SendMessage` it once with the error. Do not retry beyond that.
   - If `conflicts` is empty, skip to step 6.

5. **Round 2: only `rebuttalAgents`, in parallel.**
   - `SendMessage` each one with the conflicting proposals that involve it, using the round-2 prompt from the reference.
   - There is no round 3. A target still in conflict goes to the user.

6. **Tally.**

   ```bash
   TM tally "${CLAUDE_PROJECT_DIR:-.}"
   ```

   It writes `decision.md` and `decision.json` and returns rows with a tier:
   - `auto`: applied by `TM apply-placement` without asking (unless the user vetoes it).
   - `approval`: needs the user's approval.
   - `blocked`: report its `note` to the user. Examples: a plugin agent cannot be edited until forked (propose `agent.fork` first, then re-run the meeting); a rule listed in maestro.json cannot be deleted or folded into an agent (propose `rule.move`, or use the app's `/rules` view).

7. **One batch of approvals.**
   - Show the `approval` rows as a compact table: id, from, change, and a one-line rationale.
   - Ask once with `AskUserQuestion`: approve all, approve some (the user names ids), or reject all.
   - Show the `auto` rows in the same message, so the user can veto one.

8. **End the meeting before applying anything:**

   ```bash
   TM end "${CLAUDE_PROJECT_DIR:-.}"
   ```

   This way any subagent spawned while applying changes runs normally.

9. **Apply the auto tier:**

   ```bash
   TM apply-placement [--skip <vetoed ids>] "${CLAUDE_PROJECT_DIR:-.}"
   ```

   It applies skill loaded/referenced moves and handoff-template edits from `decision.json`. It reads
   `maestro.json` right before writing, changes only the instances' skill lists, keeps every other
   slice, and skips targets in conflict, vetoed ids and rows without their structured field
   (`skipped`, with reasons). Take the skipped rows to the user like approval rows.

10. **Resolve every conflict first.** A target still in conflict is the user's choice: exactly one
    of its proposals may be approved. Do this in the step 7 batch. `TM owner-runs` refuses otherwise.

11. **Apply the approved rows.** Ask the plan:

    ```bash
    TM owner-runs --approved <approved ids> "${CLAUDE_PROJECT_DIR:-.}"
    ```

    It refuses while the meeting flag is set, and returns `runs` (one per owning agent) and `main`.
    When there are runs it also marks those agents as owner runs in the session (`marked: true`).
    - **`runs`**: for each, spawn that agent with the `Agent` tool (agent type as in step 3), one
      after the other, with a prompt listing its rows (id, kind, target, change) and saying to apply
      exactly those and nothing else. These are owner runs: the agent gets its own skills and a short
      owner-run notice, but no HANDOFF routing, no payload instructions, no channel delivery, and it
      must not write channel files. Run them sequentially, since two may touch `maestro.json`.
      When the last one has returned, clear the marker:

      ```bash
      TM owner-runs-done "${CLAUDE_PROJECT_DIR:-.}"
      ```
    - **`main`**: you apply these yourself with the table below. These are workflow changes, rule
      moves (`rule.move`, `rule.to-agent`), agent forks (`agent.fork`), gates, and creating or
      deleting agents and skills.
    - When you apply by hand: read `.claude/maestro.json` right before each write, change only the
      slice concerned, keep every other key, and write it without a trailing newline.

12. **Finish.**
    - Run `/maestro-update` if any agent, skill or workflow changed.
    - Then report in a few lines: what was applied, what was rejected, and what is blocked, with the step the user must take for each blocked row.

## Owner runs: how they are dispatched

Decision: the moderator dispatches them with the plain `Agent` tool, after `end`, **without starting
a workflow** (starting one would only re-record session state and is not needed). An owner run is
then an ordinary subagent run: if the session has a recorded workflow (a post-mortem after a run),
the hooks would treat the run as a workflow step, so `TM owner-runs` writes an `owner_runs` marker
into `session.json` for the owning agents. While it is set, those agents get their skills and an
owner-run notice, and nothing else workflow-shaped: no routing, no payload instructions, no channel
delivery, no stamping of lane files, and their log entries carry `owner_run: true`, so they are never
a resume target for a later loop-back. They are not write-confined: an owner run edits the files it
owns. `TM owner-runs-done` clears the marker (so does starting a workflow) and records any lane file
the owners left behind so it is never stamped later. A guard enforces the order: `TM owner-runs`
exits with `ok:false` while the meeting flag is set.

## What does not change during the meeting

Participants still only propose. The write guard still confines them to this session's meeting
directory. The accepted Bash gap stays: Bash cannot be confined, so the notice limits participants
to read-only checks. The checkpoints run in your context only; participants never talk to the user.

## Applying each kind (by hand, the `main` rows)

| kind | how |
|---|---|
| `workflow.create` / `workflow.update` | `create-workflow` / `update-workflow` skill |
| `workflow.delete` | `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-workflow-spec.cjs" delete --name "<wf>" "${CLAUDE_PROJECT_DIR:-.}"`. Kept instances are listed as `unplacedInstances`. |
| `skill.create` | `create-skill` skill |
| `skill.edit` | edit the SKILL.md, then run `cleanup-skill` if it grew |
| `skill.delete` | delete the skill directory and remove the id from `skills_available` and from every instance's skill lists |
| `skill.placement` | move the id between `loaded_skills` and `referenced_skills` of that `workflow_instances` entry |
| `agent.create` | `create-subagent` skill |
| `agent.edit` / `agent.tools` | edit `.claude/agents/<name>.md`: the body, or the frontmatter `tools:` |
| `agent.delete` | only if no workflow places it (otherwise `update-workflow` first); delete the file and drop it from `agents_available` |
| `rule.edit` / `rule.delete` | edit or delete `.claude/rules/<id>.md` |
| `agent.fork` | `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-agent-fork.cjs" <agent> [--as <newName>] "${CLAUDE_PROJECT_DIR:-.}"`. Prints one JSON line; on `ok:false` tell the user the `reason` and that `/agents` in the Maestro desktop app can fork it instead. |
| `rule.move` | `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-rules.cjs" move <id> --to <destination> [--scope-only] "${CLAUDE_PROJECT_DIR:-.}"` (`list` shows the rules, `unassign <id>` drops an assignment). On `ok:false` tell the user the `reason` and that `/rules` in the desktop app can do it instead. A row with no `destination` cannot be applied: ask the user. |
| `rule.to-agent` | add the rule's content to the named project agent's file under `## Project rules`, then delete the rule file |
| `handoff.edit` | edit `.claude/handoffs/<sender>/<receiver>.md` |
| `report.edit` | edit `.claude/reports/<id>.md`; if `reports` has no entry for the agent, add `{ "id": "<agent>" }` |
| `gate.change` | set `gates.confidence_check`, `gates.use_code_architecture_design_check` or `use_maestro_tasks` |

The proposal file format and the kinds are in
[references/proposal-schema.md](references/proposal-schema.md).

## Notes

- Starting a workflow (`maestro-set-session-workflow.cjs`) ends a running meeting automatically.
- A meeting also ends when the session ends.
- Model and effort changes are out of scope for now. Drop such a proposal and mention it.
- The meeting directory is `.claude/maestro_sessions/<session>/meeting/`. It is ephemeral. If the user wants a record, copy `decision.md` into a task file.
