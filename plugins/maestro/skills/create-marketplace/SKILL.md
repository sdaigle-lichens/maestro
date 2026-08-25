---
name: create-marketplace
description: "Creates or finishes a Claude Code plugin marketplace: the marketplace.json manifest, the plugins/ layout, README and CLAUDE.md, then local testing, remote and private-repo setup, and auto-update. Use when the user asks to create a marketplace, scaffold a marketplace, or set up a plugin marketplace."
---

# Create Marketplace

A marketplace is a repository with a catalog manifest in it. Sometimes the manifest and the
repository already exist and only the documentation is missing; sometimes nothing exists at all.
Work out which first — this is the flow where guessing wrong does real damage, because the wrong
guess runs `git`.

## Which entry you are on

| Signal | Entry | What it means |
| --- | --- | --- |
| A `Context from the Maestro app` block naming the `create-marketplace` form, with a directory as the writable scope and a `Repository:` line | **App — session pane** | The manifest, `plugins/` and a starter README exist, and the repository question is already settled. The user is present. |
| Instructions saying the scaffold has already written the directory, plus a sentence about the repository, and no way to ask anything (no `AskUserQuestion`) | **App — headless run** | Same state on disk. Nobody is there to answer. |
| Neither — a user asked for a marketplace in conversation | **Terminal** | Nothing exists, and the repository is theirs to create. |

The cheap test: **is there already a `.claude-plugin/marketplace.json` at the path you were
handed?** Then you are on an app entry — read it before writing anything.

Anything passed with the invocation is the user's intention: $ARGUMENTS
(If that reads as an empty or literal placeholder, nothing was passed.)

## Do not run git — on any entry, for two different reasons

**On an app entry**, initialising the repository and committing the scaffold is the app's job and it
has already happened or already failed. It is a step in the deterministic scaffold, so it runs
whether or not a session like this one ever starts, and it is rolled back with the rest of the
scaffold if a later step fails. Three states are possible and **you were told which one applies** —
a repository was created there, the directory was already inside one, or the machine has no `git`
and the user will run `git init` themselves. **Read that line rather than probing for it**, and
report it as it was given to you. (You have no `Bash` on this entry anyway, so an attempt to check
is an attempt to work around a fact you already have.)

**On the terminal entry** the repository is the user's to create. Offer the commands, in a block
they can run; do not run them. `git init` in the wrong directory, or a first commit under your
authorship, is not something an offer of help should cost someone.

What is genuinely conversational and genuinely yours to guide, on every entry: the **remote**, the
**private-repo credentials**, and **auto-update**. Those need a host, an account and secrets the app
has not got. Offer them, never do them silently.

## The app entries — finish what the scaffold wrote

On disk already: `.claude-plugin/marketplace.json` (name, owner, metadata), an empty `plugins/`, and
a starter `README.md`. What is missing is documentation.

1. **Read the manifest and the starter README.** Name, description, owner and homepage come from
   there, not from your memory of the form.
2. **Do not re-ask for the name, description, owner or target directory**, and **do not edit
   `marketplace.json`** — it is the catalog, and the app wrote it from what the user approved.
3. **Enrich `README.md`**: title, what this marketplace offers, and the real install commands —

   ```bash
   claude plugin marketplace add <repo-or-path>
   claude plugin install <plugin-name>@<marketplace-name>
   ```

   Substitute the actual names. `<repo-or-path>` is the local path until a remote exists; say so
   rather than inventing a GitHub URL nobody has created.
4. **Write `CLAUDE.md`** — short context for a session opened inside this repository: that it is a
   marketplace catalog, that `.claude-plugin/marketplace.json` is the manifest and the source of
   truth for what is published, and that plugins live at `plugins/<name>/` with their own
   `.claude-plugin/plugin.json`. Two screens at most; it is loaded into every session here.
5. **Then guide the rest in your reply** — §The parts that stay conversational.
6. **No filesystem settings are loaded, so no `CLAUDE.md` reached you automatically** — including
   the one you are about to write.

### What you may write, and what happens if you reach further

- **Session pane.** The marketplace directory is writable without interrupting anyone, so the README
  and `CLAUDE.md` need no permission. A write outside it is **not forbidden**: it pauses and asks the
  user, who can allow it. Attempt the call if the work needs it — do not decide on their behalf that
  a boundary is a wall. Reads outside the project and the local marketplaces prompt the same way and
  can be granted for the session; do not assume such a read succeeded before you have its content.
- **Headless run.** You may write only the paths the confirmation listed — for this flow, the README
  and `CLAUDE.md`. Anything else, including elsewhere under this same directory, is refused with a
  reason and there is nobody to appeal to. Write those two, and put everything else in your reply.

## The terminal entry — create one from nothing

1. **Gather** the name, a one-line description, the owner name and email, an optional homepage, and
   the target directory — see §Asking rather than guessing. Use an absolute path; a marketplace
   commonly lives outside whatever project the session is in.
2. **Create the layout.**

   ```
   <targetDir>/
   ├── .claude-plugin/
   │   └── marketplace.json
   ├── plugins/
   ├── CLAUDE.md
   └── README.md
   ```

3. **Write `.claude-plugin/marketplace.json`.**

   ```json
   {
     "name": "<name>",
     "owner": { "name": "<ownerName>", "email": "<ownerEmail>" },
     "metadata": { "description": "<description>", "version": "0.1.0", "homepage": "<homepage>" },
     "plugins": []
   }
   ```

   Omit `homepage` entirely if they left it blank — an empty string is not the same as absent.
4. **Write `README.md` and `CLAUDE.md`** as in steps 3–4 above.
5. **Offer the repository, do not create it:**

   ```bash
   git init && git add -A && git commit -m "Initial marketplace"
   ```

6. **Then §The parts that stay conversational.**

## The parts that stay conversational

**The remote.** The repository exists locally; publishing it does not. Ask which host, then give the
exact commands — the URL, the account and the credentials are theirs:

```bash
git remote add origin <url>
git push -u origin main
```

**Auto-update.** Third-party and local marketplaces have it **disabled** by default. Once the
marketplace is registered: `/plugin` → **Marketplaces** → select it → **Enable auto-update**. The
global overrides, if they ask:

```bash
export DISABLE_AUTOUPDATER=1          # disable everything
export FORCE_AUTOUPDATE_PLUGINS=1     # keep plugin auto-update, disable Claude Code updates
```

**Private repositories.** Only when the marketplace will be private. Background auto-update at
startup skips credential helpers, so it needs an env var:

| Provider  | Env vars                     |
| --------- | ---------------------------- |
| GitHub    | `GITHUB_TOKEN` or `GH_TOKEN` |
| GitLab    | `GITLAB_TOKEN` or `GL_TOKEN` |
| Bitbucket | `BITBUCKET_TOKEN`            |

Tell them to put it in `.bashrc` / `.zshrc` so it survives a reboot, and to use a secret in CI.
Never write a token into a file yourself.

## Asking rather than guessing

When a real decision is open, put it in front of the user with `AskUserQuestion` rather than picking
quietly and mentioning it afterwards.

- Every option needs a `label`, a `description` of what choosing it means, and — where the choice is
  about **shape** — a `preview` with a few lines of the thing itself.
- `multiSelect` must match what you mean.
- **At least two labelled options, or ask in prose.** A malformed question is refused, not fixed up.
- **Never ask what the form already answered** (app entries) — the name, the description, the owner,
  the directory and the private-repo flag were all captured and approved there.

Worth asking, for a marketplace: which host it will be published to (or not yet); whether it is
private, since that changes what the docs must cover; and — on the terminal entry — the owner
details and the target directory, which are the two nobody can infer.

## Reference docs, if you can reach them

`docs/marketplace.md` and `docs/plugins.md` in this repository (relative to this skill:
`${CLAUDE_SKILL_DIR}/../../../../docs/`) cover the manifest fields, publishing and the private-repo
section. On an app entry they may be outside what you can read — attempt the read if you need it,
and carry on from this file if it is refused.

## Report

- The files that now exist: the manifest, `plugins/`, `README.md`, `CLAUDE.md`.
- **The repository state, in one sentence, exactly as you were told it** — created here, already
  inside one, or none and the user runs `git init` — never as something you probed for.
- Next steps: `create-plugin` to add a plugin, then `create-skill` / `create-subagent` to fill it;
  test locally with `claude plugin marketplace add <targetDir>`; add a remote and push when ready,
  then share it as `claude plugin marketplace add owner/repo`.
- Anything a refused write or read stopped you from doing or checking.
