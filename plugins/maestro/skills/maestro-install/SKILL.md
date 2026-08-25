---
name: maestro-install
description: "Installs the Maestro orchestrator into this project from the terminal, with no desktop app required. Detects the implementation agent(s) from the repo, scaffolds the maestro skill + runtime scripts + settings (bash-validation hook) + gitignore, seeds .claude/maestro.json, and renders the orchestrator's handoff table. Use when the user runs /maestro-install, or asks to set up / scaffold / install the Maestro subagents workflow for this project. To edit the workflow graph visually afterwards, open the project in the Maestro desktop app (apps/maestro)."
---

# Maestro Install

One-time setup of Maestro for a project, entirely from a Claude session: scaffold the orchestrator, seed the config, render the handoff table. Nothing here needs the desktop app, a browser, or Docker.

```
maestro-install:  analyze repo → offer local skills → scaffold + seed → render → report
              (impl agents)   (best-fit + consent)   (maestro-install.js)  (maestro-render-orchestrator.cjs)
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

2. **Offer to attach the repo's local skills to the seeded agents.** This pre-populates the seeded instances so the user doesn't have to hunt for relevant skills. **Skip this step entirely** if `${CLAUDE_PROJECT_DIR:-.}/.claude/maestro.json` already exists — that's a re-install, and the existing config already owns the user's skill assignments (the seed only applies on a fresh install, and step 3 will not overwrite it).

   On a fresh install:
   - **Discover** the project-local skills: each subdirectory of `${CLAUDE_PROJECT_DIR:-.}/.claude/skills/` that contains a `SKILL.md` is one skill. A skill's **id is its directory name**, unless its `SKILL.md` has a frontmatter `name:` field, in which case that wins — this matches exactly how the canvas lists them (`name = frontmatter.name || directory`). **Many project skills are plain-Markdown docs with no YAML frontmatter at all — that is normal; do not skip them.** For relevance, read a short description from the frontmatter `description:` if present, otherwise from the SKILL.md's first heading / first sentence. Ignore user (`~/.claude`) and plugin skills — only the repo's own skills are in scope.

     List the directories with a command that tolerates missing frontmatter (do **not** pipe through `grep` for `name:`/`description:` — it exits non-zero and aborts the moment a skill has no frontmatter, which silently drops every doc-style skill). For example list the skill dirs, then `Read` each `SKILL.md` you need a description for:

     ```bash
     ls -1 "${CLAUDE_PROJECT_DIR:-.}/.claude/skills" 2>/dev/null
     ```

   - **Drop any skill already tagged** in the Maestro desktop app's Skills tab — `maestro-install.js` reads `~/.claude/maestro-skill-tags.sqlite` itself and wires a tagged skill to its matching agent(s) with no `AskUserQuestion` at all, *regardless* of what `--skill-map` in step 3 carries, so best-fit-guessing one is wasted work. Check which discovered skills are already covered before asking about any of them:

     ```bash
     node -e "
       try {
         const { readAllSkillTags } = require('${CLAUDE_SKILL_DIR}/../../scripts/lib/maestro-skill-tags.cjs');
         console.log(JSON.stringify(readAllSkillTags()));
       } catch { console.log('{}'); }
     "
     ```

     This never fails the install — an older `node` with no `node:sqlite`, or a store that's never been written to, just prints `{}` and every discovered skill falls through to best-fit below. A skill counts as covered only if at least one of its tags matches a seeded agent (the detected `implAgents` plus `test`/`reviewer`/`refactor`/`scribe`) — a `mobile` tag on a backend-only repo isn't a route anywhere and doesn't cover the skill.
   - **Best-fit map** the *remaining* (untagged, or tagged with nothing that matches a seeded agent) skills to the single seeded agent each most helps, choosing among the seeded agents only: the detected `implAgents` plus `test`, `reviewer`, `refactor`, `scribe`. **Drop** any skill that isn't clearly relevant to one of them (don't force a match). Example: a `react`/`styling`/`gantt-render` skill → `frontend`; a `react-testing-library` skill → `test`; a `changelog` skill → `scribe`.
   - Attached skills seed as **referenced** (available; the agent loads one only if the task calls for it), never as loaded. Promoting a skill to auto-loaded is a canvas edit.
   - **Confirm with the user.** First print the proposed mapping as a plain written list grouped by agent, one line per skill with a short why — **including** the already-tagged skills, so the user sees the whole picture even though they need no consent (the store already has one). Say so explicitly, e.g.:

     ```
     @frontend ← react, styling, gantt-render, shift-logic, workorder-store
     @test     ← react-testing-library
     @backend  ← db-migrations (already tagged; nothing to confirm)
     ```

     Then ask a **single `AskUserQuestion`** for consent on the best-fit-guessed skills only (do **not** put individual skills as the options — `AskUserQuestion` requires 2–4 options per question, so a per-skill checklist breaks the moment an agent has 1 or 5+ skills). Use coarse options like: `Attach all (Recommended)`, `Let me drop some`, `Skip — I'll assign on the canvas`. If the user picks "drop some", let them reply in plain text with the skill ids (or skill→agent pairs) to remove, and drop those. If **every** discovered skill was already tagged, or none of the untagged ones are relevant, skip the question silently — there's nothing left to ask about. This prompt only needs coarse consent — the desktop app's canvas is the fine-grained editor afterwards, and a hand-edit to `maestro.json` works too.
   - **Assemble the skill map**: a JSON object of `{ "<agent>": ["<skillId>", …] }` from the CONFIRMED best-fit mapping only — omit the already-tagged skills; `maestro-install.js` adds those itself from the tags store regardless of what this flag carries, so repeating them here would just be redundant, not wrong. Omit agents with no (best-fit) skills. Example: `{"frontend":["react","styling"],"test":["react-testing-library"]}`. If empty (nothing left after dropping the tagged ones), there's nothing to pass. Each `skillId` is the skill's canonical id from the discover step (frontmatter `name` if present, else the directory name) so it lines up with what the canvas lists.

3. **Scaffold and seed.** Run the installer, passing the detected implementation agents and (when non-empty) the best-fit skill map:

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-install.js" "${CLAUDE_PROJECT_DIR:-.}" \
     --impl-agents "backend,frontend" \
     --skill-map '{"frontend":["react"],"test":["react-testing-library"]}'
   ```

   Both flags are optional and affect only a **fresh** seed. Omit `--skill-map` when the map is empty; omit `--impl-agents` only if step 1 genuinely couldn't decide (the seed then falls back to `backend`). The installer unions this map with whatever it reads from the tags store itself — the two sources add up, they don't override each other.

   This is idempotent and:
   - installs the `maestro` skill at `<projectPath>/.claude/skills/maestro/SKILL.md` — copied whole if absent, otherwise its plugin-owned managed regions (`Maestro:STEPS`, `Maestro:PRINCIPLES`) are re-synced from the template while everything outside them, plus the rendered `Maestro:HANDOFFS` table, is preserved,
   - copies the runtime scripts (`maestro-set-session-workflow.cjs`, `maestro-render-orchestrator.cjs`, `bash-validation.sh`, `lib/maestro-session.cjs`, `lib/maestro-skill-regions.cjs`) into `<projectPath>/.claude/scripts/`,
   - merges the `bash-validation.sh` PreToolUse Bash hook into `<projectPath>/.claude/settings.json` (preserving other keys), so `.env` reads are blocked,
   - adds an `# Maestro` section to the repo-root `.gitignore` (`git rev-parse --show-toplevel`) ignoring every nested session file across the repo / monorepo via `**/.claude/maestro_session.json`, `**/.claude/maestro_session.log.jsonl`, and `**/.claude/maestro_session_tasks.json`. The `**/` globs match `.claude/` at any depth including the root, so there is no per-project `.claude/.gitignore` to write,
   - seeds `<projectPath>/.claude/maestro.json` **only when it is absent** — six ready-made workflows (`default`, `tdd`, `Refactor`, `Documentation`, `Review`, `Tests`) wired around the `--impl-agents` chain, with `--skill-map`'s skills attached to the matching instances as `referenced_skills`. An existing config is the user's own graph and is never re-seeded.

   It prints a JSON summary (`orchestratorSkill`, `installedOrchestratorSkill`, `setBashHook`, `wroteRepoGitignore`, `seededConfig`, `implAgents`). It does **not** render the skill's handoff table — that is step 4.

   `orchestratorSkill.action` says what happened to `SKILL.md`:
   - `installed` — no skill was present; the template was copied whole.
   - `synced` — managed regions refreshed from the template (`.regions` lists which).
   - `unchanged` — already in sync.
   - `migrated` — the installed skill predates the managed-region markers, so it could not be synced in place: it was copied to `.claude/skills/maestro/SKILL.md.bak` (path in `.backup`) and replaced with the current template. **Tell the user**, and offer to re-apply any custom prose from the `.bak` file *outside* the managed regions before deleting it.

4. **Render the orchestrator's handoff table** from the config that now exists:

   ```bash
   node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/maestro-render-orchestrator.cjs"
   ```

   This rewrites the `Maestro:HANDOFFS` region of `.claude/skills/maestro/SKILL.md` with one row per workflow and its derived success path. Run it **after** step 3 — the renderer reads `maestro.json`, and on a fresh install step 3 is what creates it. Report the workflow → success-path rows it produces.

5. **Confirm the install.** Summarise:
   - what happened to the orchestrator skill (`orchestratorSkill.action` — including a `migrated` backup if there is one) and whether the bash-validation hook was added to `settings.json`,
   - whether `maestro.json` was seeded (`seededConfig`) and with which implementation chain, or was left alone because the project already had one,
   - the rendered success paths from step 4,
   - that they invoke the orchestrator manually by running `/maestro`,
   - that the workflow graph is edited in the **Maestro desktop app** (`apps/maestro` — open the project, then `/workflows` for the canvas and `/rules` for rule placement), or by hand-editing `maestro.json` and running `/maestro-update`; and that `/maestro-uninstall` removes Maestro.

   **Rules are not seeded.** The `rules` slice starts empty and this skill does not populate it: placing rule files is `maestro-apply-rules.js`'s job and the desktop app's `/rules` route is what authors the assignments. A terminal-only user can still hand-write `rules` entries into `maestro.json` and run that script directly.

## Hook contract (SubagentStart)

`maestro-inject-agent-context.js` runs on `SubagentStart` for **every** subagent (the hook matcher is `.*`), so custom user/project/plugin agents mapped on the canvas get injected too, not just the bundled workers. It receives `agent_type` and `cwd` from stdin, then:

1. Reads `<cwd>/.claude/maestro_session.json` to find the active workflow name (set by `maestro-set-session-workflow.cjs`).
2. Reads `<cwd>/.claude/maestro.json` (requires `version: 3`).
3. Finds workflow nodes whose resolved instance's `agent === agent_type`.
4. Emits `hookSpecificOutput { hookEventName: "SubagentStart", additionalContext }` listing the instance's skills in two blocks — `loaded_skills` (auto-load with the `Skill` tool before working) and `referenced_skills` (available; load only if the task involves the logic that skill describes) — plus the condition-edge labels. When a condition edge exists, the subagent is told to end its final message with a `HANDOFF: <label>` line (or `HANDOFF: success`) so the orchestrator can route deterministically.

If `maestro.json` is absent, not v3, or the agent type is unmapped (no matching instance in any workflow), the hook exits silently.

If the active workflow can't be resolved — the recorded name matches no workflow, or none is set while the project has more than one workflow — the hook still injects (unioned across all workflows) but **prepends a `⚠️ Maestro warning`** to the context telling the orchestrator to run `maestro-set-session-workflow.cjs` first, since the unioned skills may be wrong.

Known limitation: if two instances of the same agent appear in one workflow, the hook can only key off `agent_type` and merges (unions) both instances' skills and conditions (a skill that is `loaded` in either instance wins over being merely `referenced`). Prefer one instance per agent type per workflow.

## Notes

- **The seed is deterministic node, not prose.** `maestro-install.js` requires `lib/maestro-seed.cjs`, generated from `defaultV3Config` in `apps/maestro/src/core` — the same function the desktop app seeds a fresh canvas with. Don't reproduce the graph in this prompt; a hand-written copy would drift from the app's the first time either changes.
- Re-running `/maestro-install` is safe: scaffolding is idempotent, a present `maestro.md` is never overwritten, and a present `maestro.json` is never re-seeded. To pick up plugin script updates on an installed project, prefer `/maestro-update`.
- **This is not an editor.** It produces a starting graph, not the user's graph. Anything beyond the seed — adding a workflow, moving a node, promoting a skill to auto-loaded, assigning rules — is the desktop app's canvas or a hand-edit followed by `/maestro-update`.
- Instances are project-scoped and may appear in multiple workflows; the hook uses the active workflow from `maestro_session.json`. An unplaced instance is harmless.
