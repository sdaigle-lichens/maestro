---
name: maestro-team-meeting
description: "Holds a team meeting of the project's Maestro subagents: each reviews the setup from its own role and proposes improvements to workflows, skills, agents, rules, handoffs, reports and start/end skills, optionally focused on the context and flow of reports and handoffs. You moderate; nothing changes until the user approves one batch. Review mode covers the whole setup; post-mortem mode resumes the agents that just ran a workflow. Use when the user asks for a team meeting, an agent review of the Maestro setup, or a retro after a run."
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

Every `maestro-team-meeting.cjs` command prints one line of JSON.

## Workflow

1. **Pick the mode.**
   - Use `post-mortem` when a workflow ran in this session and the user wants to learn from it.
   - Otherwise use `review`.
   - Pass `--participants a,b` only if the user named agents. The default for review is every agent placed on a workflow; for post-mortem it is every agent that completed a run this session.

2. **Start, then write the brief.**

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-team-meeting.cjs" start --mode <review|post-mortem> .
   node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-team-meeting.cjs" brief .
   ```

   - If `start` returns `ok:false`, stop. Tell the user its `reason`. A stale runtime needs `/maestro-update` first: the project's hook copies must know about meetings.
   - Keep `meeting.dir` and the `brief` and `slices` paths. Do not read the brief into your own context; the participants read it.

   **Agenda confirmation (user checkpoint 1).** Before round 1, show the user, in your own context:
   - the participants (`meeting.participants`);
   - a short summary of the evidence (the `evidence` counts from `brief`, plus what the digest covers);
   - the focus areas (default: skills and placement, handoffs, agents and tools, rules, start/end skills, workflows, context and flow of reports and handoffs).

   Ask with `AskUserQuestion`: go ahead, add or drop participants, narrow or widen the focus, or cancel.
   - Participant changes: run `maestro-team-meeting.cjs start` again with the new `--participants` list, then `maestro-team-meeting.cjs brief` again.
   - A narrowed or widened focus goes into the round-1 prompt as one extra line. If the focus includes context and flow, also add the optional line from the reference (see "Focus: context and flow").
   - Cancel: run `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-team-meeting.cjs" end .` (a cancelled meeting is still closed properly), tell the user nothing changed, and stop.

3. **Round 1: all participants in parallel**, in a single message.
   - **Review mode:** spawn each participant with the `Agent` tool, using its agent type. Plugin agents are namespaced, e.g. `maestro:backend`.
   - **Post-mortem mode:** resume each agent that ran, so it keeps its memory of the run:
     - get its id with `node .claude/scripts/maestro-resume-target.cjs "<agent type>"`, then `SendMessage` it;
     - spawn the agent fresh when that prints nothing.
   - Prompt: [references/participant-brief.md](references/participant-brief.md), round 1.
   - Keep each agent's id for round 2.

   **Mid-meeting checkpoint (user checkpoint 2).** After round 1, read each participant's round file
   with `maestro-team-meeting.cjs conflicts` (its `filed` list) and the files themselves, and show the user one short line
   per participant: how many proposals and what they are about. This happens in your context;
   participants never talk to the user. Ask with `AskUserQuestion`:
   - **Continue**: go to step 4.
   - **Redirect a participant** with extra guidance: `SendMessage` that participant once, with the
     guidance and the instruction to rewrite its own `round-1/<agent>.json` (the full list). It is one
     more turn, under the same meeting rules and notice, with the meeting still open. Then show the
     positions again.
   - **Stop**: run `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-team-meeting.cjs" end .`, tell the user nothing was applied, and stop. Do not tally.

4. **Find conflicts.**

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-team-meeting.cjs" conflicts .
   ```

   - If a participant has no file, or its file is in `errors`, `SendMessage` it once with the error. Do not retry beyond that.
   - If `conflicts` is empty, skip to step 6.

5. **Round 2: only `rebuttalAgents`, in parallel.**
   - `SendMessage` each one with the conflicting proposals that involve it, using the round-2 prompt from the reference.
   - There is no round 3. A target still in conflict goes to the user.

6. **Tally.**

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-team-meeting.cjs" tally .
   ```

   It writes `decision.md` and `decision.json` and returns rows with a tier:
   - `auto`: applied by `maestro-team-meeting.cjs apply-placement` without asking (unless the user vetoes it).
   - `approval`: needs the user's approval.
   - `blocked`: report its `note` to the user. Examples: a plugin agent cannot be edited until forked (propose `agent.fork` first, then re-run the meeting); a rule listed in maestro.json cannot be deleted or folded into an agent (propose `rule.move`, or use the app's `/rules` view).

7. **One batch of approvals.**
   - Show the `approval` rows as a compact table: id, from, change, and a one-line rationale.
   - Ask once with `AskUserQuestion`: approve all, approve some (the user names ids), or reject all.
   - Show the `auto` rows in the same message, so the user can veto one.

8. **End the meeting before applying anything:**

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-team-meeting.cjs" end .
   ```

   This way any subagent spawned while applying changes runs normally.

9. **Apply the auto tier:**

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-team-meeting.cjs" apply-placement [--skip <vetoed ids>] .
   ```

   It applies skill loaded/referenced moves and handoff-template edits from `decision.json`. It reads
   `maestro.json` right before writing, changes only the instances' skill lists, keeps every other
   slice, and skips targets in conflict, vetoed ids and rows without their structured field
   (`skipped`, with reasons). Take the skipped rows to the user like approval rows.

10. **Resolve every conflict first.** A target still in conflict is the user's choice: exactly one
    of its proposals may be approved, settled in the step 7 batch. `owner-runs` refuses otherwise.

11. **Apply the approved rows.** Ask the plan:

    ```bash
    node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-team-meeting.cjs" owner-runs --approved <approved ids> .
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
      node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-team-meeting.cjs" owner-runs-done .
      ```
    - **`main`**: you apply these yourself, per [references/apply-kinds.md](references/apply-kinds.md). These are workflow changes, rule
      moves (`rule.move`, `rule.to-agent`), agent forks (`agent.fork`), start/end skill lists, and creating or
      deleting agents and skills.
    - When you apply by hand: read `.claude/maestro.json` right before each write, change only the
      slice concerned, keep every other key, and write it without a trailing newline.

12. **Finish.**
    - Run `/maestro-update` if any agent, skill or workflow changed.
    - Then report in a few lines: what was applied, what was rejected, and what is blocked, with the step the user must take for each blocked row.

## Focus: context and flow

A focus lens inside `review` and `post-mortem`, not a mode. Participants look at:

- report length and shape: what a report carries that no receiver uses;
- handoff payload size and what it carries: summaries vs. full content;
- redundant or mergeable handoff steps;
- which context loads on each run (skills, rules, channel payloads) and whether it is needed.

It adds no new proposal kind, tier or mode. Proposals use the existing kinds:

| finding | kind |
|---|---|
| oversized or redundant payload, mergeable step | `handoff.edit` |
| report too long or badly shaped | `report.edit` |
| skill loaded on a run that does not need it | `skill.placement` |
| steps to merge, drop or reorder | `workflow.update` |
| rule loaded where it is not needed | `rule.move` |
| start/end skill list too heavy | `gate.change` |

## Owner runs

Dispatch them with the plain `Agent` tool after `end`, **without starting a workflow**. If the
session has a recorded workflow (a post-mortem), the hooks would treat an owner run as a workflow
step, so `owner-runs` writes an `owner_runs` marker into `session.json`: marked agents get their
skills and an owner-run notice, with no routing, payload, channel delivery or lane stamping, and
their log entries carry `owner_run: true` (never a resume target). They are not write-confined.
`owner-runs-done` clears the marker (so does starting a workflow) and records leftover lane files so
they are never stamped. `owner-runs` exits `ok:false` while the meeting flag is set.

## Applying the `main` rows by hand

For how to apply each kind (`workflow.*`, `skill.*`, `agent.*`, `rule.*`, `handoff.edit`,
`report.edit`, `gate.change`), see [references/apply-kinds.md](references/apply-kinds.md). The
proposal file format and the kinds are in [references/proposal-schema.md](references/proposal-schema.md).

## Notes

- Starting a workflow (`maestro-set-session-workflow.cjs`) ends a running meeting automatically.
- A meeting also ends when the session ends.
- Model and effort changes are out of scope for now. Drop such a proposal and mention it.
- The meeting directory is `.claude/maestro_sessions/<session>/meeting/`. It is ephemeral. If the user wants a record, copy `decision.md` into a task file.
