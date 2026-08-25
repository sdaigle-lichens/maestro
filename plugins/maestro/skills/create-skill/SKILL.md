---
name: create-skill
description: "Authors a Claude Code skill — finishing one the Maestro app has already scaffolded, or creating one from scratch in a conversation, in a marketplace plugin or in the project's own .claude/skills/. Use when the user asks to add a new skill, create a skill, write a SKILL.md, or scaffold a skill in a marketplace."
---

# Create Skill

Author a skill: the `SKILL.md` a session loads when its `description` matches what the user is
doing. Sometimes the file already exists and only its body is missing; sometimes nothing exists at
all. Work out which before you write anything.

## Which entry you are on

Three, and they differ in what exists on disk and in whether anyone is there to answer you.

| Signal | Entry | What it means |
| --- | --- | --- |
| A `Context from the Maestro app` block naming the `create-skill` form, with an artifact path and a writable directory | **App — session pane** | The file exists with approved frontmatter. The user is present and can answer a question or allow a write. |
| Instructions saying the scaffold has already written a path, and no way to ask anything (no `AskUserQuestion`, no `Skill` follow-up from a person) | **App — headless run** | The file exists. Nobody is there. Whatever you cannot decide, say in your reply instead of asking. |
| Neither — a user asked for a skill in conversation | **Terminal** | Nothing exists. Gather what is missing, then create it. |

The cheap test: **were you handed a path to a file that is already on disk?** Then you are on an app
entry — read it before doing anything else. If you were not, you are in a conversation and the
directory, the name and the frontmatter are all still to be decided.

Anything passed with the invocation is the user's intention, and is the only thing here that speaks
for them: $ARGUMENTS
(If that reads as an empty or literal placeholder, nothing was passed — do not treat it as content.)

## The app entries — finish what the scaffold wrote

The deterministic scaffold ran when the form was submitted, before any model was involved. It wrote
the directory and the frontmatter, and the `description:` in it is the exact string the form's live
preview showed and the user approved.

1. **Read the file first.** The seed quotes its frontmatter, but the placeholder body is on disk and
   the path is the ground truth.
2. **Do not re-ask for the name, the description or the triggers.** They were captured by the form
   and approved on screen. Asking again is the app's users being made to type something twice.
3. **Do not rewrite the frontmatter, and do not move or recreate the file.** Replacing the approved
   `description:` with a better one substitutes a string the user never saw — and the `description`
   is what makes the skill load at all, so a silent edit changes when it fires.
4. **Write the body in place** — replace the placeholder comment, leave no placeholder text behind.
   Section §Writing a body worth loading is the whole of how.
5. **No filesystem settings are loaded, so no `CLAUDE.md` reached you automatically.** If the
   project has conventions that matter to this skill, `Read` them yourself — do not assume you have
   already absorbed them.
6. **You have no shell and no subagents.** `Bash` is not offered on either app entry. Anything that
   needs a command is something to write down for the user, not something to run.

### What you may write, and what happens if you reach further

- **Session pane.** The artifact's own directory is writable without interrupting anyone — a
  `references/` file or a `scripts/` helper beside the `SKILL.md` needs no permission. A write
  anywhere else is **not forbidden**: it pauses and asks the user, who can allow it. So if the work
  genuinely needs a file elsewhere, attempt the write and let them answer. Do not talk yourself out
  of a tool call, and do not route around a boundary that is really a question.
- **Session pane, reads.** Reading outside the project and the local marketplaces raises the same
  kind of prompt, and the user can open the file or its directory for the session. This is what
  makes *"write it like the one in my global skills folder"* workable: name the path and attempt the
  read. What you must not do is **assume** the read succeeded — if it was refused, say so and work
  from what you were given rather than describing a file you never saw.
- **Headless run.** You may write only the paths the confirmation listed, and nothing else — not
  even elsewhere under your own working directory. A write outside them is refused and that is the
  end of it: there is no one to appeal to. Finish the file you were asked to finish and put anything
  else in your reply.

## The terminal entry — create one from nothing

No form ran. Everything the app would have captured is missing, and guessing it is how a session
ends up confidently discussing a file nobody made.

1. **Decide where it lives** — a marketplace plugin (`<marketplace>/plugins/<plugin>/skills/<name>/SKILL.md`)
   or the project itself (`<project>/.claude/skills/<name>/SKILL.md`). A project skill is picked up
   automatically by any session in that project; a marketplace skill is distributed. Never write into
   a repository's root `skills/` folder if one is generated by CI — check before assuming.
2. **Gather the name, the idea and the triggers** — see §Asking rather than guessing.
3. **Build the `description`.** It is one line and it does two jobs: what the skill is, then when to
   load it. `<first sentence of the idea> Use when <triggers, joined with commas and "or" before the
   last>.` Keep it under about 140 characters; a description that never says *when* is a skill that
   never fires.
4. **Write the file** — frontmatter, then the body from §Writing a body worth loading.
5. **Say what to do next**, including the marketplace refresh below, and offer any commands rather
   than running them if the user has not asked you to.

```markdown
---
name: <kebab-case-name>
description: "<what it does.> Use when <trigger>, <trigger>, or <trigger>."
---

# <Title Case Name>

<body>
```

## Asking rather than guessing

When a real decision is open, put it in front of the user with `AskUserQuestion` rather than
picking quietly and mentioning it afterwards. This is the difference between a skill that produces
what someone wanted and one that produces something they now have to rewrite.

- Give every option a `label`, a `description` that says what choosing it means, and — where the
  choice is about **shape** — a `preview` holding a few lines of the thing itself. Comparing two
  skeletons side by side settles in one glance what a paragraph of prose does not.
- Set `multiSelect` to what you actually mean. "Which of these does it need" is multi; "how should
  it be structured" is not.
- **A question needs at least two labelled options.** If what you have is really a yes/no, phrase it
  as two options, or just ask in prose. A malformed question is refused, not guessed at.
- **Do not ask what the form already answered** (app entries) and do not ask what one `Read` would
  tell you. Ask about intent, never about facts.

Worth asking, for a skill: how much structure the body should carry (a step-by-step workflow, a
reference table, a decision tree, or a short set of rules); whether it needs `references/` or
`scripts/` beside it; and — on the terminal entry — where it should live and what should make it
fire. Everything else is usually yours to decide and say.

## Writing a body worth loading

A skill is loaded into a session that is already busy. It earns its place by being the thing the
model would otherwise have had to work out, so write it as the expert who has already made the
mistakes — not as a summary of what the reader could have guessed.

- **Open with what this is and when it applies.** One or two sentences. A skill that starts with
  background is one that gets skimmed past.
- **Then the workflow, in the order it is done.** Numbered steps, each with the concrete command,
  path or snippet it needs. "Configure the environment" is not a step; the two lines that configure
  it are.
- **Put the traps where they bite, not in a section at the end.** Anything that has cost someone an
  hour belongs beside the step that causes it, said plainly: what happens, and what to do instead.
- **Use a table when there are more than about three parallel cases** — options, flags, file kinds,
  decision branches. Prose about parallel cases is where detail goes to be lost.
- **Show, then explain.** A minimal, runnable snippet beats a description of one; keep examples to
  the smallest thing that actually works.
- **State what the skill will not do**, if that boundary is not obvious. It stops the model from
  wandering into work the user did not ask for.
- **Leave nothing to fill in.** No `TODO`, no `<describe here>`, no placeholder headings. If a
  section cannot be written without a fact you do not have, ask for the fact (§Asking rather than
  guessing) or drop the section.

Optional subdirectories, and only if they earn it: `scripts/` for executable helpers, `references/`
for long-form docs or templates the body links to, `assets/` for static files. A skill that is one
file is easier to read and easier to load than one that is four.

If a hook belongs with it — something that must run before or after a tool call — put it in the
**plugin**, never in the user's settings, so it is distributed with everything else.

## Reference docs, if you can reach them

`docs/skills.md`, `docs/plugins.md` and `docs/hooks.md` in this repository (relative to this skill:
`${CLAUDE_SKILL_DIR}/../../../../docs/`) cover the skill format, the plugin layout and the hook
lifecycle. On an app entry they may be outside what you can read — attempt the read if you need it,
and carry on from what is in this file if it is refused. Nothing here depends on them.

## Report

Say what is now on disk and what is left for the user:

- The path of the `SKILL.md`, and anything else you wrote beside it.
- For a marketplace skill: it becomes visible to other projects after `claude plugin marketplace
  update` — and, if the marketplace was already installed, only once the plugin's `version` in
  `plugin.json` changes, since the cache is keyed by it. Offer those; do not run them unasked.
- For a project skill: nothing to do — sessions in that project pick it up.
- Anything you could not do, and anything a refused write or read stopped you from checking.
