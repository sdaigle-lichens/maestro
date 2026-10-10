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

3. **Round 1: all participants in parallel**, in a single message.
   - **Review mode:** spawn each participant with the `Agent` tool, using its agent type. Plugin agents are namespaced, e.g. `maestro:backend`.
   - **Post-mortem mode:** resume each agent that ran, so it keeps its memory of the run:
     - get its id with `node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/maestro-resume-target.cjs" "<agent type>"`, then `SendMessage` it;
     - spawn the agent fresh when that prints nothing.
   - Prompt: [references/participant-brief.md](references/participant-brief.md), round 1.
   - Keep each agent's id for round 2.

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

   It writes `decision.md` and returns rows with a tier:
   - `auto`: apply it without asking.
   - `approval`: needs the user's approval.
   - `blocked`: report its `note` to the user. Examples: fork a plugin agent in the app's `/agents` view first; move a rule listed in maestro.json in the app's `/rules` view.

7. **One batch of approvals.**
   - Show the `approval` rows as a compact table: id, from, change, and a one-line rationale.
   - Ask once with `AskUserQuestion`: approve all, approve some (the user names ids), or reject all.
   - Show the `auto` rows in the same message, so the user can veto one.

8. **End the meeting before applying anything:**

   ```bash
   TM end "${CLAUDE_PROJECT_DIR:-.}"
   ```

   This way any subagent spawned while applying changes runs normally.

9. **Apply the auto rows and the approved rows** using the table below.
   - Read `.claude/maestro.json` right before each write.
   - Change only the slice concerned and keep every other key.
   - Write it back without a trailing newline.

10. **Finish.**
    - Run `/maestro-update` if any agent, skill or workflow changed.
    - Then report in a few lines: what was applied, what was rejected, and what is blocked, with the step the user must take for each blocked row.

## Applying each kind

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
