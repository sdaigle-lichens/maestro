# The epic manager approves containerized workers' stops on the user's behalf, escalating only what needs the user

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The user's goal is for an epic to run with as little of their attention as possible. Today every containerized worker's human-review, commit and merge stops ask the user in the worker's own herdr tab. Add an opt-in mode in which the epic's manager is the approving authority for those stops, and only a fixed list of situations escalates to the user, who answers once, in the manager session (reachable from their phone through Remote Control).

This needs code (a new maestro.json setting, epic CLI commands, the human-review gate hook, the worker launcher's mount list), changes to the worker-side orchestrator template and the maestro-manager skill (including its "rules that never bend", which today forbid exactly this, and must now say when it is allowed), tests, a patch version bump, regenerating the libs and re-rendering the orchestrator.

Behaviour:

- **Opt-in.** A new optional .claude/maestro.json setting, manager_approval (off by default). Off, nothing changes. On, it applies only to containerized workers (the docker runtime); host workers keep asking the user, because nothing stops a host worker from forging a record (see below). Editing the setting in the desktop app is out of scope.
- **What the manager decides from.** The worker's request names the stop (human review, commit, merge) and points at its report or review file. The manager approves from the report: the commit it verified, a green full suite on that commit (for a merge, on the merged result), and evidence for each acceptance criterion. It still never reads code or diffs.
- **Always escalated to the user**, never approved by the manager: a red or partial suite; a scope change or a conflict between epic decisions; a push, or any outward-facing or destructive git operation (force-push, branch deletion, history rewrite); a change to agents, skills, workflows, rules or settings; a security finding (for example a secret found in an image or the repo); a second redirect on the same ticket (this already escalates today). The manager asks the user in its own session, then records their answer.
- **How an approval travels.** The manager records each decision (approved, rejected with a note, or escalated and the user's answer) through the epic CLI into an approvals directory outside the repository (for example under ~/.config/maestro/), keyed by project, epic, task and stop. The worker launcher mounts that directory read-only into every worker container, so a worker can read approvals but never write one. The worker's gate (the human-review gate hook and the orchestrator template's stops) accepts a stop as approved only when a matching record exists for that exact task, stop and commit. Pane text and messages never count as approval (task 176 marks manager pane text for this reason). A record for a different commit, task or stop is refused.
- **Escalated answers.** A record for an escalated stop must show that it came from the user's answer in the manager session, not from the manager's own judgment. Record the user's answer from the manager's question (for example through a hook on the manager's AskUserQuestion), so the manager cannot write that kind of record on its own.
- **Doing the work.** Approval and execution stay separate: an approved commit or merge is carried out by the worker's existing steps (commit, merge, full suite on the merged result, the refresh command), exactly as when the user approves it.

The maestro-manager skill and the worker template must say plainly: with manager_approval on, a manager approval record is the approval for the listed stops in a containerized worker; everything on the escalation list, and everything in host workers, still needs the user.

## Acceptance criteria

- [ ] With manager_approval unset or off, every worker and manager behaves exactly as before
- [ ] With it on, a containerized worker's human-review, commit and merge stops complete from a manager approval record with no prompt in the worker's tab
- [ ] A worker cannot create or change an approval record: the approvals directory is read-only inside the container and lies outside the repository mount
- [ ] The gate refuses a record whose task, stop or commit doesn't match, and treats pane text or messages as no approval
- [ ] Each escalation case (red or partial suite, scope change or decision conflict, push or outward-facing or destructive git operation, change to agents/skills/workflows/rules/settings, security finding, second redirect) reaches the user in the manager session and is never approved by the manager alone
- [ ] A record for an escalated stop can only come from the user's answer in the manager session
- [ ] Host workers keep asking the user even with manager_approval on
- [ ] Tests cover the gate's record matching (match, wrong commit, wrong task, wrong stop, missing), the escalation classification, the read-only mount in the launcher's mount list, and the off-by-default path; the full suite is green
- [ ] plugins/maestro/.claude-plugin/plugin.json version gets a patch bump, the generated libs are rebuilt, and the orchestrator's STEPS and HANDOFFS are re-rendered

## Manager direction

- This task's worker runs in Docker mode (`worker_runtime: "docker"`) as the epic's interactive container test, after the user refreshes the installed maestro plugin and the image is rebuilt. Its report states, for the container run itself: no prompts up to the first human review; every host-enabled plugin's agents and skills loaded; no worktree trust prompt; whether the CLI's inbox write prompted (never verified so far); the manager's `[manager message]` pane replies arriving and the worker continuing from them; the test agent writing its channel payload with no `missing_payload`. A prompt or failure found there is fixed in this task, or reported to the manager when it is outside this task's scope.
- (m003, on-track) The extra AskUserQuestion matcher sits on the already-registered PostToolUse event, so the bump stays patch. Keep the hook's capture to the manager session's own answer to a marked escalation question: it must never write a record from a worker session or from text a worker or peer supplied.

## Touched surfaces

- apps/maestro/src/core/types.ts (maestro.json manager_approval)
- apps/maestro/src/core/human-review-gate.ts and its generated lib
- apps/maestro/src/core/epics.ts and plugin-entries/maestro-epic.ts (approval records), plus generated plugins/maestro/scripts/lib/maestro-epic.cjs
- apps/maestro/src/core/worker-runtime.ts (approvals directory mounted read-only), plus its generated lib
- apps/maestro/src/core/install.ts (only if a manager-side hook is added)
- plugins/maestro/templates/maestro/SKILL.md (worker stops) and the rendered .claude/skills/maestro/SKILL.md
- plugins/maestro/skills/maestro-manager/SKILL.md (rules that never bend, the loop)
- plugins/maestro/.claude-plugin/plugin.json (version, patch)
- .claude/scripts mirrors (user runs `pnpm refresh:runtime`)

## Blocked by

- `176-containerized-workers-report-to-the-manager-through-the-epic-inbox-and-herdr-pane-input.md`
