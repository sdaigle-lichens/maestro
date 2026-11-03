---
name: maestro-install
description: "Installs the Maestro orchestrator into this project from the terminal, with no desktop app required. Asks first whether Maestro is committed to the repo or kept ignored on this clone (.git/info/exclude). Detects the implementation agent(s) from the repo, scaffolds the maestro skill + runtime scripts + settings (hooks) + gitignore, seeds .claude/maestro.json, and renders the orchestrator's handoff table. Use when the user runs /maestro-install, or asks to set up / scaffold / install the Maestro subagents workflow for this project. To edit the workflow graph visually afterwards, open the project in the Maestro desktop app (apps/maestro)."
disable-model-invocation: true
---

# Maestro Install

One-time setup of Maestro for a project, entirely from a Claude session: scaffold the orchestrator, seed the config, render the handoff table. Nothing here needs the desktop app, a browser, or Docker.

```
maestro-install:  committed or ignored? → analyze repo → confirm project tags → offer local skills → offer sandbox allow-list → scaffold + seed → render → offer herdr → report
                  (git check-ignore)     (impl agents)    (catalog + consent)     (best-fit + consent)  (maestro-sandbox-allow.cjs) (maestro-install.js)  (maestro-render-orchestrator.cjs)  (command -v herdr)
```

**When to prefer the desktop app.** `apps/maestro`'s `/install` route does the same install without a session, and its `/workflows` canvas is the only comfortable way to *edit* the graph — this skill seeds a sensible starting graph, it does not let you draw one. Use this skill when there is no desktop app on the machine, or when the user is already in a terminal and wants Maestro on without leaving it.

## User's intention

$ARGUMENTS

## Workflow

1. **Ask whether Maestro is committed or ignored in this project.** Not everyone on a project wants Maestro, so decide first how it is tracked. Run:

   ```bash
   git check-ignore -q -- .claude/
   ```

   - **Exit 0 (this project's `.claude` folder is already git-ignored): skip the question**, treat the answer as `ignored`, and move on.
   - Not a git repo (the command exits 128): skip the question, use `committed` (omit the flag); there is nothing to ignore.
   - Otherwise ask **one `AskUserQuestion`**: *"Install Maestro committed (shared with everyone who clones this repo, the default) or ignored (only on this clone; `.claude/` is added to `.git/info/exclude`, which is never committed)?"* Options: `Committed (Recommended)`, `Ignored — keep Maestro out of the repo`. Record the answer as `ignoreMode` (`committed` or `ignored`) for step 6. A non-interactive install means `committed`.

2. **Analyze the repository to pick the implementation agent(s).** Inspect the project to decide which bundled agent(s) build the application code in the seeded workflows' happy path — matching `detect.ts`'s `detectImplAgents()` exactly, so a session-driven install and the app's deterministic detection reach the same chain for the same repository. Read `package.json` (plus framework configs and directory layout — `src/components`, `src/routes`, `server/`, `api/`, `requirements.txt`, `go.mod`, `Cargo.toml`, etc.) and classify:

   - **Infrastructure first, and it is exclusive of everything below.** Before considering any application category, check for declarative infrastructure: a directory named `terraform`, `infrastructure`, `iac` or `infra`; any `*.tf` or `*.tfvars` file; `Pulumi.yaml`/`Pulumi.yml` (Pulumi); `cdk.json` (AWS CDK); `serverless.yml`/`.yaml`/`.json`/`.js`/`.cjs`/`.mjs`/`.ts` (Serverless Framework); `Chart.yaml`/`.yml` (Helm); `ansible.cfg` (Ansible) — anywhere in the repo root or its packages/workspace members, not only the root. **If any of these is present, the chain is `infra` alone, full stop** — no application category joins it, no matter how strong its own signal is (a `package.json` with `express` or `react-dom` sitting beside a `main.tf` is almost always the tool's own scripting, not the product, so it does not get counted). Note in your evidence which application signals you set aside for this reason, the same way the app's evidence does, so the user can see what was overruled rather than missed.
   - Only when no infrastructure signal is found, classify by application category:
     - **Backend** (APIs, services, DB access, no UI framework) → `backend`
     - **Frontend** (React/Vue/Svelte/Angular/Next/etc., web UI-focused) → `frontend`
     - **Mobile** (Expo / React Native — `expo` or `react-native` in `package.json` dependencies, an `app.json`/`app.config.{js,ts}` with an `expo` key, or an `App.tsx`/`app/` tree with no web bundler) → `mobile`
     - **Fullstack** (a UI framework — web or mobile — *and* server/API code) → `backend,frontend` or `backend,mobile` — the happy path's implementation step becomes `@backend → @frontend` (or `@backend → @mobile`)
     - **Other non-web** (CLI, library, data pipeline, …) → there is no obvious bundled implementation agent. **Ask the user** which agent(s) they use to implement code. If none is suitable, suggest they run `/create-subagent` to make one, then re-run `/maestro-install`.

   The result is a comma-separated `implAgents` list (e.g. `backend`, `frontend`, `mobile`, `backend,mobile`, or `infra`). This only sets the *starting* graph — the user can rewire it later in the desktop app's canvas or by hand-editing `maestro.json`.

3. **Confirm the project tags.** A project can carry several, so this is a multi-select decision throughout, never a pick-one. These are the categories the desktop app's `/templates` → Project Tags tab edits, and what auto-adds a matching bundled agent later.

   **Skip this step entirely on a re-install** (`.claude/maestro.json` already exists) — the seed only applies to a fresh install, and an existing config's `project_tags` is the user's own.

   On a fresh install:

   - **Read the global catalog.** Never fail the install on this — an older `node` without `node:sqlite` just yields `[]`:

     ```bash
     node -e "
       try {
         const { readAllProjectTags } = require('${CLAUDE_SKILL_DIR}/../../scripts/lib/maestro-project-tags.cjs');
         console.log(JSON.stringify(readAllProjectTags()));
       } catch { console.log('[]'); }
     "
     ```

   - **Split step 2's detected `implAgents` against that catalog** — this direction only. The catalog is never read to decide what the repo *is*; `detect.ts`'s signal tables are the sole source of evidence.
     - `detectedInCatalog` — detected categories the catalog already has. Step 2 established them, so they are the recommended answer, named in the question text.
     - `detectedNotInCatalog` — a detected category the catalog has never held. The catalog only grows by an explicit add, never by re-seeding an existing machine, so this is what happens the day a new detection category ships to a machine that seeded earlier.

   - **Confirm with one `AskUserQuestion`** — the detected set and any add-offer go in the *same* question, never a second one.
     - **Catalog ≤4 entries** → a single **multiSelect**, where **what the user checks is exactly what gets recorded**. `AskUserQuestion` cannot pre-tick an option, so never write a question whose options mean different things depending on whether they are ticked — "included unless you remove it" reads as both "tick to keep" and "tick to drop", and the user cannot tell which. Ask it plainly instead: *"Which tags should this project carry? Detection found `backend, frontend` — check those to keep them, and check any other that applies. A project can carry more than one."* List every catalog entry, described `(detected)` or `(not detected)`. An empty answer means no tags, not the detected set.
       - For each `detectedNotInCatalog` category, add one more option: `Add "<category>" to the catalog and tag this project with it`, its description saying step 2 detected it but the catalog has never held it. Declining leaves the catalog untouched.
     - **Catalog >4 entries** → `AskUserQuestion` caps options at 4, so fall back to coarse consent: `Use the detected tags (backend, frontend) as-is (Recommended)`, `Customize — add or remove tags`, `Skip — I'll tag it on /maestro afterward`. Mention any `detectedNotInCatalog` category in the Customize description. If they customize, accept a **plain-text, comma-separated reply naming every tag that should end up recorded** — say so explicitly ("reply with the full list, e.g. `backend, frontend, data` — more than one is expected"), because a freeform reply *replaces* the detected set rather than adding to it.
     - Empty catalog → skip the question silently. (Reading it above self-seeds it, so this is theoretical.)

   - **Assemble the result.** If the user accepted an add-offer, add the category for real **before** step 6, so the installer's own intersection sees a live entry instead of dropping it:

     ```bash
     node -e "
       try {
         const { addProjectTag } = require('${CLAUDE_SKILL_DIR}/../../scripts/lib/maestro-project-tags.cjs');
         addProjectTag('<category>');
       } catch { /* no node:sqlite — nothing recorded; the intersection then drops it, same as a decline */ }
     "
     ```

     **Declining, or a non-interactive install where no question is asked, skips this call entirely** — the category is then dropped by the installer's catalog intersection, and the config still records only real catalog entries.

     `confirmedTags` = exactly what the user checked (or, in the >4 branch, the detected set they accepted or the list they typed), as a comma-separated list. It is intersected against the live catalog *again* inside `maestro-install.js`, so an invented name in a freeform reply is dropped rather than recorded.

4. **Offer to attach the repo's local skills to the seeded agents.** This pre-populates the seeded instances so the user doesn't have to hunt. **Skip this step entirely** if `.claude/maestro.json` already exists — the existing config owns the user's skill assignments.

   On a fresh install:

   - **Discover project skills across the whole tree, not just the root.** A skill is any directory containing a `SKILL.md` under some `.claude/skills/`, and in a monorepo most of them live beside the code they describe (`apps/<app>/.claude/skills/`), not at the repository root. Reading only the root's is how an agent ends up seeded with no skills at all. `maestro-install.js` walks the whole tree for `skills_available`; match it here so the best-fit map covers the same set:

     ```bash
     find . \
       \( -name node_modules -o -name .git -o -name dist -o -name out -o -name build \) -prune -o \
       -path "*/.claude/skills/*/SKILL.md" -print 2>/dev/null
     ```

     A skill's **id is its directory name**, unless its `SKILL.md` frontmatter has `name:`, which wins — the same rule the canvas uses. If one id appears in two directories the installer warns and keeps the first; mention it if it happens. Ignore user (`~/.claude`) and plugin skills.

     **Many project skills are plain Markdown with no frontmatter at all — that is normal, do not skip them.** Get a description from frontmatter `description:` if present, else the first heading or sentence. **Do not pipe the listing through `grep` for `name:`/`description:`** — it exits non-zero the moment a skill has no frontmatter and silently drops every doc-style skill. List paths, then `Read` the ones you need a description for.

   - **Drop any skill already tagged.** `maestro-install.js` reads `~/.claude/maestro-skill-tags.sqlite` itself and wires a tagged skill to its matching agent(s) with no question asked, *regardless* of `--skill-map`, so best-fit-guessing one is wasted work:

     ```bash
     node -e "
       try {
         const { readAllSkillTags } = require('${CLAUDE_SKILL_DIR}/../../scripts/lib/maestro-skill-tags.cjs');
         console.log(JSON.stringify(readAllSkillTags()));
       } catch { console.log('{}'); }
     "
     ```

     Never fails the install — `{}` just means every skill falls through to best-fit. A skill counts as covered only if one of its tags matches a *seeded* agent — and which agents are seeded is chain-dependent, per `seededAgentNames()`: the detected `implAgents` plus `test`/`reviewer`/`refactor`/`scribe` for an application chain, but the detected `implAgents` plus only `reviewer`/`scribe` for the `infra`-only chain (no `test`, no `refactor` — see step 6's note). A `mobile` tag on a backend-only repo routes nowhere, and neither does a `test`/`refactor` tag on an infra-only repo.

   - **Best-fit map the remaining skills** to the single seeded agent each most helps, choosing among seeded agents only. **Drop** anything not clearly relevant — don't force a match. A `react`/`styling` skill → `frontend`; `react-testing-library` → `test`; `changelog` → `scribe`.

   - **Confirm with the user.** Print the proposed mapping grouped by agent, one line per skill with a short why, **including** the already-tagged ones so the user sees the whole picture — saying they need no consent:

     ```
     @frontend ← react, styling, gantt-render, shift-logic, workorder-store
     @test     ← react-testing-library
     @backend  ← db-migrations (already tagged; nothing to confirm)
     ```

     Then ask **one `AskUserQuestion`** for consent on the best-fit guesses only. **Do not make individual skills the options** — `AskUserQuestion` requires 2–4 options, so a per-skill checklist breaks the moment an agent has 1 or 5+ skills. Use coarse options: `Attach all (Recommended)`, `Let me drop some`, `Skip — I'll assign on the canvas`. On "drop some", take a plain-text reply of skill ids (or skill→agent pairs). If every skill was already tagged, or none of the rest is relevant, skip the question silently.

   - **Assemble the skill map**: `{ "<agent>": ["<skillId>", …] }` from the confirmed best-fit mapping only — omit already-tagged skills (the installer adds those itself) and agents with no skills. Attached skills seed as **referenced** (loaded only if the task calls for it), never as loaded; promoting one is a canvas edit.

5. **Offer the sandbox allow-list.** Claude Code's Bash sandbox always refuses writes to
   `.claude/settings*.json` and `.claude/skills/`, so under it the next two steps, and later
   `/maestro-update` and task worktrees, fail with `EPERM`. `maestro-sandbox-allow.cjs` lets
   exactly those Maestro commands run outside the sandbox. Run its dry run, which writes nothing:

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/maestro-sandbox-allow.cjs .
   ```

   It prints JSON with `sandboxEnabled`, `upToDate`, `entries` (each `kind`, `value`, `why`),
   `applyCommand`, `removeCommand` and a `herdr` object. The Bash sandbox hides the herdr binary
   unless `allowRead` lists it, so a failed `command -v herdr` never means herdr is not installed:
   read `herdr.inUse` (true when `HERDR_ENV=1` (`herdr.herdrEnv`), the herdr socket exists
   (`herdr.socketExists`), or a herdr entry is already in the project's sandbox settings
   (`herdr.settingsEntries`)) and `herdr.binary` instead of re-deriving them.

   - **`sandboxEnabled` is `false`:** skip this step silently, the herdr opt-in included.
   - **herdr opt-in, whenever `herdr.inUse` is `true` or `herdr.binary` is non-null** and the
     session is interactive. Read
     `herdr.present` from the dry run: when it is `true` every herdr entry is already in place (a
     hand-written `~` form counts), so don't ask, whatever `upToDate` says. Otherwise, when
     `herdr.binary` is null, first say *"herdr is running, but this project's sandbox can't see
     it"*, then ask **one `AskUserQuestion`**: *"Also let /maestro-manager start
     worker sessions in herdr by itself? This is a sandbox escape: any sandboxed command can then
     run anything unsandboxed through `herdr pane run`. Without it the manager prints the
     `claude -n ...` commands for you to run."* Options: `No (Recommended)`, `Yes, add the herdr
     entries`. No answer, a non-interactive install, or no herdr evidence at all all mean No. On Yes,
     run the dry run again with `--herdr` appended and use its output below: its `applyCommand`
     adds the herdr entries along with the rest. On a non-interactive install where herdr is in use
     but its binary is hidden, still print the message with the exact `--herdr` apply command
     (`applyCommand` with ` --herdr` appended) for the user to run with `!`.
   - **Not `upToDate` (in the run you are using):** show the user each entry of `entries` as
     `value` with its `why`, point to [`references/sandbox.md`](references/sandbox.md), and ask
     them to run `! <applyCommand>` themselves, the printed command verbatim. **Never run
     `--apply` yourself**: a sandboxed command can never write a settings file, and what runs
     outside the sandbox is the user's choice. Continue with step 6 whether or not they run it.
   - **`herdr.unparseableSettings` is non-empty:** tell the user which settings files do not parse
     and that `allowAllUnixSockets` was read as unset from them.
   - **`upToDate` and no herdr opt-in chosen:** say nothing about it.

6. **Scaffold and seed.** Run the installer in exactly this form, on one line, unquoted: the
   allow-list's `excludedCommands` entry matches this literal command text.

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/maestro-install.js . --impl-agents "backend,frontend" --project-tags "backend,frontend" --skill-map '{"frontend":["react"],"test":["react-testing-library"]}'
   ```

   If it fails with `EPERM` / "Operation not permitted" on `.claude/settings.json` or
   `.claude/skills/`, that is the sandbox: don't retry, give the user the same command prefixed
   with `!` to run themselves, and continue from its JSON output.

   `--ignore-mode "<committed|ignored>"` is the answer from step 1 (omit it, or pass `committed`, for the committed install; pass `ignored` for an ignored one, including when step 1 found `.claude` already ignored). The other three flags are optional and affect only a **fresh** seed. Omit `--skill-map` when empty, `--project-tags` when step 3 recorded nothing, `--impl-agents` only if step 2 genuinely couldn't decide (the seed then falls back to `backend`). The installer unions the skill map with what it reads from the tags store — the two add up rather than overriding — and intersects `--project-tags` against the live catalog itself, so this step's confirmation need not be perfectly in sync with the store.

   Idempotent. It:
   - installs the `maestro` skill at `.claude/skills/maestro/SKILL.md` — copied whole if absent, otherwise its plugin-owned managed regions (`Maestro:STEPS`, `Maestro:PRINCIPLES`) are re-synced while everything outside them, plus the rendered `Maestro:HANDOFFS` table, is preserved;
   - copies the runtime and hook scripts into `.claude/scripts/` (including `maestro-step1-gates.cjs` and `maestro-end-skills.cjs`, without which `/maestro` cannot run at all, and `lib/*.cjs`);
   - merges the Maestro hooks into `.claude/settings.json`, preserving other keys, and removes the retired `bash-validation.sh` hook and script an earlier release installed (`hooksRemoved`, `retiredScriptsRemoved`);
   - adds the permission allow rule `Write(/.claude/channels/**)` to `permissions.allow` in the same file (once; `permissionsAdded` lists it, empty on a re-run). It stops Claude Code's auto-mode classifier from judging subagents' handoff-payload writes into the project's `.claude/channels/`;
   - **first of all, in `ignored` mode:** appends `.claude/` (under a `# Maestro (added by maestro-install)` marker line, so uninstall can recognise it) to the clone-local git exclude file (`git rev-parse --git-path info/exclude`, correct for worktrees and submodules; the file and directory are created if missing, and nothing is added if `.claude/` is already ignored or the line is already there). That file is never committed. It is not a `.claudeignore` — Claude Code has none. If the project is not in a git repo the script refuses with `{"ok": false, "refused": "ignore-mode", "reason": ...}` having written nothing; relay `reason`;
   - in `committed` mode (the default) adds a `# Maestro` section to the repo-root `.gitignore` (`git rev-parse --show-toplevel`) with `**/.claude/maestro_session*` and `**/.claude/maestro_sessions/` globs, which match at any depth — so there is no per-project `.gitignore` to write. `ignored` mode never writes this block;
   - seeds `.claude/maestro.json` **only when absent**, and the shape of the seed is chain-dependent: an application chain (anything other than `infra` alone) gets the full six-workflow profile (`default`, `tdd`, `Refactor`, `Documentation`, `Review`, `Tests`) wired around the `--impl-agents` chain; a chain that is **exactly** `infra` gets a simpler three-workflow profile (`default`, `Documentation`, `Review`) with no `test`/`refactor` step at all — the infra agent runs its own format/validate/lint/plan-diff in place of a separate test pass, so there is nothing for `@test`/`@refactor` to do. Either way the skill map is attached as `referenced_skills` and the catalog-intersected tags stamped onto `project_tags`. An existing config is never re-seeded;
   - into an **existing** config, fills in only what is missing: a config without `start_skills` gets the fresh-seed defaults (`to_maestro_tasks`: `confidence-check` plus the design check when the project can invoke it), one without `end_skills` gets the empty default, and a leftover `gates` key is removed. A list that is already there — even an empty one — is never touched;
   - stamps `runtimeVersion` with the plugin's current version — the one other field it writes into an already-existing config.

   If the project's `.claude/maestro.json` is not valid JSON or not version 3, the script exits 1 with `{"ok": false, "refused": "config", "reason": ...}` and has written **nothing**. Relay `reason` to the user verbatim (they fix the file by hand or move it aside) and stop; do not retry or delete the file.

   On success it prints a JSON summary (`orchestratorSkill`, `installedOrchestratorSkill`, `hooksAdded`, `permissionsAdded`, `hooksRemoved`, `retiredScriptsRemoved`, `wroteRepoGitignore`, `ignoreMode`, `wroteGitExclude`, `gitExcludePath`, `seededConfig`, `skillListsSeeded`, `implAgents`, `projectTags`, `runtimeVersion`, `runtimeVersionUpdated`). It does **not** render the handoff table — that is step 7.

   `orchestratorSkill.action` says what happened to `SKILL.md`: `installed` (copied whole), `synced` (managed regions refreshed; `.regions` lists which), `unchanged`, or `migrated` — the installed skill predated the region markers, so it was backed up to `SKILL.md.bak` (path in `.backup`) and replaced. On `migrated`, **tell the user** and offer to re-apply any custom prose from the `.bak` file *outside* the managed regions before deleting it.

7. **Render the orchestrator's handoff table** from the config that now exists:

   ```bash
   node .claude/scripts/maestro-render-orchestrator.cjs
   ```

   This rewrites the `Maestro:HANDOFFS` region of `.claude/skills/maestro/SKILL.md` with one row per workflow and its derived success path. Run it **after** step 6 — the renderer reads `maestro.json`, and on a fresh install step 6 is what creates it. Report the workflow → success-path rows it produces.

8. **Offer herdr, once.** herdr is optional: it lets `/maestro-manager` start an epic's worker
   sessions in herdr tabs instead of the user opening each one. Use step 5's `herdr` object if it ran
   (otherwise run `command -v herdr` and check `HERDR_ENV`); a failed `command -v herdr` alone never
   means "not installed".
   - **In use or found** (`herdr.inUse` is `true` or `herdr.binary` is non-null): don't ask (step 5
     covers its sandbox opt-in). Mention it in step 9, and that `herdr integration install claude`
     is in the guide if they have not run it yet. When the binary is hidden, say *"herdr is running,
     but this project's sandbox can't see it"* and point to step 5's `--herdr` apply command.
   - **No evidence at all, interactive install:** ask **one `AskUserQuestion`**: *"Set up herdr, so
     /maestro-manager can start epic worker sessions for you? It is optional."* Options:
     `Show me how`, `Not now`. On `Show me how`, point to the guide,
     [`references/herdr.md`](references/herdr.md), and give its two commands, telling the user to
     run them themselves with `!` (they change things outside the project, so you never run them):
     `! curl -fsSL https://herdr.dev/install.sh | sh` and `! herdr integration install claude`.
     Under the sandbox, add that once herdr is installed `/maestro-update` offers its sandbox
     opt-in (the guide's step 3). On `Not now`, say nothing more about it: `/maestro-update` prints
     one reminder line and never asks again.
   - **Non-interactive install:** don't ask; mention the guide in one line in step 9.

9. **Confirm the install.** Summarise:
   - what happened to the orchestrator skill (`orchestratorSkill.action`, including a `migrated` backup) and whether any retired hook was removed (`hooksRemoved`);
   - whether `maestro.json` was seeded (`seededConfig`) and with which implementation chain, or was left alone;
   - when `skillListsSeeded` is not `null`, **say what it seeded** (`start_skills`, `end_skills` and/or removed `gates`) and that the lists can be changed on the Maestro desktop app's `/maestro` page, so the user is not surprised that `/to-maestro-tasks` now runs `confidence-check`;
   - the recorded project tags, **plural** — report the whole list (e.g. "tagged as `backend, frontend`"), never just one — or that none were recorded, editable afterward from `/maestro`;
   - the rendered success paths from step 7;
   - the sandbox allow-list from step 5, in one line: the `! <applyCommand>` still to run, or nothing when it was up to date or the sandbox is off;
   - the ignore mode (`ignoreMode`): for `ignored`, that `.claude/` is now in the clone-local `gitExcludePath` (`wroteGitExclude` says whether this run added it) and nothing was added to the committed `.gitignore`, so teammates see no Maestro files. The line sits under a `# Maestro (added by maestro-install)` marker, which is what lets `/maestro-uninstall --purge` remove exactly that line later (a `.claude/` entry the user wrote themselves is never touched);
   - that they invoke the orchestrator by running `/maestro`;
   - herdr, from step 8, in one line: found, or the guide at
     [`references/herdr.md`](references/herdr.md) if they want it later;
   - that the graph is edited in the **Maestro desktop app** (`/workflows` for the canvas, `/rules` for rule placement) or by hand-editing `maestro.json` then running `/maestro-update`; and that `/maestro-uninstall` removes Maestro.

   **Rules are not seeded.** The `rules` slice starts empty: placing rule files is `maestro-apply-rules.js`'s job and the desktop app's `/rules` route authors the assignments. A terminal-only user can hand-write `rules` entries and run that script directly.

## Notes

- **The seed is deterministic node, not prose.** `maestro-install.js` requires `lib/maestro-seed.cjs`, generated from `defaultV3Config` in `apps/maestro/src/core` — the same function the desktop app seeds with. Don't reproduce the graph in this prompt; a hand-written copy would drift the first time either changes.
- **Skills reach a subagent through the `SubagentStart` hook**, which matches `.*` and so covers custom agents too: it reads the active workflow from this session's own `maestro_sessions/<session_id>/session.json`, finds the instance matching the agent type, and injects that instance's `loaded_skills` / `referenced_skills` plus its `HANDOFF:` routing options. It exits silently when `maestro.json` is absent, not v3, or the agent is unmapped. Two instances of the same agent in one workflow get merged, so prefer one instance per agent type per workflow.
- Re-running `/maestro-install` is safe: scaffolding is idempotent, a present `maestro.md` is never overwritten, a present `maestro.json` is never re-seeded. To pick up plugin script updates, prefer `/maestro-update`.
- **This is not an editor.** It produces a starting graph, not the user's graph. Anything beyond the seed — adding a workflow, moving a node, promoting a skill to auto-loaded, assigning rules — is the canvas or a hand-edit plus `/maestro-update`.
- Instances are project-scoped and may appear in multiple workflows; the hook uses the active workflow from this session's own `maestro_sessions/<session_id>/session.json`. An unplaced instance is harmless.
