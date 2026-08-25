# Rewrite the create-* skills for interactive sessions

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The guidance for finishing a scaffolded artifact currently exists **twice**: in the four create-\*
skills, and inlined into the prompt the bridge builds. The inlining was not laziness — a slash
command re-entered the skill from the top and re-derived fields the payload already carried, so the
instructions were pasted in instead.

That rule exists **because a headless run has nobody to ask**. It is the same root cause as edit
pre-acceptance — which `018` removed on its own terms, by answering for the paths the confirmation
displayed rather than by asking — and the pane removes the rest of it: the session can ask a real
question and get a real answer. So the skills can be loaded as skills, invoked when relevant, and the
inlined copies deleted. One source of guidance for the app and the terminal both, instead of two that
drift apart with nothing to catch it.

### What `019` already built, and what it deliberately did not

- **The `Skill` tool is in the pane's set, and the five skills genuinely load.** `PANE_TOOLS` is
  `[...SESSION_TOOLS, "Skill"]` in `src/core/agent-sdk.ts`, and a live session reports exactly
  `ai-tools-manager:create-marketplace`, `:create-plugin`, `:create-skill`, `:create-subagent`,
  `:super-help` and nothing else.
- **`skills` alone was not enough, and that is worth knowing before you debug anything.** With
  `settingSources: []`, naming skills in the `skills` option makes the `Skill` tool answer _"Unknown
  skill"_ for every one of them, because no installed plugin reaches the session. What fixed it is
  `plugins: [{ type: "local", path: bundledPluginDir() }]`.
- **The pane loads the plugin BUNDLED WITH THE APP — `plugins/ai-tools-manager/` in this repo — not
  the user's installed marketplace copy.** So an edit to a `SKILL.md` here reaches a pane session
  immediately: no `plugin.json` version bump, no marketplace update, no cache to clear. That is the
  opposite of every delivery path the `updating-maestro` skill describes, and it makes iterating on
  these files in the app fast and slightly deceptive — **terminal users still read the version-keyed
  marketplace cache**, so the version bump is still required before the rewrite reaches them, and the
  terminal entry is half of what this task must prove.
- **The plugin's `hooks.json` does not fire in a pane session.** Measured: a turn that read a file in
  a project _with_ a `maestro.json` wrote no `maestro_session.log.jsonl`. A rewritten skill cannot
  lean on Maestro's runtime hooks when it runs in the pane, and its tool calls will not appear in
  `/session-log`.
- **A session loads no filesystem settings (`settingSources: []`), so `CLAUDE.md` files are not
  auto-loaded** — into a headless run or into the pane. A skill that assumed the model had already
  absorbed a project's conventions has to say so and let the model `Read` them.
- **"Ask rather than guess" depended on `021`, and `021` is now done.** `019` added only `Skill`;
  `AskUserQuestion` reached `PANE_TOOLS` in `021` (`PANE_TOOLS = [...SESSION_TOOLS, "Skill",
  QUESTION_TOOL]`), together with `toolConfig: { askUserQuestion: { previewFormat: "markdown" } }`
  on the pane query — without that second precondition Claude emits no `preview` on any option and
  the list arrives bare, which looks like a rendering bug in the skill's own wording and is not one.
  The facility these skills are meant to be the first real consumer of now exists: see "What `021`
  shipped" below for what a skill may assume about it.

### What `020` and `023` changed about being refused, and what a skill may now say

- **A refused call in the pane is a question, not a wall.** `020` routes a write outside the write
  scope, and a read outside the read boundary, into a prompt the user answers per call. So a skill
  running in the pane should not describe a refusal as final or route around it pre-emptively — the
  user is right there. The headless entry is unchanged: there a refusal is still the end of it, and
  the skill has to say which entry it is describing.
- **A read outside the boundary can now be authorised for the session, which is exactly the
  "make it like my existing one" case these skills exist to serve.** `023` added a grant button that
  offers the file or its containing directory; a user's own global skills live outside the project
  and outside every marketplace, so a skill may point the model at such a path and let the prompt
  handle consent. What it must not do is **assume** the access — the first read there raises a
  prompt, and a skill that treats the read as certain will write confidently about a file it never
  saw. Grants die with the session, so the next session asks again.
- **On the terminal entry none of this applies.** No boundary, no pane, no prompt — which is another
  reason the two entries need distinct wording rather than one paragraph hedged to cover both.

### What `022` shipped, and what a skill may now assume on the app path

The handoff this task waited for exists, and it changes what "the app entry" means: the model does
not arrive at a blank conversation to be told what happened, it arrives already holding the facts.

- **The app entry is a `session:handoff` call carrying a preview TOKEN and nothing else.** The
  confirmation dialog now has two buttons over the same single-use token — **Run** (the headless
  finish, unchanged) and **Continue in the pane**. So "the app path" is two paths from this task's
  point of view, and a skill has to say which one it is describing: on the pane path the user is
  present and a refusal is a question; on the headless path it is still the end of it.
- **The session is seeded before the first turn, with a `HandoffContext` that already carries what
  these skills currently re-derive.** It states which form was submitted, the resolved name, the
  artifact path, the writable directory, the frontmatter the scaffold wrote (or the directory's
  listing), the repository state `016` decided, and **the previewed prompt verbatim** as "what is
  left to write". It is appended with `shouldQuery: false`, so it costs nothing until the user types.
  Two consequences for the rewrite: an app-path skill must not re-ask for the name, description or
  triggers (measured — a live session read the seeded frontmatter, rewrote the body and left the
  approved `description:` byte-identical), and the inlined guidance this task deletes is exactly the
  text that arrives in the seed's "what is left to write" block, so deleting it from the prompt
  builder removes it from the seed too. Decide deliberately what replaces it.
- **The write scope is the artifact's own directory, and only that.** Writes beside the artifact — a
  reference file, a README in the plugin — happen without asking. A write anywhere else raises
  `020`'s prompt and can be allowed once; it does not widen the scope. The exception worth knowing:
  a **project-target subagent** is a lone `.md` in a shared `.claude/agents/`, so the scope is the
  FILE, and a skill that offers to write a companion file beside it will raise a prompt every time.
- **Wording that describes a boundary as absolute stops the model attempting the call at all.**
  Measured, and it cost `022` a probe pass: a seed that said writes outside the scope were "refused,
  or come back to the user as a question" made the session decline to try, explaining it could not
  bypass the app's boundary — which silently deletes `020`'s "the user can allow this once". This is
  a rule about **this task's own prose**, not only about the seed: a rewritten `SKILL.md` that tells
  the model a path is off limits will produce the same refusal-without-a-prompt, and the user never
  gets the chance to say yes. Say that a write elsewhere asks and can be allowed, and say to go ahead.
- **A seeded, no-turn append is answered with its own zero-cost `result` message.** Relevant if this
  task adds anything else on the `shouldQuery: false` path: `startPaneSession` counts outstanding
  user turns and drops a zero-cost result that answers none of them, or the transcript claims a turn
  ran that did not.
- **`maestro-task` previews carry `handoff: null` and are refused by the channel.** Only the four
  create-\* forms hand off, which is the set this task rewrites.

### What `021` shipped, and what a skill may now assume about asking

`021` is done, and it is exactly the tool this task's central instruction depends on: "rewrite them
to ask rather than guess" means `AskUserQuestion`, and it now reaches the pane.

- **A question is a real choice, not a permission prompt and not prose.** It arrives at `canUseTool`
  in `startPaneSession` like every other tool call, but is branched to `src/core/session-question.ts`
  **before** `decidePaneCall` runs, and rendered on its own card (`agent-question.tsx`): per-option
  description and preview, single- vs multi-select stated on screen, and a freeform reply textarea for
  a user who disagrees with every option on offer. A skill only has to call the tool with real
  `label`/`description`/`preview` per option and a `multiSelect` flag that matches what it means —
  none of the rendering is the skill's concern.
- **A question reaches the person even when a rule would auto-approve it, because `AskUserQuestion`
  is never routed through `allowedTools`.** Had it been, the SDK would answer its own question instead
  of the user ever seeing it. This is why the tool is safe for a skill to reach for whenever a real
  decision is needed, not only when nothing else would auto-approve.
- **A malformed call is refused, not silently dropped or guessed at.** A question with no text, or
  with fewer than two labelled options, is rejected outright with a message telling the model to ask
  in prose instead and offer the choices in text — so a skill whose options might legitimately number
  fewer than two (a yes/no phrased as one option, say) should phrase it as at least two options or
  fall back to prose itself, rather than relying on the tool to degrade gracefully.
- **Previews are opt-in, and they are on for the pane.** `toolConfig.askUserQuestion.previewFormat`
  is `"markdown"`, rendered in a monospace block beside each option's description — the shape for a
  mockup, a config sample, or a snippet to compare against its neighbour. A skill that wants that
  comparison on screen should fill `preview` in; the option still renders correctly without one.
- **On the terminal entry there is no pane, no `session:question` channel, and no card.**
  `AskUserQuestion` there is answered however the CLI's own terminal UI answers it — this app's
  machinery is entirely absent from that path, and a skill's wording should say which entry it is
  describing rather than writing one paragraph that assumes the card exists everywhere.
- **An outstanding question cannot wedge the session.** The same parked-promise registry and
  `denyAll()` that already resolved a permission prompt on pane-close or project-switch resolves a
  question the same way. A skill never has to hedge against a question going unanswered forever — the
  worst case is a refusal the model can read and adapt to, exactly like a refused write.

**Each skill must handle both entries.** These files are invoked from the terminal too, where no
scaffold exists:

- *the artifact exists, finish it* — name, location and frontmatter already decided, do not re-ask
- *nothing exists yet* — gather what is missing, then create it

Assuming a scaffold is present is how a terminal session ends up confidently discussing a file
nobody made. Assuming one is absent is how the app's users get asked for a name they already typed.

`create-marketplace` is the sharp case, and its current contract must survive the rewrite: its
**"Do not run git"** section, and its report of which of three repository states the scaffold left
(created here / already inside one / no `git` on this machine), read from the payload rather than
probed for. That contract belongs to the *app* entry. On the terminal entry, where no scaffold ran,
the repository is the user's to create — offer the commands, do not run them.

Rewrite them to ask rather than guess. A skill that needs a decision should put the options in front
of the user, with enough description to choose between them — that facility exists now and these
skills are its first real consumer.

Note that the create-\* confirmation surface changed shape twice. `017`: it now opens with **what the
run can read** and only then says what it may write. `018`: the "Command" row is labelled
**"Equivalent"**, because `ClaudePreview.argv` is the equivalent `claude -p` line rather than what is
spawned — the run is an Agent SDK session — and the write section now ends with "Anything else is
refused. The session is also offered no shell and no subagents." Any of these skills that describes
the confirmation to the user, or assumes the write targets are the first thing on it, or tells the
model it can shell out, is describing a dialog and a run that no longer exist.

The headless entry's own contract tightened with it, and the skills should say so plainly rather than
letting a run discover it by being refused: **a headless create-\* run may write only the paths the
confirmation listed**, including nothing else under its own working directory, and it has no `Bash`.
The four `README.md` files beside these skills were corrected for this; the `SKILL.md` bodies are
this task's job.

Since these files also serve terminal users, the rewrite changes behaviour outside the app. That is
intended, and it is why this comes last: only once the handoff is working is it clear what the model
actually receives.

## Acceptance criteria

- [ ] The four create-\* skills are loaded as session skills and invoked when relevant
- [ ] The inlined instruction copies are deleted, and the prompt builder no longer duplicates guidance
- [ ] Each skill works from the app, where the artifact already exists and its fields are decided
- [ ] Each skill works from a terminal with no scaffold present, gathering what is missing first
- [ ] Fields the form already captured are never re-asked on the app path
- [ ] Where a skill needs a decision it asks with options rather than guessing or assuming
- [ ] A terminal invocation of each skill is exercised end to end, not only the in-app path
- [ ] The tests that assert no create prompt contains a slash command still hold

## Blocked by

- `022-hand-off-from-a-create-form-into-the-pane.md`
