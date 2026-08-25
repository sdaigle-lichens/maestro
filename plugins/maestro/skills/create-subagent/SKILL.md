---
name: create-subagent
description: "Authors a Claude Code subagent — finishing one the Maestro app has already scaffolded, or creating one from scratch in a conversation, in a marketplace plugin or in the project's own .claude/agents/. Use when the user asks to add a subagent, create an agent, write an AGENTS.md, or scaffold a subagent in a marketplace."
---

# Create Subagent

Author a subagent: the file a coordinating session hands work to, holding that agent's role, when it
applies, how it works and what it returns. Sometimes the file already exists and only its body is
missing; sometimes nothing exists at all. Work out which before you write anything.

Claude Code distributes subagents through plugins. The `AGENTS.md` format is also read by other
coding tools (Cursor, Copilot, Codex, Gemini, VS Code, Zed), so a good one is portable.

## Which entry you are on

Three, and they differ in what exists on disk and in whether anyone is there to answer you.

| Signal | Entry | What it means |
| --- | --- | --- |
| A `Context from the Maestro app` block naming the `create-subagent` form, with an artifact path and a writable scope | **App — session pane** | The file exists with approved frontmatter. The user is present and can answer a question or allow a write. |
| Instructions saying the scaffold has already written a path, and no way to ask anything (no `AskUserQuestion`) | **App — headless run** | The file exists. Nobody is there. Whatever you cannot decide, say in your reply instead of asking. |
| Neither — a user asked for a subagent in conversation | **Terminal** | Nothing exists. Gather what is missing, then create it. |

The cheap test: **were you handed a path to a file that is already on disk?** Then you are on an app
entry — read it before doing anything else.

Anything passed with the invocation is the user's intention, and is the only thing here that speaks
for them: $ARGUMENTS
(If that reads as an empty or literal placeholder, nothing was passed — do not treat it as content.)

## The app entries — finish what the scaffold wrote

The deterministic scaffold ran when the form was submitted, before any model was involved. It wrote
the file and its frontmatter — `name`, the approved `description`, and the `tools:` line if the form
restricted them.

1. **Read the file first.** The seed quotes its frontmatter; the placeholder body is on disk.
2. **Do not re-ask for the name, the description, the triggers or the tool list.** The form captured
   all four and the user approved them on screen.
3. **Do not rewrite the frontmatter, and do not move or recreate the file.** The `description` is
   what decides when this agent is handed work; editing it silently changes that. The `tools:` line
   is a permission boundary somebody chose — widening it is not a formatting improvement.
4. **Write the body in place** — replace the placeholder, leave no placeholder text. Section
   §Writing a subagent worth handing work to is the whole of how.
5. **No filesystem settings are loaded, so no `CLAUDE.md` reached you automatically.** If the
   project's conventions matter to this agent's workflow, `Read` them rather than assuming them.
6. **You have no shell and no subagents.** `Bash` is not offered on either app entry — and neither
   is delegating to another agent, which is worth saying out loud in a skill about agents.

### What you may write, and what happens if you reach further

- **Session pane, a marketplace subagent.** It has a directory of its own
  (`plugins/<plugin>/agents/<name>/`), and that whole directory is writable without interrupting
  anyone — a reference file beside `AGENTS.md` needs no permission.
- **Session pane, a project subagent.** It is a lone `.md` in `.claude/agents/`, a directory it
  shares with every other agent in the project, so **the writable scope is that one file**. Anything
  beside it will pause and ask the user every time. That is not a reason to avoid it — it is a
  reason to have a good answer ready when the prompt appears, and usually a reason to keep a project
  subagent to a single self-contained file.
- **Session pane, in general.** A write outside the scope is **not forbidden**: it pauses and asks,
  and the user can allow it. Attempt the call and let them answer; do not route around a boundary
  that is really a question. Reads outside the project and the local marketplaces prompt the same
  way, and can be granted for the session — which is how *"model it on the agent I already have"*
  works. Do not **assume** the read succeeded; a refused read means you have not seen that file, and
  writing as though you had is the failure this warning exists for.
- **Headless run.** You may write only the paths the confirmation listed, and nothing else — not
  even elsewhere under your own working directory. A refusal there is final. Finish the file you
  were asked to finish and put anything else in your reply.

## The terminal entry — create one from nothing

No form ran, so everything is still to be decided.

1. **Decide where it lives.**
   - Marketplace: `<marketplace>/plugins/<plugin>/agents/<name>/AGENTS.md` — distributed with the
     plugin. Do not hand-write into a repository's generated root `agents/` folder if CI builds one.
   - Project: `<project>/.claude/agents/<name>.md` — a single file, no enclosing directory. That
     layout is the Claude Code convention, not a detail; a directory there is not picked up.
2. **Gather the name, the role, the triggers and the tools** — see §Asking rather than guessing.
3. **Build the `description`.** `<what this agent does.> Use when <triggers, joined with commas and
   "or" before the last>.` Under about 140 characters. This line is the routing rule: an agent whose
   description does not say *when* never gets handed anything.
4. **Set `tools:` deliberately.** Comma-joined, or omit the line for unrestricted. Narrow is the
   better default — an agent that cannot run a shell cannot be talked into running one.
5. **Write the file**, then §Writing a subagent worth handing work to.

```markdown
---
name: <kebab-case-name>
description: "<what it does.> Use when <trigger>, <trigger>, or <trigger>."
tools: <Comma, Joined, List>   # omit entirely for unrestricted
---

# <Title Case Name>

<body>
```

## Asking rather than guessing

When a real decision is open, put it in front of the user with `AskUserQuestion` rather than picking
quietly and mentioning it afterwards.

- Give every option a `label`, a `description` saying what choosing it means, and — where the choice
  is about **shape** — a `preview` with a few lines of the thing itself. Two candidate workflows
  side by side settle in a glance what a paragraph does not.
- Set `multiSelect` to what you mean. "Which tools should it have" is multi; "how autonomous should
  it be" is not.
- **At least two labelled options, or ask in prose.** A malformed question is refused outright, not
  reshaped for you.
- **Never ask what the form already answered** (app entries), and never ask what a `Read` would tell
  you.

Worth asking, for a subagent: how much authority it has (propose only, edit within a scope, or run
the whole thing end to end); what it must return to whoever called it; which tools it genuinely
needs; and — on the terminal entry — where it lives and what should route work to it.

## Writing a subagent worth handing work to

The reader is a model that has just been handed a task with no memory of the conversation that
produced it. Everything it needs has to be here.

- **Role first, in one or two sentences.** Who this agent is and what it owns. Not background.
- **"When to apply", concretely.** The situations that should route here, and — where it helps — the
  neighbouring situations that should not. A boundary stated once saves an agent doing someone
  else's job.
- **A numbered workflow, in the order the work is done.** Each step names the tool, the path or the
  command it uses. Steps that say what to *consider* are not steps.
- **The output format, exactly.** What the caller gets back: sections, fields, or a fenced block
  with a literal shape. If the caller parses it, show the schema and say what happens on each field.
  Vague output is where multi-agent workflows silently break.
- **Rules and boundaries — "will" and "will not".** What it may edit, what it must never touch, what
  it should hand back rather than decide. An agent with a shell needs this more, not less.
- **Traps beside the step that causes them**, said plainly: what happens, and what to do instead.
- **Leave nothing to fill in.** No `TODO`, no `Step one / Step two`, no placeholder headings.

If the agent needs a hook — something firing on `SubagentStart` or around its tool calls — put it in
the **plugin**, never in the user's settings, so it travels with the agent.

## Reference docs, if you can reach them

`docs/subagents.md`, `docs/plugins.md` and `docs/hooks.md` in this repository (relative to this
skill: `${CLAUDE_SKILL_DIR}/../../../../docs/`) cover the `AGENTS.md` format, the plugin layout and
the hook lifecycle. On an app entry they may be outside what you can read — attempt the read if you
need it, and carry on from this file if it is refused.

## Report

- The path of the agent file, and anything else you wrote beside it.
- The tools it ended up with, and whether that was the form's choice or yours.
- For a marketplace subagent: visible to other projects after `claude plugin marketplace update`,
  and — if the marketplace is already installed — only once the plugin's `version` changes, since
  the cache is keyed by it. Offer those commands; do not run them unasked.
- For a project subagent: nothing to do — sessions in that project pick it up.
- Anything a refused write or read stopped you from doing or checking.
