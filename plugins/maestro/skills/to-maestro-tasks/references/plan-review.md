# Plan review in to-maestro-tasks

An independent cold read of a plan by the `plan-reviewer` agent, with the user as the third reviewer. The reviewer critiques the plan against the repository; the planner (this session) answers every finding; the user settles what the two do not agree on. Review covers plans only: once task files are written, they are out of scope here.

## When review runs

| Plan | Gate 1: the epic list, before the user approves it | Gate 2: the expanded tasks, before any task is written |
| --- | --- | --- |
| Several epics | automatic | automatic, over every `now` epic at once |
| One large epic (its expansion holds more than three tasks) | not run | opt-in: offer it once, as one line in the Step 3 quiz |
| A deferred epic expanded in a later session | already had Gate 1 when it was planned | opt-in: offer it once, as one line in the Step 3 quiz |
| An ordinary run (no epic) | never | never offered |

An ordinary run gets no review, no review prompt and no plan-view offer. The user can still ask for a review on a plan of any size (see "Additional reviews").

## Equal footing

- **Always a fresh agent, never a fork.** Spawn it with the Agent tool, `subagent_type` `maestro:plan-reviewer` (or `plan-reviewer` when the project has its own copy). A fork would inherit the planner's reasoning.
- **Same inputs as the planner, nothing more.** Its first message holds, each under its own heading:
  1. the user's original request, **verbatim** (keep it from the start of the run for this);
  2. the source spec: the files' paths, or the text itself when it was pasted in chat. A document the user wrote or approved counts as spec; your own notes and the start skills' summaries do not;
  3. the user's answers to the planner's questions, each as `Q:` (your question, verbatim) then `A:` (the answer, verbatim).
- **Never** the planner's reasoning, a paraphrase of any input, or the draft.

## The blind sketch

The first message asks only for the reviewer's own outline and main risks. Show the sketch to the user verbatim, labelled as the reviewer's, before the reviewer sees the draft. Keep the reviewer's agent ID or name: every later turn goes to the same agent.

## Gate 1 and Gate 2

**Gate 1.** Once the epic list and its coverage and shared-foundations checks are ready (`epics.md`), and before asking the user to approve the list: spawn the reviewer and get its sketch, then send the epic list in a follow-up message. Run the round (below). The user then approves the list, and the epics are created right after.

**Gate 2.** Once every `now` epic is expanded into drafts (SKILL.md Steps 2 and 3, writes held, see `epics.md`): **resume the same reviewer** (SendMessage to its ID or name) with all the drafts at once. Each draft carries its title, `whatToBuild`, criteria, touched surfaces and blocked-by, with blockers in other epics named by title. Run the round. A large single epic or a deferred epic, when the user opts in, has no Gate 1 reviewer to resume: spawn one, get its sketch, then send the drafts.

## A round

1. **Findings.** The reviewer returns numbered findings (`F1`, `F2`, ...). IDs are unique for the whole planning run: tell the reviewer which number to start from in every message after the first round (e.g. "number new findings from F7").
2. **The planner answers every finding**, with a reason: `agree` (and the exact change to the plan), `disagree` (why), or `partly` (what you take and what you do not).
3. **Show the user** one block per finding: the reviewer's text **verbatim**, then the planner's position and reason, then a status: `agreed` (you accept it, or the reviewer withdrew it) or `disputed`.
4. **Ask the user only about disputes**, naming each by ID, and keep a dispute as one question with its options. Agreed findings stay listed by ID with a one-line summary each, and the user can reopen any of them by ID: it then becomes disputed.
5. **Relay the user's words verbatim** to both sides: quote the user's comments exactly to the reviewer, and act on them yourself as written. Never paraphrase or summarise them.
6. **One automatic response.** Send the reviewer your answers and the user's comments once, verbatim. Show its reply verbatim with the updated statuses. After that, **the user decides** whether another round runs. Never start one yourself.
7. **Close the gate** when the user says so. Apply the agreed changes and the user's decisions to the plan, then ask for the gate's approval (Gate 1: the epic list; Gate 2: the drafts).

At each gate, offer the plan view once, in one line (`references/plan-view.md`, review mode). Do not offer it again at that gate unless the user asks.

## Additional reviews

At any time before tasks are written, on a plan of any size, the user can ask for:

- **Continue**: the same reviewer gets the current draft and a short list of what changed since its last turn. Its earlier findings keep their IDs.
- **Fresh**: a new `plan-reviewer` gets the original inputs, gives its blind sketch, then gets the current draft. It never sees earlier findings or positions. Its findings continue the run's ID numbering.

Neither is capped. Run a round after each, as above.

## When follow-up messages to the reviewer are unavailable

If SendMessage is not available in this session, or the reviewer can no longer be reached (a failed send, the agent gone), tell the user in one line and replace each follow-up with a fresh `plan-reviewer` that receives the record verbatim:

- **Findings turn**: the original inputs, the reviewer's own blind sketch (labelled as its earlier answer), and the draft.
- **Response turn**: the above plus its findings, your answers and the user's comments.
- **Gate 2 and Continue**: the original inputs, the earlier sketch, every earlier finding with both positions and its status, and the current drafts.

Never merge the sketch and the draft into one first message: the blind sketch always comes from a message without the draft. A Fresh review is unchanged.
