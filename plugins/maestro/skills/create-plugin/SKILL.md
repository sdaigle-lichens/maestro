---
name: create-plugin
description: "Creates or finishes a plugin in a local marketplace: the plugin.json manifest, the skills/ and agents/ layout, its README, and its registration in marketplace.json. Use when the user asks to add a new plugin, create a plugin, write a plugin README, or register a plugin in a marketplace."
---

# Create Plugin

A plugin is the unit a marketplace distributes: a manifest, the skills and agents under it, and a
README that tells someone whether they want it. Sometimes the manifest and the registration already
exist and only the README is missing; sometimes nothing exists at all. Work out which first.

## Which entry you are on

| Signal | Entry | What it means |
| --- | --- | --- |
| A `Context from the Maestro app` block naming the `create-plugin` form, with a plugin directory as the writable scope | **App — session pane** | `plugin.json`, `skills/` and the marketplace registration exist. The user is present and can answer a question or allow a write. |
| Instructions saying the scaffold has already written the manifest, and no way to ask anything (no `AskUserQuestion`) | **App — headless run** | Same state on disk. Nobody is there to answer. |
| Neither — a user asked for a plugin in conversation | **Terminal** | Nothing exists. Gather what is missing, then create it. |

The cheap test: **is there already a `plugin.json` at the path you were handed?** Then you are on an
app entry. Read it and the marketplace manifest before writing anything.

Note the app path is slightly different from the other three forms: a plugin manifest is complete as
scaffolded, so the confirmation does not open by itself. Reaching this skill from the app means the
user pressed **Finish with Claude** — for the README, and for anything else they say they want.

Anything passed with the invocation is the user's intention: $ARGUMENTS
(If that reads as an empty or literal placeholder, nothing was passed.)

## The app entries — finish what the scaffold wrote

The scaffold wrote `plugin.json` (author inherited from the marketplace owner), created `skills/`,
and appended the plugin to the marketplace's `plugins` array. All three are done and none of them is
yours to redo.

1. **Read `plugin.json` and the marketplace's `marketplace.json`.** Name, description, keywords,
   author and homepage are all there — that is where the README's facts come from.
2. **Do not re-ask for the name, description or keywords**, and **do not edit `marketplace.json`**:
   the registration is already correct, and rewriting it risks the entry the app just added.
3. **Write `README.md` in the plugin directory** — §What the README has to do.
4. **No filesystem settings are loaded, so no `CLAUDE.md` reached you automatically.** Read the
   marketplace's own `CLAUDE.md` if there is one and its conventions matter.
5. **You have no shell and no subagents.** `Bash` is not offered on either app entry.

### What you may write, and what happens if you reach further

- **Session pane.** The plugin's own directory is writable without interrupting anyone — the README,
  a `hooks/hooks.json`, a skill or agent under it. A write outside that directory (the marketplace
  manifest, another plugin, the repo root) is **not forbidden**: it pauses and asks the user, who
  can allow it. If the work needs it, attempt the call and let them answer — do not decide on their
  behalf that a boundary is a wall. Reads outside the project and the local marketplaces prompt the
  same way and can be granted for the session; do not assume a read succeeded before you have its
  content.
- **Headless run.** You may write only the paths the confirmation listed — for this flow, the
  README. A write anywhere else is refused and there is nobody to appeal to. Put everything else in
  your reply.

## The terminal entry — create one from nothing

1. **Find the marketplace.** Ask which one if it is not obvious, and read its
   `.claude-plugin/marketplace.json`: the owner and homepage in the plugin manifest come from there,
   not from you.
2. **Create the layout.**

   ```
   <marketplace>/plugins/<name>/
   ├── .claude-plugin/
   │   └── plugin.json
   ├── skills/
   ├── agents/          # only if the plugin ships subagents
   └── README.md
   ```

3. **Write `.claude-plugin/plugin.json`.**

   ```json
   {
     "name": "<name>",
     "version": "0.1.0",
     "description": "<one line, what it provides>",
     "author": { "name": "<owner.name from marketplace.json>", "email": "<owner.email>" },
     "homepage": "<metadata.homepage from marketplace.json>",
     "keywords": ["<keyword>", "<keyword>"]
   }
   ```

4. **Register it** — append to the marketplace manifest's `plugins` array:

   ```json
   { "name": "<name>", "source": "./plugins/<name>", "description": "<same one line>" }
   ```

   Keep the file's existing formatting; a manifest reformatted wholesale is a diff nobody can review.
5. **Write the README** — §What the README has to do.
6. **Hooks**, if it needs them: `hooks/hooks.json` in the plugin root (or inline in `plugin.json`),
   never in the user's settings, so they are distributed with the plugin. Paths inside them resolve
   through `${CLAUDE_PLUGIN_ROOT}`.

## Asking rather than guessing

When a real decision is open, put it in front of the user with `AskUserQuestion` rather than picking
quietly and mentioning it afterwards.

- Every option needs a `label`, a `description` of what choosing it means, and — where the choice is
  about **shape** — a `preview` with a few lines of the thing itself. Two README outlines side by
  side settle in a glance what a paragraph does not.
- `multiSelect` must match what you mean: "which sections should the README have" is multi, "who is
  this plugin for" is not.
- **At least two labelled options, or ask in prose.** A malformed question is refused, not fixed up.
- **Never ask what the form already answered**, and never ask what reading a manifest would tell you.

Worth asking, for a plugin: who the README is written for (someone deciding whether to install it,
or someone about to work on it); whether it needs hooks; and — on the terminal entry — which
marketplace it belongs to and what it actually bundles.

## What the README has to do

Someone reads this to decide whether to install it, in about twenty seconds.

- **Title and one line.** What the plugin gives them, in their words rather than the repo's.
- **What is inside** — the skills and agents it ships, one line each, and what each is for. Read the
  directories rather than listing what you assume is there; on a freshly scaffolded plugin the
  honest answer may be "nothing yet", and saying so is better than inventing contents.
- **Install, from this marketplace**, with the real names substituted:

  ```bash
  claude plugin marketplace add <repo-or-path>
  claude plugin install <plugin-name>@<marketplace-name>
  ```

- **Use it** — what to type, or what makes it fire, once installed.
- **Anything it needs**: env vars, credentials, a runtime, a version floor. Nothing invented — only
  what the manifest or the code actually shows.

Keep it short. A plugin README that runs to three screens is one nobody finishes.

## Reference docs, if you can reach them

`docs/plugins.md`, `docs/marketplace.md` and `docs/hooks.md` in this repository (relative to this
skill: `${CLAUDE_SKILL_DIR}/../../../../docs/`) cover the manifest fields, the marketplace layout
and hook paths. On an app entry they may be outside what you can read — attempt the read if you need
it, and carry on from this file if it is refused.

## Report

- The paths written, and the manifest entry (existing or added) that registers the plugin.
- What the plugin currently ships, and that `create-skill` / `create-subagent` are how it gets more.
- Testing it locally: `claude --plugin-dir <marketplace>/plugins/<name>`.
- Publishing it: `claude plugin marketplace update` — and, for an already-installed marketplace,
  that the cache is keyed by `plugin.json`'s `version`, so a change nobody bumps stays invisible.
  Offer these; do not run them unasked.
- Anything a refused write or read stopped you from doing or checking.
