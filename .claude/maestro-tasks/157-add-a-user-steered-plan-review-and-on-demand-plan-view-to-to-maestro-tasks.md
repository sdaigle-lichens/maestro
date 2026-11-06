# Add a user-steered plan review and on-demand plan view to to-maestro-tasks

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Large plans made with to-maestro-tasks get an independent cold-read review with the user as third reviewer, and the user can ask for a visual explanation of a plan or a single task. This changes published plugin files: one new agent definition, two new skill reference files, edits to the to-maestro-tasks skill and its epics reference, and a minor plugin version bump. Add any code, hook or test change the checks below show is needed, and refresh the repo's tracked runtime copies if the change requires it.

The reviewer is a read-only plan critic on Opus, not a code architect and not a designer. It checks a plan against the actual repository: wrong assumptions, coverage gaps, missing dependencies, unjustified boundaries and parallel-safety overlaps. It returns numbered findings and writes no files.

When review runs: automatically for multi-epic plans, opt-in for a large single epic, never for an ordinary task. Gate 1 reviews the epic list before the user approves it. Gate 2 reviews all expanded `now` epics before any task is written, by resuming the same reviewer. A large single epic gets only Gate 2. Deferred epics get only Gate 1, and Gate 2 is opt-in when they are expanded later.

Equal footing: the reviewer is always a fresh agent, never a fork. It receives the user's original prompt verbatim, the same source spec and the user's answers to the planner's questions, and never the planner's reasoning or a paraphrase. It first returns a blind sketch (its own outline and main risks), which is shown to the user, and only then receives the draft through a follow-up message.

The user as third reviewer: the planner answers every finding with a reason. The reviewer's words are shown verbatim next to the planner's position. The user's comments are forwarded verbatim to both sides. The user is asked questions only about disputes; agreed findings stay visible by ID and can be reopened. The reviewer gets one automatic response, then the user decides whether further rounds happen.

Additional reviews: at any time before tasks are written, on a plan of any size, the user can ask for Continue (the same reviewer) or Fresh (a new reviewer given the original inputs and the current draft, without earlier findings). Neither is capped. Review of already-written tasks is out of scope.

Held writes: when several epics are planned, no task is written until the last review is finished. Drafts refer to tasks in other epics by title, and the planner swaps in real filenames as each epic is written in dependency order. The task writer script does not change. Epic creation stays right after Gate 1.

Plan view: a reference file holds a small HTML skeleton and fill-in rules for a self-contained page with no external assets; there is no renderer script. Review mode shows the epic and task dependency graph, a coverage table, both plans side by side, findings by ID with both positions and status, and open decisions with their options. Single-task mode shows the goal, blockers, touched surfaces, acceptance criteria and open options, and works on already-written tasks. The page is generated only on request, and during a review the main session offers it once at each gate. The page is read-only, so choices stay in the terminal using IDs, and both sides' text is copied verbatim. The skill's description must make requests to explain or visualize a task trigger it.

## Acceptance criteria

- [ ] A read-only plan-reviewer agent pinned to Opus ships with the plugin, cannot write files, and is described as a plan critic.
- [ ] How Maestro's hooks treat an agent that is not placed on any workflow is confirmed, and the reviewer gets no handoff routing, payload protocol or report format that would break a to-maestro-tasks review; any needed change is included.
- [ ] The plan-review reference covers the triggers, both gates, equal footing, the blind sketch, numbered findings, the planner's answer to each finding, verbatim relay, questions only on disputes, reopening by ID, one automatic response, user-controlled rounds, and Continue and Fresh reviews.
- [ ] The plan-review reference says what to do when follow-up messages to the reviewer are unavailable.
- [ ] The plan-view reference holds the HTML skeleton and the fill-in rules for review mode and single-task mode, with no external assets and no renderer script.
- [ ] Whether session cleanup removes .claude/maestro_sessions/<session>/ is confirmed, and the plan-view output folder is chosen so the page is not removed while the user still needs it.
- [ ] The to-maestro-tasks skill and its epics reference describe the two gates and held writes, including title references in drafts and the swap to real filenames in dependency order, with the task writer script unchanged and epic creation still right after Gate 1.
- [ ] The to-maestro-tasks description makes a request to explain or visualize a plan or task trigger the skill.
- [ ] An ordinary single-task run of to-maestro-tasks behaves as it did before, with no added review or prompt.
- [ ] The plugin version gets a minor bump, nothing developer-facing is added under plugins/, and the parity test and full verify pass.

## Touched surfaces

- plugins/maestro/agents/plan-reviewer.md (new)
- plugins/maestro/skills/to-maestro-tasks/SKILL.md
- plugins/maestro/skills/to-maestro-tasks/references/epics.md
- plugins/maestro/skills/to-maestro-tasks/references/plan-review.md (new)
- plugins/maestro/skills/to-maestro-tasks/references/plan-view.md (new)
- plugins/maestro/.claude-plugin/plugin.json (version; generated or version file, always counts as overlap)
- plugin hook sources and .claude/scripts mirrors, only if the hook check requires a change
- .claude/skills/task-queue, if the skill's documented flow needs updating

## Blocked by

None — can start immediately
