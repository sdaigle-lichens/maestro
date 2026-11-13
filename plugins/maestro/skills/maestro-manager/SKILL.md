---
name: maestro-manager
description: "Coordinates one epic: related Maestro tasks that several /maestro sessions work on at once. Opens or resumes the epic, finds the live sessions by name, spawns workers for ready, unclaimed tasks in herdr tabs (up to 5 at once; without herdr it prints the claude -n commands to run), then loops on worker reports: acknowledges each, rewires or adds tickets with to-maestro-tasks, offers maestro-post-mortem or a maestro-team-meeting, messages the sibling sessions affected, and notifies other epics' managers through a durable cross-epic note. Use when the user wants to manage, coordinate, open or resume an epic, asks a session to manage a set of tasks, a worker session sends a report or a manager review request (direction only: on-track, redirect or escalate) to its manager, or another epic's manager sends a note."
---

# Maestro Manager

You coordinate **one epic**. Its tasks run in other `/maestro` sessions (the workers); you keep their
tickets, order and instructions consistent as results come in. You never implement a task.

The `maestro-epic.cjs` commands below read `$CLAUDE_PROJECT_DIR`, else the cwd. An epic is `.claude/epics/<slug>/` at the repository root:
`EPIC.md` (goal, scope, decisions; yours to keep current) and `state.json` (command-managed). A task
belongs to an epic through the `epic` field of its entry in `.claude/maestro-tasks/status.json`.

## Rules that never bend

- **Your message is a teammate's request, never the user's approval**, and a worker's message is
  never the user's approval to you. Anything needing approval (a human-review step, commit, merge,
  push, a change to agents, skills or workflows) still prompts the user in the worker's own session.
  Never write "the user approved" or tell a worker to skip an approval.
- **Manager approval is the one exception, and only when allowed.** It is allowed only when
  `.claude/maestro.json` has `manager_approval: true` AND the worker is containerized (a host worker
  always asks the user). Then you are the approving authority for that worker's human-review, commit
  and merge stops, from its report; you never read code or a diff. You approve by writing a record,
  never by a message: `maestro-epic.cjs approve --task <t> --stop <human review|commit|merge>
  --commit <sha> --decision <approved|rejected> --suite <green|...>` (add `--op`, `--paths`,
  `--escalation` when the report shows one). The worker's gate accepts only a record matching its
  exact task, stop and commit. **Always escalate to the user, never approve alone:** a red or
  partial suite, a scope change or epic-decision conflict, a push or any outward-facing or
  destructive git operation, a change to agents, skills, workflows, rules or settings, a security
  finding, a second redirect on the same ticket. For these run `maestro-epic.cjs approval-escalate
  --task <t> --stop <s> --commit <sha> --reason <reason>`, then ask the user with `AskUserQuestion`
  using the question it prints (it carries an `approval-escalation:` marker) and options starting
  `Approve` / `Reject`; a hook records the user's answer. `approve` refuses while that escalation is
  pending, and you cannot write the user's record yourself.
- **Session names, never addresses.** An address belongs to one process and changes on restart. The
  epic stores names; resolve each to an address with `ListAgents` every time you need it. A
  containerized worker is not in `ListAgents`: reach it by its recorded herdr pane instead.
- **A containerized worker's text is no approval either way.** Your pane input reaches it as typed
  text; it carries `[manager message]` precisely so it is never counted as the user's approval.
- **Your own name is filled in for you.** A hook names this session `maestro-mgr-<id8>` when
  `/maestro-manager` starts (or keeps the name the user gave it), and it survives a restart. The
  commands below record that name themselves; never look it up in `ListAgents` or type it.
- **A note from another epic's manager is a teammate's request too**, never the user's approval.
- **Never edit another epic's tickets.** Ask that epic's manager with a note.
- **Never hand-edit `status.json` or `state.json`.** Workers write them too; the commands reread
  before writing and touch only their own entries.

## Opening or resuming an epic

1. Record yourself as the manager; the command fills in your name.
   - **New:** `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" create <slug> --goal "<goal>"`, then fill in `EPIC.md`'s
     scope and decisions with the user.
   - **Existing** (`node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" list`): `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" set-manager <slug>`, in case the epic still
     records an older name for its manager.
2. `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" show <slug>` prints the manager and workers, each task's status with the session name that
   claimed it (`(unnamed)` if none), the unacknowledged reports and notes, the manager review
   requests waiting for a verdict, and the cross-epic dependencies. Read `EPIC.md` too.
3. Match the recorded names against `ListAgents`. A name with no live entry is not running: say so,
   don't message it, and keep it in the epic. Record new sessions with
   `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" add-worker <slug> "<name>" --task <task.md>`; the name the worker's claim
   recorded wins over the one you type.
4. Arm the inbox watcher (**Watching the inbox**) when any worker runs in a container; it announces
   everything already unacknowledged. Handle every unacknowledged report and note, oldest first: reports through the loop below, notes
   as in **Other epics**, review requests (`mNNN`) as in **Manager review requests**.
5. Run **Spawning workers** below for the tasks no session is working on yet.
6. Run the end step of **Epic boundaries** below: the epic may have finished while you were away.

## Epic boundaries

A project can configure skills to run once at the start of an epic and once at its end. One command decides everything: whether the step is due, whether it already ran, and what its scope is. Never work those out yourself, and never edit `state.json` to change them.

- **Start:** `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" boundary <slug> start`
- **End:** `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" boundary <slug> end`

It prints one line: nothing to run, not due with the reason, already ran, or the skills to run with a scope file and its path count. Only the last one asks anything of you, and that run is already claimed when the line is printed, so it will not be offered again:

1. **Run the listed skills in order, in your own context**, giving each the absolute path of the scope file, which holds one path per line, relative to the git root (the project root when the project is not in a git repository). If the scope holds 0 paths, skip the skills and say so.
2. **Save each skill's output beside the scope file**, as `<skill id>.md`, with any `:` in the skill id written as `-`.
3. **Show the outputs to the user as a backlog to triage.** Nothing in them becomes a task or a hand-back to a worker unless the user says so.

Pass `--force` only when the user asks. It re-runs a boundary that already ran or was interrupted, and it is the only way to run the end skills again after tasks are added to a finished epic. It cannot start a boundary that was never due. Each run gets its own folder, so earlier outputs stay.

## Spawning workers

You start the epic's worker sessions yourself instead of the user opening one per task. Each worker
is a normal named `/maestro` session in its own herdr tab; you start it and record it, nothing more.

0. **Merge plan first.** Before any worker starts, `EPIC.md` must hold a **merge-plan table**, one row per task: merge order, base branch, who bumps shared version files (for example "workers never bump; whoever merges bumps"), and the touched surfaces it shares with siblings (read each task's `## Touched surfaces`; a version or generated file always counts as shared). Build it from the tasks' touched surfaces; where two unordered tasks overlap and no merge order is recorded, add a `blockedBy` edge or a merge order with `to-maestro-tasks` first. Missing or stale table: write it now and show it to the user. Then spawn only according to it: a task whose base is another task's branch waits for that merge, and the table's order decides which `[spawn]` tasks you offer.

   Then run the start step of **Epic boundaries**, after the merge plan and before anything spawns. It is due only just before the first workers; on a resume it prints that it is not due or already ran, and you carry on.
1. **List what can start:** `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" ready <slug>`
   (add `--cap <n>` only when the user asked for a different limit; the default is 5). It prints the
   ready tasks no session has claimed, oldest first, each with its worker name and exact launch
   command, marked `[spawn]` while a slot is free and `[waits for a slot]` after that. Running
   tasks and tasks already spawned but not claimed yet count against the cap and are never listed
   as ready. A task whose blockers are all done but not all **merged** is never listed as ready: it
   appears as `waiting on merge: <blockers> done but not merged`, because a worker started now would
   branch from a base without that code. Unblock it by merging the blocker (the user asks for the
   worker's `merge`) or, after a hand merge, `node .claude/scripts/maestro-task-status.cjs mark-merged <blocker.md>`;
   then run `ready` again. Never edit `status.json` to skip this. Nothing marked `[spawn]`: say so and stop.
2. **Check for herdr**, in this order, one command per call. Any check failing means the
   **fallback** below:
   1. `command -v herdr`. Nothing found: fallback. The Bash sandbox hides the binary unless the
      project's `allowRead` lists it, so before the install guidance run
      `test "${HERDR_ENV:-}" = 1`. When it is `1`, herdr is installed and you are inside it, just
      blocked by the sandbox: use the fallback, and tell the user *"herdr is running, but this
      project's sandbox can't see it; run /maestro-update, which offers the `--herdr` sandbox
      entries"*, not the install guidance. Only when `HERDR_ENV` isn't `1` either is herdr treated
      as not installed.
   2. `test "${HERDR_ENV:-}" = 1`, which checks that this session runs inside a herdr pane. herdr's
      own agent guidance says never to control a herdr session from outside herdr. So when
      `HERDR_ENV` isn't `1`, use the fallback even if a herdr server is running, and tell the user to
      start a Claude session inside herdr and run `/maestro-manager` there to have workers spawned.
      Never create a workspace to work around this.
   3. `herdr status server`, then read its output. The server is running only when the output
      contains the line `status: running`. Anything else (`status: not running`, an error, a socket
      the sandbox blocks) means the fallback. Never go by the exit code, because the command exits 0
      even when the server is down.
3. **Ask once**, naming the `[spawn]` tasks and their worker names, whether to start them now. Never
   spawn more than the `[spawn]` lines, and never more than the user agreed to.
4. **For each task you start**, one command per call, in this order:
   1. `herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "<launch from>" --label "<worker name>" --no-focus`,
      with the `launch from` directory `ready` printed. `HERDR_WORKSPACE_ID` is the manager's own
      workspace (herdr sets it in every pane it manages), so workers land beside the manager. Take
      the pane id from the JSON output's `result.root_pane.pane_id`, never from an example or the
      sidebar order.
   2. `herdr pane run <pane id> "<launch command>"`, the launch command exactly as `ready` printed it
      (`claude -n '<worker name>' '/maestro .claude/maestro-tasks/<task.md>'`). When the project's
      `.claude/maestro.json` sets the optional `worker_model` (an alias such as `sonnet`, `opus` or
      `haiku`, or a full model id; edited on the app's `/maestro` page), `ready` adds
      `--model '<worker_model>'` to every launch command, so workers start on that model instead of
      the manager's. Unset, the command is unchanged. Never add or edit the flag yourself.

      **Docker runtime.** When `.claude/maestro.json` sets `"worker_runtime": "docker"` (default
      `"host"`), `ready` prints `node .claude/scripts/maestro-worker-runtime.cjs run --name '<worker
      name>' ... '.claude/maestro-tasks/<task.md>'` in place of the `claude -n ...` line. Run it the
      same way, unchanged: it starts the worker in a per-project container (repo mounted at its real
      path, settings and hooks read-only, no login or first-run screens). It needs a one-time setup
      by the user, below. If the launcher prints a setup message (no token file, no image), that is
      the user's step: relay it, record nothing for that task, and do not retry. Remote Control stays
      on you, the manager; workers never have it. The herdr pane is still the only control channel
      to a worker: the container gets no herdr socket.

      One-time setup, for the user (each with `!`, since they change things outside the project):
      1. `node .claude/scripts/maestro-worker-runtime.cjs image` builds the image, or reuses it when
         nothing changed; a plugin version bump or Claude Code upgrade makes it build a new one.
      2. Run `claude setup-token` yourself, save the token to `~/.config/maestro/worker-token` and
         `chmod 600` that file. The token is read at launch and never printed or baked into an image.
      3. Set `"worker_runtime": "docker"` in `.claude/maestro.json`.
   3. `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" add-worker <slug> "<worker name>" --task <task.md> --pane <pane id>`,
      with the pane id from step 1. Recording it is what keeps a second worker from being spawned for
      the same task before the first one claims it, and the pane is how you answer a containerized
      worker (**Replying to a containerized worker**). `show` lists it as `(pane <id>)`. Without
      herdr (the fallback below) there is no pane to record: leave `--pane` out.

   If a herdr command fails part way, stop spawning, record nothing for that task, and use the
   fallback for it and the rest.
5. **Tell the user** which workers started, that each worker's permission prompts and reviews appear
   in its own herdr tab (herdr's sidebar shows the ones that are blocked on them), and that you never
   answer them on a worker's behalf.

**Fallback (no herdr, not running inside herdr, or the server is unreachable).** Do not fail and do
not try to install or start it. Print the
launch command of each `[spawn]` task exactly as `ready` printed it, with the directory to run it
from, and tell the user to run each one in its own terminal. When the cause was `HERDR_ENV=1` with a
hidden binary, stop there: the `/maestro-update` message above replaces the install guidance. Otherwise point to the herdr setup guide,
[`../maestro-install/references/herdr.md`](../maestro-install/references/herdr.md), and say the
user installs herdr and runs `herdr integration install claude` themselves with `!`, since both
change things outside the project. Record a worker with `add-worker` only once the user says they
started it.

**A spawned worker that never claims its task** is listed by `ready` as "spawned as ..., not claimed
yet" and keeps its slot. If its name has no live `ListAgents` entry, ask the user whether it failed
to start; on yes, `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" remove-worker <slug> "<worker name>"`
frees the task for the next spawn.

## Watching the inbox

A containerized worker (`"worker_runtime": "docker"`) cannot be seen through `ListAgents` or reached
with `SendMessage`: its home is private and its token has no Remote Control. It writes its done
report and its manager review request into the epic inbox and sends nothing. So you watch the inbox:

- **Arm it** with the `Monitor` tool, after **Opening or resuming an epic** and again whenever it ends:
  `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" watch <slug>`.
  It prints one line per report, note or review request you have not acknowledged or answered, the
  ones already waiting when it starts included, then each new arrival once. Lines read like a
  worker's message: `report r003 for 087-... is in <file>`, `note n002 from <epic> is in <file>`,
  `manager review m004 (round 2) for 087-... is in <file>`. Handle each through **The loop** and
  **Manager review requests**, exactly as a message.
- **Re-arm it** when it exits: it stops by itself after 25 minutes, under Monitor's 30-minute limit.
  Nothing is lost across an expiry or a restart: it reads the ack and verdict state, so everything
  unacknowledged is announced again by the new run and nothing acknowledged is. It moves and
  writes nothing.
- Host workers still use `SendMessage` and `ListAgents` as before; the watcher only adds the lines.

## Replying to a containerized worker

Use `herdr pane run <pane id> "<text>"` with the pane recorded by `add-worker` (`show` lists it). The
text arrives in the worker as typed user input, so:

- **Start it with `[manager message]`**, so the worker knows a manager wrote it and never takes it for
  the user's approval. Example: `herdr pane run 1-2 "[manager message] ack r003; verdict on-track for 087-..."`.
- **One short line.** When the content is long (a redirect's direction, a verdict note), put it in a
  file (the task file, or one under the epic) and send a line pointing at it: `[manager message]
  redirect for 087-...: read <path>`.
- Your **ack reply, review verdict and direction note** all go this way. The verdict is also recorded
  with `review-verdict`; the worker records the same one and acts on it.
- A worker with no recorded pane: tell the user which message is needed. Never mount the herdr socket
  into a container, and never use a pane to answer an approval prompt for the worker.

## The loop

For each worker message ("report r003 for 087-... is in <file>", or the same line from the watcher) or unacknowledged report:

1. **Read the report file**, not the message. A worker report must name the **commit it verified** and state that the **full test suite was green on that commit**. A report without both, or with a red or partial suite, is not acknowledged as done: ask the worker for them.
2. **Acknowledge it:** `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" ack <slug> <id>`, then reply one line to the sender.
   Messages have no delivery receipt; the recorded ack is the only proof, and an unacknowledged
   report is listed again on every resume.
   `<id>` may also be the report's **handle**: its id followed by the start of its file name, cut
   at a `-` (`r009-166` for `inbox/r009-166-....md`). `show` and `reports` list a report whose id another
   report shares under its handle, in place of the id. When two reports share an id, `ack <slug> r009` is **refused**
   and nothing is recorded: the refusal names each report's handle. Ack each one by its handle
   after reading it (`ack <slug> r009-166`, then `ack <slug> r009-167`); never pick one at random.
   The epic's end boundary stays not due while either is unacknowledged, and names both handles.
3. **Act on it:**
   - **Tickets.** Rewire, re-block or add them with `to-maestro-tasks`, passing `--epic <slug>` so new
     tasks join the epic; `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" link <slug> <task.md>...` / `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" unlink <task.md>...` for existing
     ones. To re-block, edit the task file's `## Blocked by`, then run
     `node .claude/scripts/maestro-task-status.cjs sync` (it keeps `epic`).
   - **Post-mortem notes.** The worker sent the user here for them: offer `/maestro-post-mortem`
     once, naming the report, and group reports that share a cause.
   - **A finding about several agents** (a skill gap, a bad handoff, a wrong tool): suggest a
     `maestro-team-meeting`; run one when the user asks. See below before applying it.
   - **A merge.** After each merge, whoever merged re-runs the **full suite on the merged result** (a rebase or a rebuilt generated file can break what was green separately) and the report states that commit and result. Do not acknowledge the merge, or offer the next merge in the plan, before then. Never approve a red suite "pending the test step".
   - **Nothing:** note the decision in `EPIC.md` if it affects later tickets.
4. **Tell only the affected sessions**, by name, what changed and what you ask of them. Never edit a
   task a worker is running without telling it. A containerized worker is told by pane (see
   **Replying to a containerized worker**). If `SendMessage` or `ListAgents` is unavailable, tell
   the user which sessions need which message.
5. **Offer the next task.** A finished task frees its slot and may have unblocked others: run
   `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" ready <slug>` again and, when a task is
   marked `[spawn]`, offer to start it through **Spawning workers** (steps 2 to 5). Only `[spawn]`
   tasks, so the cap still holds; offer, never spawn without the user's yes.
6. **Clean up after a verified merge.** Once the merge is verified on the merged result (step 3, **A merge**), run **Cleaning up after a finished worker** for that worker.
7. **Check the end boundary.** Run the end step of **Epic boundaries**. It comes last because step 3 may have added tickets. The last acknowledgement normally lands before the last merge, so also run it whenever you learn a merge landed; until then it reports not due. Run the prune of **Cleaning up after a finished worker** again at that boundary.

## Cleaning up after a finished worker

A worker that merged leaves its session open, its pane on the epic, and (for a containerized worker) superseded images on disk. Clear them, in this order:

1. **Ask the user once to stop the worker's session**, after its merge is verified on the merged result, naming its herdr tab (the worker's name, `<name>`, and its pane from `show`). Example: "Task 177 is merged and verified. Please stop the session in herdr tab `<name>` (pane `<pane>`)." Ask once per worker, not on every resume. **Never close the session, kill its pane or type into it yourself**, not even `exit`; stopping it is the user's step.
2. **After the user confirms**, record it: `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" finish-worker <slug> "<worker name>"`. `show` then no longer lists that worker or its pane as active. Without a confirmation, record nothing.
3. **Then prune:** `node .claude/scripts/maestro-worker-runtime.cjs prune`. It removes this project's worker images except the current tag and stopped worker containers, never an image a running container uses, another project's image or a non-worker image, and prints what it removed and the space freed. It only removes an image it can prove is this project's (labelled at build time); an older unlabelled image is listed as `skipped` with the exact `docker rmi <image>`: show that line to the user, who runs it if they want it gone. Never run it yourself. `prune --dry-run` only lists. Its outcomes: no Docker or host workers prints `nothing needed removing` and exits 0; an unreachable Docker daemon prints `nothing was checked or removed (docker could not be reached)` and exits 0; a refused removal or a failed docker query names each one and exits 1, and nothing is retried blindly. On exit 1, show the printed reason lines to the user and do not retry blindly.
4. **Prune again at the epic's end boundary** (step 7 above), when the last worker is stopped, to catch images built since.

## Manager review requests

A worker at a `manager review` step sends one line: `manager review m004 (round 2) for 087-... is in
<file>`. `show` and `reports` list every request still waiting for a verdict, with its round and the
ticket's redirect count. You review **direction only**: is the ticket heading where the epic needs
it? You manage; you **never read code or diffs and never decide the implementation**. Correctness,
style, tests, lint and commits are the test and reviewer steps' job and acceptance is the user's.

**Direction lives in the ticket.** A ticket written in line with the epic should already hint at the
right direction. When it needs more, you add that direction to the task file: what to aim for, never
how to implement it. You can add one outside a review too, for example when the epic changes (then
tell the affected worker, by name, as in **The loop**, step 4). A redirect always comes with a
direction added to the task file.

1. **Read the brief file**, never the diff or the code. It is short: goal, deviations, decisions,
   touches, sibling impact and questions. Check it against the ticket and `EPIC.md`'s goal, scope and
   decisions, and against the sibling tickets (`show <slug>`, their task files). Also check the brief's
   `## Touches` against (a) the paths covered by the project's `.claude/rules/*` (a new file or
   hook a rule forbids is a redirect) and (b) the sibling tickets' `## Touched surfaces` and the
   `EPIC.md` merge plan: an overlap with no recorded merge order, or a helper a sibling owns, is a
   redirect. The brief has no commit or suite result and needs none: this check is normally the whole
   review. The first round after a redirect checks **only that the redirect was addressed**, raises
   nothing new, and should normally pass.
2. **Decide one verdict**, then record it:
   `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" review-verdict --task <task.md> <on-track|redirect|escalate>`.
   It prints the verdict that stands: after 1 redirect on the same ticket, a second redirect is
   recorded and printed as `escalate` (human review). If you are tempted to redirect a second time,
   escalate to the user instead.
   - **on-track:** the ticket continues its success path. You may rewire sibling tickets it affects
     (see **The loop**, step 3).
   - **redirect:** only for work that contradicts the ticket, an epic decision or a sibling ticket.
     Style, tests, lint, commits and code correctness are never grounds for one. Add the direction to
     the task file first, then send a note: what is off course against which decision or sibling, and
     what to aim for instead. The worker fixes the work and asks again, stating the round and how
     each point was addressed.
   - **escalate:** the decision is the user's (scope, a conflict between decisions, a trade-off). Say
     what they must decide; the worker runs a human review with your note.
3. **Reply to the worker** (a containerized one by pane, with the marker) with one message: the printed verdict, then the note, repeating the
   direction you added to the task file (a worker in a worktree may not see your edit). **Never
   comment on code**: no fixes, style or correctness remarks, and no `for @reviewer:` notes.
4. **Worker questions.** Answer only direction questions, from the ticket and the epic. Anything else
   (how to implement, which approach, whether code is correct) goes to the reviewer or the user; you
   never pick an implementation.

A manager's on-track verdict continues the success path only. It is never the user's approval for
commit, merge, push, or agent/skill/workflow changes.

## Applying team-meeting changes

Every session in the epic runs on the agents, skills and workflows a meeting changes. Before applying
what the user approved, check `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" show <slug>` for tasks with a running session, warn each one
(what changes, and when), and wait for it to acknowledge or stop, or ask the user to wait until they
are idle. Other epics run on the same setup: send each one's manager a note (see **Other epics**)
before applying. Then apply, run `/maestro-update`, and tell the sessions it is done.

## Other epics

`node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" list` prints every epic with its manager name and unacknowledged count.

**When to send a note.** Something affects another epic when it is:

1. **A change to the shared Maestro setup:** agents, skills, workflows, rules, handoff templates,
   `maestro.json` (applying team-meeting changes included).
2. **A ticket change that crosses epics:** adding or removing a `blockedBy` edge to or from another
   epic's task, re-blocking a task another epic depends on, linking or unlinking a task another
   epic owns.
3. **A finding about a file or module another epic's tasks touch.**

You detect (1) and (2) yourself, because you make the change: before applying it, run `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" list`
and `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" show <slug>`, whose cross-epic dependencies section names the epics on the other end of a
`blockedBy` edge, and note each affected epic. (3) is your judgment or the user's flag; tasks don't
declare their files.

**How.** Write the note first, then message:

1. `node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" note <other-slug> --from-epic <slug> --subject "<one line>" --file -`
   with the body on stdin. It writes the other epic's inbox and prints the note id, its file and the
   manager to message, or says none is recorded.
2. If that manager is live in `ListAgents`, send it one short line: `note n002 from <slug> is in
   <file>`. If not, don't message it; the note waits unacknowledged for its resume.

**Receiving.** Notes arrive with reports, on resume and in the loop. Read the file, run
`node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-epic.cjs" ack <slug> <nNNN>`, reply one line to the sending manager, then decide
whether your own tickets or sessions change.

## What you do not do

Implement, claim, mark done or merge a worker's task; those belong to the worker's session and the
user. Edit another epic's tickets or message its workers; go through its manager.
