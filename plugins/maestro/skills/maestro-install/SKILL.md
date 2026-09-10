---
name: maestro-install
description: "Installs the Maestro orchestrator into this project from the terminal, with no desktop app required. Detects the implementation agent(s) from the repo, scaffolds the maestro skill + runtime scripts + settings (bash-validation hook) + gitignore, seeds .claude/maestro.json, and renders the orchestrator's handoff table. Use when the user runs /maestro-install, or asks to set up / scaffold / install the Maestro subagents workflow for this project. To edit the workflow graph visually afterwards, open the project in the Maestro desktop app (apps/maestro)."
---

# Maestro Install

One-time setup of Maestro for a project, entirely from a Claude session: scaffold the orchestrator, seed the config, render the handoff table. Nothing here needs the desktop app, a browser, or Docker.

```
maestro-install:  analyze repo → confirm project tags → offer local skills → scaffold + seed → render → report
              (impl agents)    (catalog + consent)     (best-fit + consent)  (maestro-install.js)  (maestro-render-orchestrator.cjs)
```

**When to prefer the desktop app.** `apps/maestro`'s `/install` route does the same install without a session, and its `/workflows` canvas is the only comfortable way to *edit* the graph — this skill seeds a sensible starting graph, it does not let you draw one. Use this skill when there is no desktop app on the machine, or when the user is already in a terminal and wants Maestro on without leaving it.

## User's intention

$ARGUMENTS

## Workflow

1. **Analyze the repository to pick the implementation agent(s).** Inspect the project to decide which bundled agent(s) build the application code in the seeded workflows' happy path. Read `package.json` (plus framework configs and directory layout — `src/components`, `src/routes`, `server/`, `api/`, `requirements.txt`, `go.mod`, `Cargo.toml`, etc.) and classify:
   - **Backend** (APIs, services, DB access, no UI framework) → `backend`
   - **Frontend** (React/Vue/Svelte/Angular/Next/etc., web UI-focused) → `frontend`
   - **Mobile** (Expo / React Native — `expo` or `react-native` in `package.json` dependencies, an `app.json`/`app.config.{js,ts}` with an `expo` key, or an `App.tsx`/`app/` tree with no web bundler) → `mobile`
   - **Fullstack** (a UI framework — web or mobile — *and* server/API code) → `backend,frontend` or `backend,mobile` — the happy path's implementation step becomes `@backend → @frontend` (or `@backend → @mobile`)
   - **Other non-web** (CLI, library, data pipeline, …) → there is no obvious bundled implementation agent. **Ask the user** which agent(s) they use to implement code. If none is suitable, suggest they run `/create-subagent` to make one, then re-run `/maestro-install`.

   The result is a comma-separated `implAgents` list (e.g. `backend`, `frontend`, `mobile`, or `backend,mobile`). This only sets the *starting* graph — the user can rewire it later in the desktop app's canvas or by hand-editing `maestro.json`.

2. **Confirm the project tags.** A project can carry several, so this is a multi-select decision throughout, never a pick-one. These are the categories the desktop app's `/templates` → Project Tags tab edits, and what auto-adds a matching bundled agent later.

   **Skip this step entirely on a re-install** (`${CLAUDE_PROJECT_DIR:-.}/.claude/maestro.json` already exists) — the seed only applies to a fresh install, and an existing config's `project_tags` is the user's own.

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

   - **Split step 1's detected `implAgents` against that catalog** — this direction only. The catalog is never read to decide what the repo *is*; `detect.ts`'s signal tables are the sole source of evidence.
     - `detectedInCatalog` — detected categories the catalog already has. Step 1 established them, so they are the recommended answer, named in the question text.
     - `detectedNotInCatalog` — a detected category the catalog has never held. The catalog only grows by an explicit add, never by re-seeding an existing machine, so this is what happens the day a new detection category ships to a machine that seeded earlier.

   - **Confirm with one `AskUserQuestion`** — the detected set and any add-offer go in the *same* question, never a second one.
     - **Catalog ≤4 entries** → a single **multiSelect**, where **what the user checks is exactly what gets recorded**. `AskUserQuestion` cannot pre-tick an option, so never write a question whose options mean different things depending on whether they are ticked — "included unless you remove it" reads as both "tick to keep" and "tick to drop", and the user cannot tell which. Ask it plainly instead: *"Which tags should this project carry? Detection found `backend, frontend` — check those to keep them, and check any other that applies. A project can carry more than one."* List every catalog entry, described `(detected)` or `(not detected)`. An empty answer means no tags, not the detected set.
       - For each `detectedNotInCatalog` category, add one more option: `Add "<category>" to the catalog and tag this project with it`, its description saying step 1 detected it but the catalog has never held it. Declining leaves the catalog untouched.
     - **Catalog >4 entries** → `AskUserQuestion` caps options at 4, so fall back to coarse consent: `Use the detected tags (backend, frontend) as-is (Recommended)`, `Customize — add or remove tags`, `Skip — I'll tag it on /maestro afterward`. Mention any `detectedNotInCatalog` category in the Customize description. If they customize, accept a **plain-text, comma-separated reply naming every tag that should end up recorded** — say so explicitly ("reply with the full list, e.g. `backend, frontend, data` — more than one is expected"), because a freeform reply *replaces* the detected set rather than adding to it.
     - Empty catalog → skip the question silently. (Reading it above self-seeds it, so this is theoretical.)

   - **Assemble the result.** If the user accepted an add-offer, add the category for real **before** step 4, so the installer's own intersection sees a live entry instead of dropping it:

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

3. **Offer to attach the repo's local skills to the seeded agents.** This pre-populates the seeded instances so the user doesn't have to hunt. **Skip this step entirely** if `${CLAUDE_PROJECT_DIR:-.}/.claude/maestro.json` already exists — the existing config owns the user's skill assignments.

   On a fresh install:

   - **Discover project skills across the whole tree, not just the root.** A skill is any directory containing a `SKILL.md` under some `.claude/skills/`, and in a monorepo most of them live beside the code they describe (`apps/<app>/.claude/skills/`), not at the repository root. Reading only the root's is how an agent ends up seeded with no skills at all. `maestro-install.js` walks the whole tree for `skills_available`; match it here so the best-fit map covers the same set:

     ```bash
     find "${CLAUDE_PROJECT_DIR:-.}" \
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

     Never fails the install — `{}` just means every skill falls through to best-fit. A skill counts as covered only if one of its tags matches a *seeded* agent (the detected `implAgents` plus `test`/`reviewer`/`refactor`/`scribe`); a `mobile` tag on a backend-only repo routes nowhere.

   - **Best-fit map the remaining skills** to the single seeded agent each most helps, choosing among seeded agents only. **Drop** anything not clearly relevant — don't force a match. A `react`/`styling` skill → `frontend`; `react-testing-library` → `test`; `changelog` → `scribe`.

   - **Confirm with the user.** Print the proposed mapping grouped by agent, one line per skill with a short why, **including** the already-tagged ones so the user sees the whole picture — saying they need no consent:

     ```
     @frontend ← react, styling, gantt-render, shift-logic, workorder-store
     @test     ← react-testing-library
     @backend  ← db-migrations (already tagged; nothing to confirm)
     ```

     Then ask **one `AskUserQuestion`** for consent on the best-fit guesses only. **Do not make individual skills the options** — `AskUserQuestion` requires 2–4 options, so a per-skill checklist breaks the moment an agent has 1 or 5+ skills. Use coarse options: `Attach all (Recommended)`, `Let me drop some`, `Skip — I'll assign on the canvas`. On "drop some", take a plain-text reply of skill ids (or skill→agent pairs). If every skill was already tagged, or none of the rest is relevant, skip the question silently.

   - **Assemble the skill map**: `{ "<agent>": ["<skillId>", …] }` from the confirmed best-fit mapping only — omit already-tagged skills (the installer adds those itself) and agents with no skills. Attached skills seed as **referenced** (loaded only if the task calls for it), never as loaded; promoting one is a canvas edit.

4. **Scaffold and seed.**

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-install.js" "${CLAUDE_PROJECT_DIR:-.}" \
     --impl-agents "backend,frontend" \
     --project-tags "backend,frontend" \
     --skill-map '{"frontend":["react"],"test":["react-testing-library"]}'
   ```

   All three flags are optional and affect only a **fresh** seed. Omit `--skill-map` when empty, `--project-tags` when step 2 recorded nothing, `--impl-agents` only if step 1 genuinely couldn't decide (the seed then falls back to `backend`). The installer unions the skill map with what it reads from the tags store — the two add up rather than overriding — and intersects `--project-tags` against the live catalog itself, so this step's confirmation need not be perfectly in sync with the store.

   Idempotent. It:
   - installs the `maestro` skill at `.claude/skills/maestro/SKILL.md` — copied whole if absent, otherwise its plugin-owned managed regions (`Maestro:STEPS`, `Maestro:PRINCIPLES`) are re-synced while everything outside them, plus the rendered `Maestro:HANDOFFS` table, is preserved;
   - copies the runtime and hook scripts into `.claude/scripts/` (including `maestro-step1-gates.cjs`, without which `/maestro` cannot run at all, and `lib/*.cjs`). `maestro-concept-skills.cjs` is deliberately **not** among them — the concept-skill flows call it from `${CLAUDE_PLUGIN_ROOT}/scripts/`, so a project copy would only go stale;
   - merges the `bash-validation.sh` PreToolUse Bash hook into `.claude/settings.json`, preserving other keys, so `.env` reads are blocked;
   - adds a `# Maestro` section to the repo-root `.gitignore` (`git rev-parse --show-toplevel`) with `**/.claude/maestro_session*` globs, which match at any depth — so there is no per-project `.gitignore` to write;
   - seeds `.claude/maestro.json` **only when absent** — six workflows (`default`, `tdd`, `Refactor`, `Documentation`, `Review`, `Tests`) wired around the `--impl-agents` chain, with the skill map attached as `referenced_skills` and the catalog-intersected tags stamped onto `project_tags`. An existing config is never re-seeded;
   - stamps `runtimeVersion` with the plugin's current version — the ONE field it writes into an already-existing config.

   It prints a JSON summary (`orchestratorSkill`, `installedOrchestratorSkill`, `setBashHook`, `wroteRepoGitignore`, `seededConfig`, `implAgents`, `projectTags`, `runtimeVersion`, `runtimeVersionUpdated`). It does **not** render the handoff table — that is step 5.

   `orchestratorSkill.action` says what happened to `SKILL.md`: `installed` (copied whole), `synced` (managed regions refreshed; `.regions` lists which), `unchanged`, or `migrated` — the installed skill predated the region markers, so it was backed up to `SKILL.md.bak` (path in `.backup`) and replaced. On `migrated`, **tell the user** and offer to re-apply any custom prose from the `.bak` file *outside* the managed regions before deleting it.

5. **Render the orchestrator's handoff table** from the config that now exists:

   ```bash
   node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/maestro-render-orchestrator.cjs"
   ```

   This rewrites the `Maestro:HANDOFFS` region of `.claude/skills/maestro/SKILL.md` with one row per workflow and its derived success path. Run it **after** step 4 — the renderer reads `maestro.json`, and on a fresh install step 4 is what creates it. Report the workflow → success-path rows it produces.

6. **Confirm the install.** Summarise:
   - what happened to the orchestrator skill (`orchestratorSkill.action`, including a `migrated` backup) and whether the bash-validation hook was added;
   - whether `maestro.json` was seeded (`seededConfig`) and with which implementation chain, or was left alone;
   - the recorded project tags, **plural** — report the whole list (e.g. "tagged as `backend, frontend`"), never just one — or that none were recorded, editable afterward from `/maestro`;
   - the rendered success paths from step 5;
   - that they invoke the orchestrator by running `/maestro`;
   - that the graph is edited in the **Maestro desktop app** (`/workflows` for the canvas, `/rules` for rule placement) or by hand-editing `maestro.json` then running `/maestro-update`; and that `/maestro-uninstall` removes Maestro.

   **Rules are not seeded.** The `rules` slice starts empty: placing rule files is `maestro-apply-rules.js`'s job and the desktop app's `/rules` route authors the assignments. A terminal-only user can hand-write `rules` entries and run that script directly.

## Notes

- **The seed is deterministic node, not prose.** `maestro-install.js` requires `lib/maestro-seed.cjs`, generated from `defaultV3Config` in `apps/maestro/src/core` — the same function the desktop app seeds with. Don't reproduce the graph in this prompt; a hand-written copy would drift the first time either changes.
- **Skills reach a subagent through the `SubagentStart` hook**, which matches `.*` and so covers custom agents too: it reads the active workflow from `maestro_session.json`, finds the instance matching the agent type, and injects that instance's `loaded_skills` / `referenced_skills` plus its `HANDOFF:` routing options. It exits silently when `maestro.json` is absent, not v3, or the agent is unmapped. Two instances of the same agent in one workflow get merged, so prefer one instance per agent type per workflow.
- Re-running `/maestro-install` is safe: scaffolding is idempotent, a present `maestro.md` is never overwritten, a present `maestro.json` is never re-seeded. To pick up plugin script updates, prefer `/maestro-update`.
- **This is not an editor.** It produces a starting graph, not the user's graph. Anything beyond the seed — adding a workflow, moving a node, promoting a skill to auto-loaded, assigning rules — is the canvas or a hand-edit plus `/maestro-update`.
- Instances are project-scoped and may appear in multiple workflows; the hook uses the active workflow from `maestro_session.json`. An unplaced instance is harmless.
