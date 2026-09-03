# maestro (desktop)

The Maestro desktop app is an Electron shell over the node-side Maestro logic in `src/core/`. It
opens a project folder, edits and saves the full Maestro config with **no Claude session in the
loop** for a save, and live-tails the session log the Claude Code hooks write. It also owns the
`/tools` dashboard and `/docs` documentation reader, and can run Claude itself — either as a
one-shot confirmed run (create-\* forms, `/maestro-tasks`) or as a live, multi-turn session in a
right-hand pane.

## Architecture docs live in `.claude/skills/`

Seven of them — the long-form reference; this file is the short one.

| Skill                        | Covers                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `maestro-architecture`       | the **runtime** — install pipeline, orchestrator + hook lifecycle, the four config/state files, the HANDOFF routing contract |
| `workflow-view`              | `/workflows` — the React Flow canvas and how the diagram maps to `maestro.json`                                              |
| `rule-view`                  | `/rules` — the two rule selectors, the directory tree, and how a save moves rule files                                      |
| `agents-view`                | `/agents` — the three panes, the one edit session that fans out to six write paths, the skill chips |
| `log-view`                   | `/session-log` — the three panes, how entries become instances, and how the hooks write the log it reads                     |
| `create-skills-architecture` | the four `create-*` flows — scaffold, confirmation dialog, consuming prompts                                                 |
| `updating-maestro`           | how a runtime change actually reaches a project, on either delivery path                                                     |

## Process layout

```
src/core/      ALL node-side Maestro logic, framework-free. No React, no Electron.
src/main/      electron. Owns the project state, the log tail, the pane session, the IPC handlers.
src/preload/   the contextBridge. The ONLY path from renderer to node.
src/renderer/  a TanStack Router SPA. No node imports at all.
src/shared/    ipc.ts — the typed channel contract, imported by all three.
```

`src/main/ipc.ts` is a list of thin adapters over `src/core/`; the logic is tested under
`test/core/` with no Electron runtime, which is what keeps a 200-test suite running in about a
second.

## `src/core/` — the node side

| Module                                  | What it owns                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------- |
| `types.ts`                              | The `MaestroConfigV3` model persisted at `<project>/.claude/maestro.json`              |
| `contracts.ts`                          | Every type that crosses a process boundary. **Renderer-safe** — interfaces only        |
| `text.ts`                               | Pure string helpers. **Renderer-safe** — the ONE home; `utils/text.ts` re-exports it   |
| `success-path.ts`                       | Success-path derivation, node labels, agent→skill resolution (pure)                    |
| `skill-regions.ts`                      | Managed/rendered region markers in the orchestrator `SKILL.md` (pure)                  |
| `config.ts`                             | Read / merge-slice / write of `maestro.json`                                           |
| `render.ts`                             | Rewrites the `Maestro:HANDOFFS` table from `maestro.json`                              |
| `save.ts`                               | The three-step save the `config:save` channel is a wrapper around                      |
| `seed.ts` / `label-layout.ts`           | The starter workflows an unconfigured project opens with (pure)                        |
| `detect.ts`                             | Which implementation agent(s) the repo needs, and the evidence for it                  |
| `discovery.ts` / `fs-scan.ts`           | The agents, skills, rules and directory tree a project can pick from                   |
| `concept-skills.ts`                     | The project's concept skills — the `.claude/skills/*` whose frontmatter `metadata.type` is `concept-skill`, which explain its core concepts to agents. `metadata` is the Agent Skills spec's home for third-party data and one of the six fields that survive a claude.ai upload / `package_skill.py`; an invented top-level key is a HARD ERROR on those paths, so this must never move out of `metadata`, and it must be read with `parseFrontmatterMetadata` — `parseFrontmatter` flattens nesting and cannot tell `metadata.version` from a top-level `version`. Discovery walks EVERY `.claude/skills` in the tree (`skillSearchDirs` in `fs-scan.ts`), unlike `discoverSkills`, which reads one. Owns the `major.minor` arithmetic, the in-place frontmatter stamp, and the repo-level record at `<project>/.claude/concept-skills.json` — its own file, NOT a block on `maestro.json`, because concept skills are a plain `.claude/skills` convention and a repo must be able to keep a reconciled list of them with Maestro nowhere in sight. `readAgentsAvailable` is the one function here that still reads `maestro.json`, since nothing else knows what agents a project runs. Driven from `plugins/maestro/scripts/maestro-concept-skills.cjs` by the three `/…-concept-skill(s)` flows |
| `skill-tags.ts`                         | A skill's backend/frontend/mobile/refactor/reviewer/scribe/test tags — global, keyed by skill id, in `~/.claude/maestro-skill-tags.sqlite` (`node:sqlite`, not a native module). `skillMapFromTags` is the pure tags→`SkillMap` lookup both `data:workflows`/`data:reseed` and `/maestro-install`'s terminal path converge on. `parseSkillTagsBlock`/`applySkillTagsBlock` are the "Update skill tags" pane flow's other half — see `claude-session.ts` |
| `install.ts` / `uninstall.ts`           | Installs the runtime into a project, reports staleness, removes it                     |
| `sync-decision.ts`                      | The ONE materialize / refresh / skip-as-customized / never-touched rule (pure, no `fs`). Lifted out of `report-sync.ts` by `031` so the report path and the forked-agent path cannot drift — the caller answers "what is the hash over" and "has the template moved" and this answers the verdict |
| `agent-fork.ts` / `agent-fork-record.ts` | Forking a global-tier agent into the project, and the `agent-forks.json` provenance sidecar. Split so the sidecar + frontmatter arithmetic reach the plugin bundle WITHOUT `node:sqlite`, which `copyAgentAttributeRows` drags in |
| `agent-sync.ts`                         | Whether each forked agent is still in step with its template. `computeAgentSync` READS ONLY — it runs on project selection and writes nothing to `.claude/agents/`; `applyAgentSync` is the one writer, for one explicit update / keep / detach |
| `diff.ts`                               | A line diff (pure), so the `/agents` review card and the `maestro`/`maestro-update` skills render the same array |
| `hook-arbitration.ts`                   | Which copy of a hook runs when the plugin and a project-local install both register it |
| `session-runtime.ts` / `session-log.ts` | Ephemeral session file, append-only log, the tail                                      |
| `claude-cli.ts`                         | Where the `claude` CLI is, decided with `fs` and not with PATH alone                   |
| `claude-preview.ts`                     | Builds the prompt and issues a token. **Cannot spawn**                                 |
| `claude-tokens.ts`                      | The single-use, expiring, purpose-tagged authorisation between preview and run         |
| `claude-run.ts`                         | The only module that starts Claude, and only for a token preview issued                |
| `read-scope.ts`                         | What a run can **read**, derived from a settings snapshot. Pure — no `fs`, no spawn    |
| `write-scope.ts`                        | What a run may **write**, decided per tool call. Pure — no `fs`, no spawn, no SDK      |
| `session-scope.ts`                      | What a pane session may **read** — the boundary, and what a person may grant. Pure     |
| `session-permission.ts`                 | Settled, or a question for a PERSON. Composes the two scope modules. Pure              |
| `session-handoff.ts`                    | What a create-\* handoff says to the session it opens: seed, notice, title. Pure       |
| `permission-registry.ts`                | The parked promises — one per outstanding ask, idempotent, denied on every exit        |
| `session-question.ts`                   | A structured question, read out of the tool call and answered back into it. Pure       |
| `session-budget.ts`                     | What a session may spend, and every sentence it says about having spent it. Pure       |
| `session-resume.ts`                     | Which stored conversations may be offered, and what picking one up costs. Pure         |
| `agent-sdk.ts`                          | The ONLY importer of the Agent SDK: child env, the session, and the `SettingsPort`     |
| `ccusage.ts`                            | Usage stats — resolve `ccusage`, preview the command, run the previewed one            |
| `marketplaces.ts`                       | The user's local plugin marketplaces, read from `~/.claude/` at call time (`{includeRemote: true}` widens to every globally-registered marketplace, for `/tools`' Marketplace tab) |
| `global-docs.ts`                        | The two fixed doc corpora for the global `/docs` reader — the Maestro app's own end-user docs and the repo's Claude Code concept docs — regardless of which project is open |
| `scaffold.ts`                           | The deterministic half of the four create-\* flows, all-or-nothing                     |
| `git.ts`                                | `git init` + the first commit, via `execFile` and never a shell. A `GitPort`           |
| `repo.ts`                               | Is a directory inside a repository? Asked with `fs`, so it holds with no `git`         |
| `tasks.ts`                              | The `/maestro-tasks` queue                                                             |
| `plugins.ts` / `curated.ts`             | Installed plugins, the project's own marketplace, and the curated marketplaces' cache  |
| `commands.ts` / `docs.ts`               | The CLI command table parsed out of `docs/claude-code.md`; the docs reader's node side |
| `plugin-entries/`                       | esbuild entry points for the plugin's generated CJS libs — see below                   |

Every path in these modules is joined onto the **open project**, never `process.cwd()`, which is
what lets the app's views (`/tools`, `/docs`, `/rules`, …) work against a project that is not this
repo.

### Generated plugin libs — **do not hand-edit**

```bash
pnpm --filter maestro build:plugin-libs
```

Bundles `src/core/plugin-entries/*.ts` to CJS and writes them over every `.cjs` in
`plugins/maestro/scripts/lib/` **except `maestro-tasks.cjs`** — one per entry in
`build-plugin-libs.mjs`'s `entries` array, which is the list:

- `maestro-session.cjs`, `maestro-skill-regions.cjs`, `maestro-seed.cjs`
- `maestro-skill-tags.cjs`, `maestro-report-defaults.cjs`, `maestro-project-tags.cjs`,
  `maestro-agent-project-tags.cjs`, `maestro-agent-types.cjs`
- `maestro-concept-skills.cjs`
- `maestro-agent-sync.cjs` — forked-agent staleness (`031`), behind `maestro-agent-forks.cjs`

**Those files are generated. Do not hand-edit them** — edit the TypeScript source and re-run
the build. They are committed because a project installs them by file copy, so they must exist in
the repo rather than being produced at install time. (`lib/maestro-tasks.cjs` in the same directory
is _not_ generated; it is hand-written and has no banner.)

This script is load-bearing and **fails quietly**: if it stops producing correct output, the
committed `.cjs` files keep working and every test keeps passing — the symptom is that an edit to
`success-path.ts` stops reaching the plugin and the hooks go on running the old behaviour. So after
touching it, read `git diff plugins/maestro/scripts/lib/` rather than trusting a green
suite. Two of its settings exist for exactly that reason and are not incidental:

- **`absWorkingDir`** — esbuild stamps a `// <path>` comment above each bundled module, relative
  to its working directory, so the output depends on where the build was launched from.
- **`tsconfig`** — esbuild walks up from the entry point to find one, and `strict` there is what
  makes it emit `"use strict";` at the top of a CJS bundle. `apps/maestro/tsconfig.json` is a
  solution file (`files: []`, references only), so `absWorkingDir` must resolve to a config that
  actually sets `strict`, or the bundles silently come out non-strict.

The export surface of each bundle must stay a **superset** of what the hook scripts `require()` —
adding an export is safe, renaming or removing one breaks a script running outside this workspace;
`test/core/parity.test.ts` asserts the original name lists are still all there.

`src/shared/ipc.ts` is the typed channel contract between the three processes. Types that cross the
boundary come from `src/core/contracts.ts`, **not** `src/core/index.ts`. The barrel re-exports `fs`
and `child_process`; importing a type from it pulls all of that into the renderer's type graph.
`contracts.ts` is interfaces only.

The **src/core boundary** block in `test/isolation.test.ts` resolves every specifier under
`src/{shared,preload,renderer}` on the filesystem and fails on anything that lands in `src/core`
other than `contracts` or `text`. It names the file and the module it found.

## The save path

`config:save` → `saveConfig()` in `src/core/save.ts`:

1. merge the edited slice into `maestro.json` and write it (2-space indent, **no trailing
   newline** — preserved so existing repos show no spurious diff);
2. re-render the orchestrator's `Maestro:HANDOFFS` table from it;
3. apply the rule assignments (move project rules, `vibe-rules load` installable ones).

The `SaveResult` carries the rendered success paths and the rule summary, so the toast reports
what actually changed on disk.

## Form architecture (the four create-\* routes)

All four follow one pattern:

- **State**: `react-hook-form` + `zod` (via `@hookform/resolvers/zod`). The schema lives at the top
  of the route file; the inferred type drives `useForm<T>`.
- **UI primitives**: `@repo/ui` — `Button`, `Field`, `Input`, `Textarea`, `ChipInput`, `Select`,
  `ModePill`, `ThemeToggle`, `ShortcutsDialog`, `FilePreview`, `SyntaxLine`. Icons from
  `lucide-react`.
- **Layout**: split pane — form left, live `FilePreview` right showing the file that will be
  generated. Per-route preview components compose `FilePreview` with their own `lines: string[]`.
- **Submit feedback**: the window is long-lived and the user creates repeatedly, so a form is never
  replaced by a terminal success view. Each submit fires a `toast` (`@repo/ui/toast`) and the route
  stays mounted; the create forms `reset()` for the next artifact.
- **Keyboard shortcuts**: ⌘N (jump to field), ⌘↵ (submit), `?` (help), Esc (close). The map lives in
  the route and is rendered by `create-shell.tsx`.
- **`target` toggle (skill & subagent only)**: a second `ModePill` picks `marketplace` or `project`.
  In project mode the marketplace/plugin selectors are hidden and the file is written under
  `<projectRoot>/.claude/`.

### Adding a route / form

1. Create `src/renderer/src/routes/<name>.tsx` mirroring `create-plugin.tsx` (no mode) or
   `create-skill.tsx` (auto/manual + target). Define the zod schema, wire `useForm` + `Controller`,
   render with `Field`/`Input`/`Select`/`ChipInput` from `@repo/ui`, and wrap it in `create-shell`.
2. Add a `scaffold<X>` function to `src/core/scaffold.ts` and a prompt builder to
   `claude-preview.ts`. Both must resolve the path through `resolveCreateTarget`.
3. Create the preview component under `src/renderer/src/components/`.
4. Add the channel to `src/shared/ipc.ts` and the handler to `src/main/ipc.ts` — the renderer must
   never touch `fs`.
5. Write the consuming prompt at `plugins/maestro/skills/<name>/SKILL.md`, documenting the
   payload shape and the file(s) Claude should finish.

A create-\* route is reached from the **Create** link at the bottom of its matching `/tools` tab
(`components/tabs/create-link.tsx`), not from a top-bar menu, and its prompt reaches Claude through
the Claude bridge below.

## What still requires Claude Code

The **runtime** half — hook scripts that fire inside a session: `maestro-inject-agent-context`
(SubagentStart), `maestro-subagent-log` (SubagentStart/Stop), `maestro-session-log` (PreToolUse),
`maestro-validate-tasks` (PostToolUse), `maestro-session-cleanup` (SessionEnd),
`maestro-set-session-workflow.cjs`, `bash-validation.sh`.

They need a session to _run_, but not to be **installed**: `/maestro` (the desktop app route,
formerly `/install`) copies them into `<project>/.claude/scripts/` and registers them in the
project's own `.claude/settings.json`
(`installRuntime()` in `src/core/install.ts`). Project-local registration exists because the
plugin's `${CLAUDE_PLUGIN_ROOT}` hooks resolve into a version-keyed marketplace cache, so runtime
fixes shipped without a `plugin.json` bump never reach an installed project.

The split is the one the `maestro-architecture` skill already draws, at `maestro.json`.

## Routes

| Route                                                                        | Purpose                                                                                                                                                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/`                                                                          | Project picker + recent projects. Its own nav bar also links straight to the global `/docs` and `/tools`, alongside the hamburger. Opening or switching to a project here goes straight to `/maestro`. |
| `/workflows`                                                                 | React Flow canvas. Writes the workflow slice. On an unconfigured project it also shows the detected implementation chain, its evidence, and chips to correct it. |
| `/skills`                                                                    | Every skill this project, this machine, or an installed plugin makes available, tagged inline (`skill-tags.ts`). **Update skill tags** hands a description-only table off to the session pane, which proposes descriptions/tags and reports tag changes back through a fenced block `claude-session.ts` applies. Split out of `/tools`' old Skills tab. |
| `/rules`                                                                     | Assign rules to the project root / directories. Writes the rules slice.                                                                                          |
| `/session-log`                                                               | Live view of `maestro_session.log.jsonl`.                                                                                                                        |
| `/maestro-tasks`                                                             | The queue `/to-maestro-tasks` wrote. **Run with Claude** previews the invocation, confirms it, and streams it.                                                    |
| `/maestro`                                                                   | The project's own landing page (opening a project from `/` lands here). Install / update / remove the project's Maestro runtime, and say what changed on disk — always for the app's CURRENT project, with no `ProjectSelect` of its own. |
| `/project-docs`, `/project-docs/$slug`                                      | The documentation reader over the open project's own `docs/`, with per-heading search that deep-links and highlights. (Formerly `/docs`.)                        |
| `/docs`, `/docs/$group/$slug`                                                | A **global** documentation reader, unrelated to the open project: `group` is `"app"` (Maestro's own end-user docs, `apps/maestro/docs/app/*.md`) or `"claude-code"` (the repo-root `docs/*.md`, synced into a packaged build by `scripts/sync-claude-docs.mjs`). Carries a "Discuss with Claude" action that opens the session pane with the `maestro-help` skill loaded. |
| `/create-skill`, `/create-subagent`, `/create-plugin`, `/create-marketplace` | The four creation forms, reached from a **Create** link at the bottom of `/skills` (create-skill) or the matching `/tools` tab (Agents/Plugins/Marketplace), not from a top-bar menu. Split-pane: form left, live file preview right. |
| `/tools`                                                                     | Tabbed dashboard: **Plugins**, **Marketplace** (globally-registered marketplaces, plus the project's own as a secondary section), **Usage Stats**, **Curated Tools**, **Rules** (local-only, no global tier), **Agents** (grouped by source: local/project, global/user, bundled, from-plugin). Most tabs are one `data:tools` round trip; **Usage Stats** is not — it previews a command and runs it only when asked (below). Also carries the `ProjectSelect` dropdown. |

### The top bar is grouped, not a list

A **hamburger menu** (`components/hamburger-menu.tsx`) is the first element in the nav: links to
`/docs`, `/tools`, a recent-projects list, and "+ Add project…" — the concerns that don't need the
CURRENT project open. It carries the runtime staleness badge dot — the one item in the bar nobody
goes looking for, so it has to be visible from whatever route the user is already on. Then, shown
whenever a project is open, direct links in this order: **Maestro, Skills**, Project Docs,
Workflows, Rules, Session Log, Maestro Tasks — the things a user came to _do_ in this project.
Maestro used to live in the hamburger, back when it carried its own `ProjectSelect` and could be
viewed with no project open; now that opening a project from `/` lands there directly, it belongs
beside Workflows/Rules instead. Skills was a `/tools` tab until it got its own inline tag editor and
"Update skill tags" button, at which point tab-behind-a-hamburger stopped fitting how often it's
used. There is no longer a Library menu or a Create menu — both were removed along with the
`NavMenu` component they were built on; the four create-\* routes are now reached from the bottom of
`/skills` or their matching `/tools` tab.

### Adding a tab to `/tools`, or a doc page

**A tab.** Four of the five steps are in `src/core/` and `src/main/`; only the last is a component.

1. Write the read in a `src/core/*.ts` module, taking `projectRoot` as an argument — never
   `process.cwd()` — so the dashboard works against a project that is not this one.
2. Put the type it returns in `src/core/contracts.ts` (interfaces only) and widen `ToolsData`.
3. Fold it into the **existing** `data:tools` handler in `src/main/ipc.ts` rather than adding a
   channel, so all tabs share one round trip.
4. Add the component under `src/renderer/src/components/tabs/` and an entry to `TABS` in
   `routes/tools.tsx`.

Unless the tab **runs something** — then it is not loader data at all, and needs a preview/run
channel pair and a purpose-tagged token, like Usage Stats below.

**A doc page — two different ways, depending on which reader.** For `/project-docs` (the open
project's own docs): drop a `.md` file into the open project's `docs/`. The slug is the filename;
`listDocs()` and `searchDocs()` in `src/core/docs.ts` pick it up with no registration anywhere.
Heading anchors come from `slugifyHeading()`, which the search index and the reader must go on
sharing — a second slugifier means search hits that scroll nowhere. For the global `/docs` reader
(unrelated to the open project): drop a `.md` file into `apps/maestro/docs/app/` for the `"app"`
group, or the repo-root `docs/` for the `"claude-code"` group (synced into a packaged build by
`scripts/sync-claude-docs.mjs`) — `globalDocsData()`/`readGlobalDoc()` in `src/core/global-docs.ts`
pick it up the same way, with no registration.

**`src/renderer/src/routeTree.gen.ts` is generated** by the router plugin: commit it, never
hand-edit it.

## The create-\* routes

The only place in the app where a model is genuinely required — not to write files, but to author a
**body**: the prose of a `SKILL.md`, an agent's system prompt. Each submit is two operations, in
this order:

1. `create:scaffold` writes everything deterministic — directory, frontmatter, plugin manifest,
   marketplace registration, and for a new marketplace the `git init` and first commit — and returns
   what it wrote. No model, and none reachable: the module behind it (`src/core/scaffold.ts`)
   imports nothing that can reach one.
2. Whatever is left goes out as a `ClaudeRequest` through `claude:preview` and `ClaudeRunDialog`.

**The ordering is the design.** The artifact is on disk before Claude is mentioned, so cancelling
the confirmation — or having no CLI at all — still leaves the user with the thing they asked for.
The confirmation opens by itself only when `needsModel` says something is actually left to write
(auto mode, or a new marketplace's docs); a manual skeleton and a plugin manifest are complete as
written, and **Finish with Claude** on the result card stays available either way.

Per-route files are the schema, the fields and the preview. The chrome is shared:
`components/create-shell.tsx` (layout, header, shortcut map, submit row), `utils/create-flow.tsx`
(the scaffold → preview → dialog path), `components/create-result.tsx` (what landed on disk).

The `target` toggle (marketplace vs. project) is a real choice about where a skill lives.

### A new marketplace is a git repository, and the scaffold makes it one

`dir` → `repo` (`git init`) → manifest → README → `plugins/` → `commit`, one all-or-nothing list.
`planRepo()` decides up front which of **three states** applies and reports it as
`ScaffoldResult.repo` — created here, already inside one, or no `git` on this machine — and the
last two are not failures: the marketplace on disk is complete and usable in all three.
`create-result.tsx` renders the note; `create-marketplace/SKILL.md` has a **"Do not run git"**
section and reads that field rather than probing. Remotes, private-repo credentials and
auto-update stay conversational — they need a host, an account and secrets the app has not got.

Three rules hold it together, and each exists for a reason that is not obvious from the diff:

- **The capability is a port, not an import.** `claude-preview.ts` imports `scaffold.ts` for
  `resolveCreateTarget`, and `test/core/claude.test.ts` walks the preview's transitive import graph
  to prove it cannot start a process — one `child_process` anywhere in that graph costs the
  guarantee. So `GitPort` is an interface in `contracts.ts`, `nodeGit()` implements it in
  `src/core/git.ts`, and **`src/main/ipc.ts` is the composition root**: the `{ git: nodeGit() }` it
  passes to `scaffoldCreate` is the whole reason a new marketplace is a repository. The cost is that
  the capability can go missing in a diff that still passes every test in `src/core/`, which is why
  `test/isolation.test.ts` pins that wiring instead of trusting it.
- **A decision that must survive a missing tool is made with `fs`, not with the tool.**
  `enclosingRepo()` in `src/core/repo.ts` is a walk-up looking for `.git` — not `git rev-parse`,
  which needs the binary and, worse, answers about the _process's_ cwd when the directory it was
  pointed at does not exist yet. That is exactly this case: the scaffold asks before it creates the
  marketplace. It is its own module because both callers must stay spawn-free.
- **Git steps roll back only themselves; every other step rolls back everything.** Asymmetric on
  purpose. A `git commit` failure removes the half-made `.git` and is _reported_, because a
  marketplace without a repository is precisely what a machine with no git gets — complete and
  usable — and destroying the artifact over it would be worse. But a failure of any _other_ step
  after `git init` does take the repository with it. That is why `init` is first and `commit` is
  last.

## The Claude bridge

The app can run Claude on the user's behalf, and asks first. Three channels:

```
claude:preview  → { prompt, argv, cwd, targets, read, handoff, available, searched, token }  // spawns nothing
claude:run      → an Agent SDK session; streams output, resolves with the outcome   // token only
claude:cancel   → closes the query, then kills the child's process group
```

Every run on `claude:run` — create-\*, `/maestro-tasks` — is an Agent SDK session
(`startAgentSession` in `agent-sdk.ts`): preview builds the prompt and issues the token, and run
accepts a token and nothing else.

The **`session:*` namespace is a separate surface**, not a fifth bridge channel — a turn carries no
token because there is no prompt to consent to: the user types every one. The one exception is
`session:handoff`, which takes a preview token and nothing else, because it is the only call in the
app that widens what a session may write — the same discipline as `claude:run`, applied to paths
instead of prompts. See "The session pane" below.

`ClaudeRunDialog` is the user-facing half: what may be **read**, then full prompt (scrollable,
selectable — never a summary), the **equivalent** command line, working directory, what may be
written, then Copy prompt / Cancel / Run — and, when the preview carries a `handoff`, a second
button **Continue in the pane** (`data-testid="claude-handoff"`) with the directory it would open
rendered beside it (`data-testid="claude-handoff-scope"`) — then streamed output with a Stop. The whole body is **one**
scroll region: with four sections, per-section shrink-to-fit squeezed the prompt `<pre>` to a sliver
and let the read section render over the top of it — invisible to every test that is not a
screenshot, so a rect-overlap assertion in the window probe pins it. See
`src/core/claude-preview.ts` and `src/core/claude-run.ts` for why preview
and run are two operations and what breaks if they become one. Everything a route needs is `window.maestro.claude.preview(request)`
plus rendering `<ClaudeRunDialog>` with the result — a route that shells out on its own has opted
out of the confirmation, which is the whole point.

**`ClaudePreview.argv` is the _equivalent_ invocation, not what is spawned.** It is `claude -p
<prompt>` — what you would type to reproduce the run yourself, which is what **Copy prompt** is for,
and why the dialog's row says "Equivalent" rather than "Command". The SDK spawns the same binary
with its own stream-protocol flags, and `ClaudeRunResult.argv` reports what actually went out. The
two deliberately do not match. `ClaudeRunResult.code` is `0` on success and `null` otherwise — a
session is not a process exit — so the UI renders `error`, never an exit code.

Tokens carry a **purpose** (`claude-tokens.ts`). The usage-stats reader below shares this store —
one expiry rule, one single-use rule, one place to clear on a project switch — but not its tokens:
without the tag, a stats preview would hand the renderer something `claude:run` would claim, and
the app would spawn `npx` while every message on screen said Claude.

### What a run can read — the `SettingsPort`

Reads are the larger surface: file reads and searches are auto-approved and never raise a prompt, so
the directory list handed over at spawn is the whole bound on what the model can see. The preview
carries a `ClaudeReadScope`, built by `src/core/read-scope.ts` and rendered by **one** component,
`renderer/src/components/read-scope.tsx` — used by `ClaudeRunDialog` and by the session pane's own
disclosure (`compact` changes the type scale, never the content). `ReadScopeInput.additional` is how
directories the **app itself** opened get onto that list; they render with `origin: "app"`, which is
what distinguishes them from the cwd and from anything a settings file contributed.

- **A run loads no filesystem settings** (`settingSources: []`), so the confirmation lists no user-,
  project- or local-tier directories and rules — there are none to list. The managed
  (administrator) policy tier is **not** dropped by `[]`: it is still read from disk, still
  disclosed, and still applies. **Consequence worth knowing: `CLAUDE.md` files are not auto-loaded
  into a run** — the SDK requires `settingSources` to include `'project'` for that. The model can
  still `Read` them.
- **The resolution is a port, not an import** — exactly like `GitPort`. `SettingsPort` is an
  interface in `contracts.ts`, `nodeSettings()` implements it in `agent-sdk.ts`, and `src/main/ipc.ts`
  is the composition root that passes `{ settings: nodeSettings() }`. `claude-preview.ts` must import
  nothing that can start a process (the SDK shells out to `plutil`/`reg.exe` for MDM policy) and
  `test/core/claude.test.ts` walks its import graph. Dropping the wiring fails **silently** — the
  dialog just starts saying the settings were not consulted — so `test/isolation.test.ts` pins it.
- **`previewClaudeRun` is `async`** because of this. Every caller must `await`.
- **The cascade is never reimplemented.** The SDK's `resolveSettings` is the merge engine;
  re-deriving it here would be a second reader of someone else's format.
- **Provenance is never flattened.** Every directory and rule carries its tier and its file. "These
  are the directories" is not the disclosure; "the app chose this one, a file on disk added those"
  is. `RULE_DISPLAY_CAP` lists the first 40 rules and counts the rest.
- **Unresolved ≠ empty.** If the cascade cannot be read the preview does not fail: it lists the cwd
  and sets `unresolved`, because a scope that quietly reported only the cwd reads as a complete
  answer.
- **Resolved against the RUN's cwd, not the open project.** Verified in the window: a
  marketplace-targeted create run picks up the _marketplace's_ `.claude/settings.json`.

### What a run can write — `canUseTool`, and no pre-acceptance anywhere

Writes are the smaller surface and the sharper one — the app answers for each of them itself.
`src/core/write-scope.ts` is the whole decision — `decideWrite` is pure path arithmetic, no `fs`, no
spawn, no SDK — and `startAgentSession` hands it to the SDK as `canUseTool`. **Edit pre-acceptance
exists nowhere in the app**; `test/isolation.test.ts` fails if `acceptEdits`, `bypassPermissions` or
`dangerouslySkipPermissions` reappears under `src/`.

- **The write scope rides on the token.** `ClaudeInvocation.writable` is the exact list of paths the
  preview resolved and the confirmation displayed (`targets.map(t => t.path)`). The callback reads it
  off the invocation, so it is structurally incapable of being wider than what the user was shown —
  the argument the token already makes about prompts, applied to paths. `runPreviewedClaude` has no
  argument by which a caller could widen it; `ccusage.ts` issues its token with `writable: []`.
- **A directory means "anything under it"; a file means itself.** One `withinDirectory` check covers
  both, which is what `ClaudeWriteTarget.path` already documented.
- **It bounds writes and does NOT bound reads.** `decideWrite` returns `allow` for
  `Read`/`Glob`/`Grep` without looking at the path, deliberately: reads are auto-approved and never
  raise a prompt, which is why the disclosure above exists at all. Bounding what a session may read
  is a `PreToolUse` hook, a **third** scope module — `src/core/session-scope.ts` (`decideBoundary`),
  described below. Adding a path check to the read-tool branch looks like the fix and is not one; the
  two layers are wired to different sessions on purpose. A **fourth** module,
  `src/core/session-permission.ts`, decides nothing on its own: it composes these two and adds the
  branch where the answer comes from a person.
- **The fall-through is a deny, never `undefined`/`null`.** The SDK reads `null` as "the host
  answered out of band" and the tool call then blocks forever with no timeout. `WriteDecision` is a
  two-shape union and the `default` branch is a refusal. It is an **alias of `PermissionAnswer`** —
  one union, two producers (`decideWrite` and the pane's Allow/Deny/Stop buttons), so neither can
  widen the hole back open on its own.
- **Every deny carries a reason the model can act on.** It reads denial messages and adapts; a bare
  "denied" wastes the one channel there is for steering it back to the file it was started for.
  Denials are also pushed onto the output stream as stderr — a run that quietly declined half of
  what it was asked and then reported success is the failure worth seeing.
- **The tool set is the first permission layer.**
  `SESSION_TOOLS = [...READ_ONLY_TOOLS, "Edit", "Write", "Skill"]`.
  `SESSION_DISALLOWED_TOOLS` = `Bash, Agent, NotebookEdit`. A
  tool that was never offered costs nothing; a tool that is offered and denied costs turns to argue
  with. `allowedTools` is the trap — it auto-approves without restricting, so it is not used.
  Withholding `Bash` is what makes the path check meaningful at all: it is the one tool whose
  filesystem reach cannot be bounded by inspecting `tool_input`. This is only safe because `git init`
  and the first commit live in the deterministic scaffold rather than a shelled-out prompt.
  `AskUserQuestion` is deliberately **not** in the set for a HEADLESS run: that path has nobody to
  answer a question. `Skill` **is**, though — a headless run reads a `create-*` skill's guidance
  through it rather than having it inlined into the prompt. A headless session only reaches a
  skill's body when it is handed somewhere to load one from: `AgentSessionRequest` carries
  `pluginDir?: string | null`, and the headless query passes `skills: request.pluginDir ?
  [...SESSION_SKILLS] : []` and `plugins: request.pluginDir ? [{ type: "local", path:
  request.pluginDir }] : []` — where `SESSION_SKILLS = ["create-skill", "create-subagent",
  "create-plugin", "create-marketplace"]`. The pane extends the tool constant rather than declaring
  a second list — `PANE_TOOLS = [...SESSION_TOOLS, QUESTION_TOOL]`, where `QUESTION_TOOL`
  (`AskUserQuestion`) carries its own two mechanical preconditions; `Skill` is not named a second
  time here. Skills extend the same way: `PANE_SKILLS = [...SESSION_SKILLS, "super-help",
  "maestro-help", "update-skill-tags"]` — the latter loaded so the global `/docs` page's "Discuss
  with Claude" action can answer questions about `apps/maestro/docs/app/*.md` and the Claude Code
  concept docs the same way `super-help` does, and `update-skill-tags` (pane-only — this flow never
  runs headless) for the `/skills` page's button. That flow's handoff is the fifth `HandoffContext`
  kind, alongside the four create-\* forms, but built without a scaffold: `claude-preview.ts`'s
  `buildUpdateSkillTagsHandoff` opens `.claude/skills/` for writing (so `Edit` can fix a
  description) and seeds a table of every project skill's current description and tags — never a
  skill's own body. It has no tool to write a tag with, so its last message instead carries one
  fenced ` ```update-skill-tags ` JSON block, which `claude-session.ts` parses and applies
  (`parseSkillTagsBlock`/`applySkillTagsBlock` in `skill-tags.ts`) as each assistant message
  streams past — the one place in the app where main reads a MODEL's own output as an instruction,
  rather than only ever reacting to a tool call. The second precondition is `toolConfig: { askUserQuestion: { previewFormat: "markdown" } }`, passed on
  the pane query and nowhere else: **without it Claude emits no `preview` on any option and the list
  arrives bare**, which looks like a rendering bug and is not one. If a question never arrives at
  all, check those two before anything else.
- **`systemPrompt: { type: "preset", preset: "claude_code" }` is passed explicitly.** The SDK's
  default is a minimal prompt, not Claude Code's, and a create-\* run that lost it would author
  against different defaults than every prompt in this app was written for.
- **The spawn function stays the app's.** `claude-run.ts` supplies `spawnClaudeCodeProcess` so the
  child is still a detached process-group leader. `stdio` is three pipes: the SDK speaks a control
  protocol to the child over stdin/stdout, and closing stdin closes the conversation.
- **Teardown is three distinct actions.** Interrupting a turn, aborting the read loop and closing the
  query are not the same thing. `cancelClaudeRun` does `query.close()` — which releases the child the
  SDK is holding — then SIGTERM to the process **group**, which is what reaches the CLI's own
  children, then SIGKILL after a grace.
- **A fake `claude` on `PATH` cannot serve as a test double**, because it cannot speak the SDK's
  private stdio protocol. Runs are tested through an injected session (`ClaudeRunDeps`), and
  `spawnClaudeChild` is tested directly for the process-group property.

### The session pane — a live conversation, and still not a second spawn path

**One live, multi-turn session per open project**, in a resizable right-hand pane that _shifts_ the
layout rather than overlaying it. It asks rather than refusing when it hits a write it can't make —
a write it can't approve is a question, not a wall. Both scopes are mutable mid-session, by two
different routes: reads through a grant the user answers a prompt with, writes through a create-\*
handoff carrying a preview token.

```
src/core/session-scope.ts                       the read boundary (pure)
src/core/session-permission.ts                  settled, or ask a person (pure) — composes the two
src/core/permission-registry.ts                 the parked promises, one per outstanding ask (pure)
src/core/session-question.ts                    the OTHER kind of ask: read a question, build its answer (pure)
src/core/session-handoff.ts                     what a create-* handoff says: seed, notice, title (pure)
src/core/session-budget.ts                      what it may spend, and every sentence about it (pure)
src/core/session-resume.ts                      which stored conversations may be offered, and what one costs (pure)
src/main/claude-session.ts                      one session per webContents.id
src/renderer/src/components/session-pane.tsx    transcript + composer + resize + scope + PermissionCard
src/renderer/src/components/agent-question.tsx  the question card — options, previews, freeform reply
src/renderer/src/components/session-resume.tsx  the picker + the pre-resume disclosure
src/renderer/src/utils/session-context.tsx      SessionProvider / useSession — single-owner
```

```
session:start      → SessionInfo              no argument; the cwd comes from main's project state
session:handoff    → (token) → SessionInfo    A PREVIEW TOKEN ONLY; the one call that widens writes
session:continue   → (id) → SessionInfo       A SESSION ID ONLY; a fresh allowance on the same transcript
session:resumable  → ResumableSession[]       no argument; the list MAIN builds, and the only ids it honours
session:resume-detail → (id) → ResumeDisclosure what that transcript already read, and what replaying it costs
session:resume     → (id) → SessionInfo       AN ID FROM THAT LIST ONLY; attaches by FORKING it
session:info       → SessionInfo              reads only
session:say        → (id, text)               USER-TYPED TEXT ONLY
session:stop       → (id)                     interrupt the turn; the session stays usable
session:permission → (id, requestId, choice)  A PermissionChoice, never a PermissionAnswer
session:question   → (id, requestId, choice)  A QuestionChoice — a SELECTION, never the answer payload
session:revoke     → (id, path)               take back a grant; NARROWS ONLY
session:effort     → (id, effort)             one of EFFORT_LEVELS, checked before it reaches the CLI
session:model      → (id, model)              an id from the list MAIN published, or null for default
session:end        → ()                       end, and reap the process group
session:event      ← SessionEvent             the streamed transcript
```

- **The session lives in main, one per `webContents.id` — the same ownership shape as the log tail.**
  `announce()` calls `endAllSessions()` on a project switch and `disposeIpc()` calls
  `disposeSessions()`, for the same reason the log tail is retargeted and `disposeClaudeRuns()`
  exists. Teardown reuses `terminateChildGroup(child)`, exported from `claude-run.ts` so the pane
  performs the identical SIGTERM-to-the-group → SIGKILL escalation `cancelClaudeRun` does rather than
  growing a second one.
- **`startPaneSession()` is a sibling of `startAgentSession()`, not a second SDK importer.**
  `agent-sdk.ts` is still the only module in the app that imports the SDK. The difference is the
  input: a `prompt` string gives a one-shot query with no way to add a turn and no working Stop, so
  the pane feeds a **streaming-input pump** instead. `claude-session.ts` composes no prompt, resolves
  no CLI path and imports no `child_process`.
- **`session:say` carries user-typed text and nothing else.** The bridge's invariant restated for a
  surface with no per-turn confirmation: the renderer never authors a prompt, the user does. Turns
  are stamped human-authored, so it holds at the SDK boundary and not only in a test.
- **A session opens with an empty write scope, and exactly one thing can grow it: a create-\*
  handoff.** `session:handoff` takes a **preview token and nothing else**, claims it through
  `claimInvocation(token, "claude")`, refuses any preview whose `handoff` is null (a `maestro-task`'s
  write target is the whole project), and appends **one** path — `HandoffContext.writeScope`, the
  artifact's own directory, or the artifact FILE where it has no directory of its own (a
  project-target subagent shares `.claude/agents/` with every other agent). Every writable path
  therefore traces to a form the user filled in and a scaffold that already wrote a file there.
  Ending the session is how it is withdrawn — there is no `session:revoke` for a write and none is
  owed, because a grant answers a question the session asked and a write scope entry answers a form
  the user submitted.
- **A write OUTSIDE the scope is still a prompt, and the reason names which of two states you are
  in.** `decidePaneCall`'s write-ask branch says "nothing has given this session write access" only
  while `writable` is empty; once a form has opened a directory it names the scope that exists
  instead, because telling a user nothing was granted while the header lists a directory is the kind
  of wrong that teaches people to stop reading prompts. Allowing still grants nothing further —
  `grantable` stays false for every write — and the scope is unchanged on the next call.
- **The accumulator lives in `startPaneSession`, and `writable()` is a FUNCTION.** `writes` is the
  array, `writable()` reads it fresh inside `canUseTool`, and `allowWrites(paths)` is its only
  writer. **Anything writable is also readable**: `readable()` includes the write scope, because a
  session that may write a file it may not read is asked about the read half of every edit — the
  prompt this whole path exists to remove.
- **Telling the CLI about the directory is LAZY, because the SDK has no control request for it.**
  `updatedPermissions` rides on a permission answer and a handoff has no answer to ride on, so
  `startPaneSession` keeps an `unannounced` set and carries the `addDirectories`
  (`destination: "session"`) on the **first allow that lands inside a newly-opened directory**, once.
- **The seed costs nothing.** `seed(text)` appends the `HandoffContext` as a `shouldQuery: false`
  message with **no `origin` stamp** (it is not a user turn), and main pushes it as a `{ kind:
  "context", title, text }` `SessionEvent` — a collapsible transcript entry, because the user is
  entitled to read what was put in front of the model on their behalf. Two things worth knowing: (a)
  a `shouldQuery: false` append is answered by its **own zero-cost `result` message**, and reporting
  that as a `turn` claims something ran and clears the renderer's `busy` — `startPaneSession` counts
  outstanding user turns and drops a zero-cost result that answers none of them; (b) **seed wording
  that describes a boundary as absolute makes the model refuse to attempt the call at all**, so
  `session-handoff.ts` says plainly that a write elsewhere asks and can be allowed.
- **The write scope is on screen beside the grants, not in a second panel.** `WriteScope` in
  `session-pane.tsx` renders `SessionInfo.writes` (`data-testid="session-write-scope"`,
  `data-count`), each entry naming the form that opened it — and deliberately **without** a Revoke
  button. `SessionInfo.writable` is the flat `writes[].path`, derived in one place so the two cannot
  disagree, and the `{ kind: "scope" }` event carries both so the header re-reads them rather than
  inferring them from a click.
- **A refused write therefore carries two sentences, not one.** `PermissionPrompt.reason` is written
  for the person reading the dialog; `PermissionPrompt.denyReason` is `decideWrite`'s model-facing
  message verbatim, sent only if the user denies without typing anything.
- **Reads are bounded by a `PreToolUse` hook, and that is a third scope module.** `read-scope.ts`
  _discloses_, `write-scope.ts` _bounds writes_, and `src/core/session-scope.ts` bounds **reads** —
  `decideBoundary` / `boundaryTargetOf` / `BOUNDED_TOOLS` / `UNBOUNDED_TOOLS`, pure, exhaustively
  tested in `test/core/session-scope.test.ts`. It returns `{ decision: "allow" }` or
  `{ decision: "out-of-scope", path, reason }` — deliberately **not** the word `"deny"`, which is
  what lets it route to `permissionDecision: "ask"` in `agent-sdk.ts` in one word.
- **The hook is not purely `"ask"`, and the exception is load-bearing.** A call the boundary cannot
  check because it carries **no path** still returns `"deny"` — there is nothing there for a person
  to authorise, and a prompt with a blank subject is answered by reflex. That branch also writes its
  own `{ kind: "refusal", source: "read-boundary" }` transcript entry, because the SDK's
  `permission_denied` stream event does **not** report hook denials: without it the call vanishes
  with no prompt, no auto-deny event, and a tool that merely appears to have found nothing.
- **`session-permission.ts` is the fourth scope module and deliberately not a fourth engine.** It
  **composes** `decideWrite` and `decideBoundary` and adds the one answer neither can give: ask a
  person. `decidePaneCall` returns a `PaneVerdict` — `{ outcome: "settled", decision }` or
  `{ outcome: "ask", reason, denyReason, target, detail }` — and `agent-sdk.ts` routes it without
  ever authoring a decision of its own. Also here: `describeCall` (the per-tool prompt bodies —
  fetch / search / write / read / scan / other, never a payload dump), `permissionReason` (a reason
  that is never empty), `autoRefusal`, and `PANE_ASK_TOOLS = ["WebFetch", "WebSearch"]`.
- **The network tools always ask.** Neither scope module has an opinion about them — they touch no
  path — so without a route into the prompt they are auto-approved, and a `WebFetch` is how the
  contents of the project the session can read leave the machine. The prompt shows the **complete**
  URL, query string included.
- **Five refusal routes exist, and the transcript says which one fired.** `SessionEvent`'s `refusal`
  carries `source: "write-scope" | "read-boundary" | "user" | "auto" | "question"` plus `decidedBy`
  (the SDK's own `decision_reason_type`: `rule`, `mode`, `classifier`, `asyncAgent`). They share no
  code, which is why the discriminator is a field and not a comment. `autoRefusal` is pure and lives
  in `session-permission.ts` rather than inline in the read loop precisely because the `rule`/`mode`
  branch **cannot be provoked from a window**: with `settingSources: []` only the machine-wide
  `/etc/claude-code/managed-settings.json` tier survives, and writing one needs root. It is covered
  by unit tests over the pure function plus an isolation pin, and that is the honest extent of it.
  The narrowest is an `AskUserQuestion` call carrying nothing the pane can render as a choice, which
  is refused outright rather than parked, because an unanswerable card is a promise only teardown
  will ever resolve.
- **The parked promises are their own module.** `createPermissionRegistry()` in
  `src/core/permission-registry.ts` → `{ request, answer, pending, denyAll }`, idempotent per
  `requestId` (a redelivered request re-attaches to the parked promise, or replays the answer it
  already got — bounded at 64), because `reinitialize()` and any `initialize` to a running session
  re-dispatch `pending_permission_requests`. **Every exit denies everything outstanding**
  (`TEARDOWN_DENIAL`, from both `finish()` and `close()`): prompts do not time out, there is no
  backstop below this, and an unresolved ask is a permanently wedged session holding a child.
- **The renderer sends a `PermissionChoice`, never a `PermissionAnswer`.** Three buttons —
  `{choice:"allow"}`, `{choice:"deny", reason}`, `{choice:"stop", reason}` — and main constructs the
  SDK-shaped answer. Deny and Stop are two controls because they are two intents: a plain denial
  refuses the call and lets the model adapt, `interrupt` ends the turn. The wire shape exists
  because `PermissionAnswer`'s allow arm carries `updatedPermissions`, which can add blanket allow
  rules or flip the session to `bypassPermissions`. A fourth arm, `{ choice: "grant", scope: "file" |
  "directory" }`, carries a scope word **and no path** — main holds the prompt being answered and
  resolves the path from the `SessionGrantOption` it published with it, which mirrors
  `scaffold.ts`'s "a renderer describes an artifact and never nominates a directory" applied to the
  permission wire.
- **A QUESTION IS THE OTHER KIND OF ASK — same wire, same registry, nothing else in common.**
  `AskUserQuestion` reaches `canUseTool` like everything else, and `startPaneSession` branches on the
  tool name **before** `decidePaneCall`: "Claude wants to use a tool — Allow / Deny" is the wrong
  sentence for "which of these three frontmatter shapes do you want". What it hands to is
  `src/core/session-question.ts` (pure) and, on screen, `agent-question.tsx` — a choice per question
  with each option's description and its preview in a monospace block, single- vs multi-select said
  in the card, and a freeform textarea for a user who disagrees with every option.
  - **The answer travels back through `updatedInput`, which is the field this app otherwise refuses
    to expose, and the carve-out is made CHECKABLE rather than trusted.** The renderer sends a
    `QuestionChoice` — `{ choice: "answer", selections: [{ question, labels }] }` or
    `{ choice: "reply", text }` — and neither arm can express an answers map. `answerQuestions`
    rebuilds the payload from the questions THE MODEL ASKED and **refuses any label that was not
    among the options it offered**; a rejected selection answers nothing and main writes a notice
    saying which label it was. Dropping the unknown label instead would send the model an answer to a
    question nobody asked, which is why it is an error and not a filter.
  - **The validation lives in `startPaneSession`, not in main** — the one place holding the tool
    input as the SDK delivered it. Main is a forwarder here (it keeps no copy of the question),
    which is the opposite of a grant and deliberately so: a grant needs main's own copy of the prompt
    to resolve a path the renderer never sent, while a question needs the labels checked against the
    options as received rather than against a copy that crossed two process boundaries. That is why
    `test/isolation.test.ts` pins `updatedInput` to exactly two files — `contracts.ts` declares it,
    `agent-sdk.ts` fills it in.
  - **One registry, so teardown drains a question too.** `PermissionAnswer` was widened to
    `ParkedAnswer` (`| { behavior: "allow"; updatedInput }`) rather than adding a second registry: a
    second one is a second thing to remember to drain on exit, and the forgotten one wedges the
    session exactly as hard. `PermissionOutcome` gained `answered` — a question is never allowed or
    denied — and the pane's badge counts asks of either kind.
  - **The refusal comes back from the pure module fully formed** (`QUESTION_REFUSAL`), because
    `startPaneSession` authors no decision of its own.
  - **Measured in the window, on the packaged build**: previews arrive on every option (so the
    `toolConfig` opt-in is doing its job), a single-select question replaces its pick on a second
    click while a multi-select accumulates, Send stays disabled until every question is answered, and
    the model reads back exactly the labels picked — `Full`, `Overview + Traps`. The freeform arm
    works too: `response` on `updatedInput` is honoured by the CLI, verified by a reply the model
    could only have produced from the typed text. Closing the pane leaves the question parked and the
    badge lit; ending the session or switching projects resolves it — the card and badge clear, no
    error, and the next session answers a turn.
- **The boundary hook runs only on the read-only tools**, by design. Letting it answer for
  `Write`/`Edit` too would replace `decideWrite`'s reason with a new one, and the requirement is that
  a refused write still carries the original. `session-scope.ts` knows how to check write tools all
  the same, so widening reads cannot widen writes by accident: `PaneVerdict`'s `grantable` is true
  only in the read-boundary branch, so a refused **write** never grows a grant button.
- **The readable set is the open project plus EVERY local marketplace**, not "the resolved
  marketplace" — the pane starts before any form is submitted, so there is no single marketplace to
  name. (A handoff widens it further only when it has to: `describeSession` lists the handed-off
  directory in the read scope as `origin: "app"` **only when nothing already in scope contains it**,
  which for a marketplace-targeted create is usually already true.) Main resolves them itself with
  `listMarketplaces()` (the `source: "directory"` entries of `~/.claude/plugins/known_marketplaces.json`);
  **no name and no path crosses the process boundary**, which is `scaffold.ts`'s "a renderer
  describes an artifact and never nominates a directory" applied one layer up. They reach the SDK as
  `additionalDirectories` and the disclosure as `origin: "app"`.
- **`skills` alone does not load a skill — the plugin has to be loaded too.** Measured in the window:
  with `settingSources: []`, `skills: ['super-help', …]` on its own makes the `Skill` tool answer
  _"Unknown skill"_ for every name, because no installed plugin reaches the session. The fix is
  `plugins: [{ type: "local", path: bundledPluginDir() }]` (`src/main/bundled-assets.ts`), after
  which the session reports exactly `maestro:create-marketplace`, `:create-plugin`,
  `:create-skill`, `:create-subagent`, `:super-help`, `:maestro-help` and nothing else. It is the plugin **bundled
  with the app** (`plugins/maestro/`), never the user's installed marketplace cache — so a
  `SKILL.md` edit in this repo reaches the pane with no version bump and no marketplace update.
- **The plugin's `hooks.json` does NOT fire in a pane session.** Also measured: a turn that read a
  file inside a fixture project _with_ a `maestro.json` wrote no `maestro_session.log.jsonl`. So the
  `/session-log` pollution that loading project `settingSources` would cause does not arrive with
  `plugins`, and the pane's tool calls stay out of a view built for orchestrator runs.
- **A session grant is the first thing that makes the read scope MUTABLE mid-session.** `readable`
  used to be resolved once at session start and handed the same array to the hook and the
  disclosure; it is a function now (`readable()`), read fresh on every call, because a grant has to
  reach **both** or the header and the boundary start disagreeing with nothing failing.
  - **Three things happen on a grant, and dropping any one is invisible.** `session.grant([path])`
    widens the hook's own list (it runs FIRST and would otherwise re-prompt forever);
    `updatedPermissions: [{ type: "addDirectories", directories: [path], destination: "session" }]`
    rides on the allow so the CLI's permission system stops prompting; and main re-derives the
    disclosure and pushes it as a `{ kind: "scope" }` `SessionEvent`.
  - **`destination: "session"` is the whole guarantee about disk, and it is enforced by the TYPE.**
    `SessionPermissionUpdate` in `contracts.ts` cannot express `addRules`, `setMode`, or the three
    destinations that write — `localSettings` (the user's repository), `projectSettings` (a file
    they would commit), `userSettings` (their whole machine). `test/isolation.test.ts` also fails on
    any of those literals anywhere under `src/`. Verified in the window: after granting, every
    settings file is byte-identical and `~/.claude.json` gains no permission-shaped key and never
    names the granted path.
  - **File or directory, and the difference is on screen.** `grantOptionsFor` (pure, in
    `session-scope.ts`) offers a file as itself **and** as its containing directory, and a directory
    as itself only. Each option renders as its own button with its own path and its own sentence,
    because "Allow this folder" is a promise that the folder is the obvious one and the case this
    prompt exists for is where it is not. A directory that is ≤2 segments deep, or that CONTAINS
    something already in scope, is flagged `broad` and rendered in amber with what it would swallow.
  - **Only a read is grantable.** `PaneVerdict.grantable` is true in the read-boundary branch and
    nowhere else: a refused write keeps Allow once / Deny / Stop, and a `WebFetch` has no path to
    grant. Writes widen only through `session:handoff` and a claimed preview token, never through an
    answered prompt.
  - **Visible and revocable, or it is not optional — it is gone.** Grants render in the pane's scope
    panel with a Revoke button, and inside `ReadScope` as `origin: "session"` (the fourth origin,
    dotted amber). `session:revoke` takes a path and can only ever REMOVE an entry main is already
    holding, which is why a path may cross there while a grant crosses as a scope word. The SDK has
    no API for withdrawing a `PermissionUpdate` — revoking works because the **hook** is the
    authority and runs before the permission system ever sees the call. Verified live: revoke, and
    the same directory raises a prompt again.
  - **The other two doors are closed by the CLI, not by us — measured.** `/add-dir` typed into the
    composer answers `/add-dir isn't available in this environment.` in an SDK session, inside the
    cwd and outside it alike, and that refusal is already visible in the transcript. The
    `DirectoryAdded` and `CwdChanged` hooks are registered anyway and are currently unreachable from
    the pane; the boundary stays anchored to `request.cwd` and does not follow a working directory
    that moves. `test/isolation.test.ts` pins both handlers and the anchoring.
- **The session runs under three ceilings, and they are three different mechanisms rather than one
  written three ways.** `maxBudgetUsd` is the hard stop, enforced by the CLI against its own
  client-side estimate; `taskBudget` is the opposite kind of thing — the **model** is told how much
  room is left so it wraps up instead of being cut off mid-write; `maxTurns` is the brake for the
  loop neither catches, cheap per turn and never converging. The policy, the arithmetic and every
  user-facing sentence about them live in `src/core/session-budget.ts` (pure, a fifth module beside
  the four scope ones); `startPaneSession` also passes `effort`, `persistSession: true`,
  `enableFileCheckpointing: true` and, on a Continue, `resume`.
  - **A CEILING WITHOUT A DOOR DEFEATS ITSELF**, which is why this is a module and not a constant at
    the query. Reaching the ceiling ends the query, which on a conversation means the session is
    over — so a user who loses a transcript to it raises the ceiling until it never fires, and the
    control stops being one. `session:continue` carries a session id and nothing else; main resumes
    the CLI's own session, `renewAllowance` zeroes what is measured against the ceiling and keeps the
    lifetime figure, and the grants, write scope, effort and model carry over because they are main's
    own records. `openSession` is the **single** builder behind start, continue and the pacing
    reopen, differing only in a `CarriedSession` — a second builder is how a resumed session ends up
    with a different tool set than the one it is continuing. The exhausted `LiveSession` entry is
    kept **only for a ceiling**, because it holds the id to resume against; every other ending
    deletes it, and the three teardown paths are unchanged.
  - **REACHING THE CEILING DOES NOT END A STREAMING-INPUT QUERY, and the pane is one.** Measured:
    after the `error_max_budget_usd` result the pump is still open, so the CLI takes the next turn and
    answers it with another error result — 12 turns in 1.6 seconds, none of which reached the model,
    while the pane looked alive and the composer stayed enabled. So the read loop **leaves** on a
    ceiling (`break`, `finish`, then `query.close()`) rather than waiting for a stream end that never
    comes. A latch alone makes the ceiling decoration; `ceilingHit` is still read in the `catch`
    because the one-shot shape genuinely does throw. This is the first thing to know before touching
    that loop.
  - **`maxTurns` counts AGENT turns inside one request, not user messages.** Twelve one-word user
    turns under `maxTurns: 1` never trip it — the turn ceiling only fires on a request that cannot
    finish without going round again. Anyone writing a turn-ceiling test needs this or they will
    conclude the option is broken.
  - **`total_cost_usd` is CUMULATIVE for the query**, not the price of a turn (0.00196, 0.00351,
    0.00529, 0.00726 over four one-word turns), so `accrueTurn` takes the latest with `Math.max`
    rather than summing. It is fed from the `result` branch behind the outstanding-turn guard, or a
    seeded append that cost nothing counts as a turn that did. And a pane turn is **not** cheap: the
    first costs ≈ $0.01–$0.10 depending on cache state — the tool set, the plugin's skills and the
    preset prompt are uncached — so the $0.50 default is tens of turns, not hundreds.
  - **The figure is an ESTIMATE and the markup says so itself.** `data-testid="session-spend"` renders
    `≈ $x / $y` with the word "estimate" and the subscription sentence in its title text. It is the
    same client-side figure the ceiling is compared against, which is exactly why it must not look
    like an accounting number — a user who reconciles it against a bill will trust nothing else on
    the header either. The renderer formats dollars locally rather than importing the module, because
    it may import only `contracts` and `text` from `src/core`.
  - **Some models refuse a pacing budget and nothing advertises which.** Measured: with `taskBudget`
    set, Haiku 4.5 answers every turn with a 400 —
    `This model does not support user-configurable task budgets` — and does no work at all;
    `ModelInfo` has a `supportsEffort` flag and no equivalent for budgets.
    `isPacingUnsupported` spots it on the way past, `onPacingRejected` fires once, and
    `reopenWithoutPacing` resumes the same conversation with the budget **omitted** rather than
    zeroed, posting `PACING_UNSUPPORTED_NOTICE`. The hard ceiling is untouched, which is what makes
    that recovery safe rather than a quiet widening.
  - **Effort and model change a LIVE session**, through `session:effort` / `session:model` onto
    `setEffort` / `setModel` — effort from the next turn, model during the current one, neither
    touching the transcript, which is why they are header controls and not a "start a session with…"
    dialog. The selector offers only what the CLI's own `supportedModels()` published and only the
    effort levels the **current** model accepts; a CLI too old to answer leaves the list empty and the
    header still states what is in force.
  - **The ceiling is demonstrable for cents.** `sessionBudget()` reads `MAESTRO_SESSION_CEILING_USD`
    and `MAESTRO_SESSION_MAX_TURNS` from the launching process's environment **only**, because
    proving the CLI really stops at $0.50 costs $0.50 of somebody's subscription each time, and that
    is a check people run once. Nothing on any channel reaches it, and `paneBudget` clamps a nonsense
    value back to the default.
- **The pane can pick up a conversation it did not start, and it does so by FORKING.** The History
  control in the header opens a picker of the conversations the CLI's own store holds for the open
  project; choosing one shows what that transcript already read and what replaying it will cost, and
  only then attaches. `resumeSession` is the **fourth** caller of `openSession`, so a resumed session
  gets `PANE_TOOLS`, the `PreToolUse` boundary, `settingSources: []` and the preset prompt by
  construction — `CarriedSession` has one field, `fork`, and `startPaneSession` turns it into
  `forkSession: true`, only ever together with `resume`. The policy, the arithmetic and every sentence
  the user reads live in `src/core/session-resume.ts` (pure, the sixth module beside the four scope
  ones and `session-budget.ts`); it reads nothing itself.
  - **THE IMPORTED CONTEXT IS NOT GATED BY THE BOUNDARY, and that is the whole reason for the
    disclosure.** Measured: a resumed conversation answered a question about a file's contents with
    **no tool call at all** — the bytes were already in the transcript, so nothing reached
    `canUseTool` and nothing reached the hook. The pane's boundary applies going forward only, which
    makes "this session cannot leave the selected directory" true of future turns and quietly false
    of the context it starts with. `resumeDisclosure` therefore enumerates the transcript's recorded
    reads before anything starts, flags the ones outside the pane's scope in amber
    (`data-in-scope="false"`), and Decline returns to the list having started nothing.
  - **The disclosure says what it CANNOT see, because implying completeness would be worse.** It is
    built from the transcript's recorded **tool calls**; attached, pasted and auto-loaded text never
    appears as one, so `readNote()` states that limit in the sentence itself rather than presenting
    the list as the whole of what the model has.
  - **The three probes, measured against a running CLI rather than read off the reference.** (a) A
    resume does **not** restore the recorded session's `settingSources` — a project-tier custom slash
    command present in the terminal session's `slash_commands` was absent from the resumed one's, so
    `[]` holds across a resume and neither door it closes reopens. (b) A resume does **not** restore
    the recorded working directory or readable set — `init.cwd` came back as the **resuming** query's
    cwd, and a `Read` of the recorded session's own cwd reached `canUseTool` and was asked about
    rather than waved through. (c) `forkSession: true` works: the source transcript was byte-identical
    (same sha, size and mtime) afterwards, and the fork landed in the resuming project's own store
    under a new session id. A resumed session also starts with **zero grants and an empty write
    scope** — grants live on main's per-window entry and are written nowhere — so a path that
    conversation read freely raises a prompt on its first turn in the pane.
  - **The store is read through the SDK, never walked.** `listStoredSessions(dir)` and
    `readStoredMessages(id, dir)` in `agent-sdk.ts` wrap the SDK's `listSessions` /
    `getSessionMessages`; `~/.claude/projects/<slug>/` is private layout with a lossy slug encoding.
    **Neither throws** — a store that cannot be read is an empty picker, not a broken pane.
    `forkSession: true` is a query option, so the SDK's separate `forkSession()` helper is unused.
  - **The filter is the recorded `cwd`, not "started in a terminal", and that is a measured
    divergence.** `listSessions({ includeProgrammatic: false })` gives parity with the terminal's
    `/resume`, but it returns **zero** rows for SDK-started sessions — which would hide every
    conversation this app itself has ever run. `resumableFrom` filters by recorded `cwd` **equality**
    (not containment) plus `includeWorktrees: false`, minus this window's own live and exhausted ids.
    Yesterday's pane conversation is as resumable as yesterday's terminal one.
  - **An id crosses only if main published it.** `session:resume` names a session main has **no entry
    for**, so `claude-session.ts` keeps a per-`webContents.id` `offered` set of the ids it put in the
    last list and refuses anything else.
  - **The replay cost is quoted at a NAMED rate.** `REPLAY_USD_PER_MTOK = 3`, written into the
    sentence, alongside "an estimate, not a bill" — the pane's model is selectable, so a bare dollar
    figure would be trusted for something it cannot be.
  - **A resumed session's earlier turns are NOT re-rendered in the scrollback** — they are in the
    model's context. The pane clears the transcript and posts one `resumedNotice` saying what was
    picked up, what it cost and that it forked.
- **`interrupt()`'s receipt is surfaced.** `stop()` returns `{ stillQueued }` off the
  `query.interrupt()` receipt and `stopSession` emits a `notice` when the interrupt left messages
  queued.
- **A pending prompt is visible from every route.** `session-context.tsx` tracks `pending` and
  `outcomes` and auto-opens the pane on a `permission` event; `top-nav.tsx` carries an amber pending
  badge (`data-testid="session-toggle-pending"`) that **outranks** the busy dot, because a parked
  question and a running turn are different states and the one nobody can act on is not the one to
  show. The card itself is pinned above the composer, not inline in the scrollback.
- **The layout is a root-level flex row, and the pane is not rendered by `TopNav`.** `__root.tsx`
  puts the route column and the pane side by side; `top-nav.tsx` carries only the toggle
  (`data-session-toggle`), because the top bar remounts on every navigation and a transcript owned
  there would be discarded the moment the user opened another route. `create-shell.tsx` drops its
  460px `FilePreview` column while the pane is open, so the create grid goes `936px 460px` → one
  column.

### Running a tool from the network — the usage-stats decision

`/tools`' Usage Stats tab is the one feature whose tool may be **fetched from npm and executed**.
`src/core/ccusage.ts` carries the argument in full; the shape of it:

1. **A local copy wins.** The open project's `node_modules/.bin` first (a repo that pinned ccusage
   has already made this decision), then the same expanded directory list `claude` is resolved
   against — a GUI-launched app's PATH is not the user's PATH.
2. **A remote fetch is pinned**, to `PINNED_CCUSAGE_VERSION` in that file. `@latest` means the
   app's behaviour changes without the app changing: a release published this afternoon runs
   tonight, with output `reduceUsage` has never seen and a supply chain nobody reviewed. Bumping
   it is a diff, and the reduction is written against that version.
3. **It is shown first.** `stats:preview` resolves and returns the exact argv plus
   `network: true/false`, and spawns nothing; `stats:run` accepts only the token preview issued.
   So "the user was told a package would be fetched and executed" is a property of the wiring.
4. **It degrades in the preview.** A machine with neither `ccusage` nor `npx` gets a message naming
   the tool and where it was looked for, while the Run button is still un-pressed — not an ENOENT
   after a spawn.

What was **not** done, and why: the fetch was not removed. ccusage parses `~/.claude`'s own JSONL,
and reimplementing that here would be a second reader of someone else's file format, drifting in
silence. It was also not vendored — a dependency of the app is one the app ships, and a user who
never opens this tab should not carry it.

## Things that bite

- **Hash history, not browser history.** A packaged build loads the renderer over `file://`,
  where pushState paths don't resolve on reload. See `src/renderer/src/main.tsx`. **Corollary: a
  route cannot also use the URL fragment.** The whole route already lives in `location.hash`, so a
  second `#` in it is not something the router or `querySelector` can be trusted to split — which
  is why the docs reader carries the heading to scroll to as the `at` SEARCH param and scrolls by
  element id. For the same reason `/docs/$slug` intercepts in-page `#anchor` links in rendered
  markdown: left alone, one would rewrite the route and throw the reader out of the app.
- **`components={{ text: … }}` in react-markdown highlights nothing.** `components` is keyed by
  ELEMENT name, and `text` is the **SVG** `<text>` element, not a markdown text node. It
  type-checks (it is a real JSX intrinsic), it renders, and the body highlight silently never
  happens — a window probe counting zero `<mark>` elements in an article opened from a search hit is
  what caught it. Text nodes are reachable from a rehype plugin, so `utils/highlight.ts` marks the
  hast tree instead; that also means a term inside a link, a list item or a table cell lights up,
  which the per-element approach could not do.
- **A doc slug is renderer input, and the reader treats it as such.** `isValidDocSlug` in
  `src/core/docs.ts` rejects anything containing `/`, `\` or `.` _before_ the path is joined. The
  slug arrives as a route param, so `../../../etc/passwd` is a file `readDoc` would otherwise be
  perfectly happy to open and render. Keep the check if you touch that function, and keep it before
  the `path.join`, not after.
- **Two functions answer to "get the rules", and they are not the same set.**
  `discoverRuleLibrary` reads `<project>/rules/*.md` — what the project publishes, shown on
  `/tools`. `discoverProjectRules` reads every `.claude/rules/` in the tree — what is assigned to a
  directory, shown on `/rules`, and what a save MOVES. A project can have either without the other,
  so they were deliberately not unified; the names and the return types (`RuleLibraryEntry` with
  `title`/`paths` vs `ProjectRule` with `id`/`dir`) are what keep the next reader from assuming one
  view manages the other's files.
- **The pane's state cannot live in the pane — `TopNav` remounts on every navigation.** The toggle
  is rendered by the top bar, which each route mounts for itself, so a transcript held in
  `session-pane.tsx` would be discarded the moment the user clicked Docs to look something up.
  Worse, the session id is the only handle on a turn in flight: losing it leaves Claude running with
  no Stop to press. Hence `SessionProvider` in `__root.tsx`, inside `ProjectProvider` (a project
  switch ends the session) and above the `Outlet`, with the pane a **sibling of the route column**
  rather than a child of the top bar. `utils/session-context.tsx` is also the only module in the
  renderer allowed to touch `window.maestro.session` — single-owner, exactly like
  `SessionLogProvider` and the log tail, and for the same reason: main keeps one session per
  `webContents.id`, so a second subscriber steals it.
- **Clear the transcript BEFORE a resume round trip, never after.** Main pushes the resumed
  session's notice **during** the `session:resume` call, so `setEntries([])` after the `await`
  deletes the one thing that says what was picked up, what it cost and that it forked — and the pane
  then looks as though it started a session silently. Nothing errors, no test catches it, and it is
  only visible in a real window. The same ordering applies to any channel where main streams an event
  while the handler is still resolving.
- **`__root.tsx` has no `shellComponent`.** The root route owns no `<html>` document — `<head>`,
  `<body>` and the theme bootstrap live in `src/renderer/index.html`, along with the renderer CSP.
- **`@repo/claude-fs` must be bundled into main, not externalized.** It's a workspace _source_
  package with no build artifact, so `require` can't resolve it at runtime — hence the
  `externalizeDepsPlugin({ exclude: [...] })` in `electron.vite.config.ts`. `src/core/` is ordinary
  app source that gets bundled without anyone having to ask.
- **`externalizeDepsPlugin` does not externalize anything here, and the app's runtime
  `dependencies` are externalized by hand.** The plugin computes its list from package.json
  `dependencies` and then assigns `config.build` from inside the `config` hook — a vite / electron-vite
  breakage documented in `electron.vite.config.ts` for its `include` option, and it costs the whole
  plugin. This was invisible for as long as the app had **no `dependencies` block at all** (every
  entry was a devDependency), because an empty external list and an ignored one look identical.
  Measured when the first real dependency arrived: `@anthropic-ai/claude-agent-sdk` in
  `dependencies` and only the plugin to externalize it put **1.34 MB of SDK into
  `out/main/chunks/`**. `EXTERNAL` in `electron.vite.config.ts` now derives from the manifest and
  goes into `rollupOptions.external`, where it actually takes effect — including a regex for
  subpath imports, which a bare package name does not cover. The plugin call stays because it is
  harmless and correct in intent; it is simply not what is doing the work.
- **The Agent SDK resolves a CLI on disk, so bundling it breaks it — and asar is the second half.**
  `@anthropic-ai/claude-agent-sdk` (see `src/core/agent-sdk.ts`) is a real runtime dependency: it
  spawns the `claude` binary the user is logged into. Inlined into the bundle, its own
  `require.resolve` runs against `out/main/` and throws `Native CLI binary for <platform> not
  found`. **NOTE FOR WHOEVER ADDS PACKAGING:** externalizing is necessary and not sufficient. A
  packaged app also needs `asar: { unpack: "**/node_modules/@anthropic-ai/**" }` plus rewriting
  `app.asar` → `app.asar.unpacked` on the resolved path — the single most reported
  Agent-SDK-in-Electron failure. It is **not actionable yet**: there is no electron-builder config
  in this repo, so there is nowhere to write it. The smoke receipt's `sdkVersion` is the tell —
  `null` means the package could not be resolved at runtime, which is what that failure looks like.
- **The SDK is handed the resolved CLI path; left alone it spawns `node`.** Its default resolution
  runs a bundled `cli.js` through a JS runtime, and a GUI-launched Electron app has a PATH with no
  `node` on it — `spawn node ENOENT`, and it never reproduces from a terminal. So
  `pathToClaudeCodeExecutable` gets `resolveClaudeCli().bin`, which `claude-cli.ts` decides with
  `fs`.
- **The SDK's `env` option REPLACES the child environment rather than merging it.** So the naive
  way to withhold an `ANTHROPIC_API_KEY` — which would silently bill the API instead of the user's
  subscription — also drops `PATH`, and the CLI shells out to git and to hooks. `agentChildEnv()`
  builds it in full: credentials deleted, expanded PATH set, provider variables
  (`CLAUDE_CODE_USE_BEDROCK` and friends) left alone but reported. `settingSources: []` closes the
  second door, a key in `~/.claude/settings.json`, which would override the environment anyway.
  `test/core/agent-sdk.test.ts` pins both halves.
- **`settingSources: []` appears FOUR times in `agent-sdk.ts`, and they must stay in lockstep.** The
  smoke query, the run's own session, the pane session, and `resolveEffectiveSettings(cwd)` — the
  last of which backs the read disclosure. The first three are so nothing on disk can redirect
  billing or widen permissions; the fourth is so the confirmation describes **the session that
  actually exists**. The pane inherits the consequence in full: **a pane session auto-loads no
  `CLAUDE.md`**, so the model should be expected to be told to `Read` one. Configure the run one way
  and resolve the other and the disclosure silently becomes a lie — it keeps describing a session
  that is gone, and **nothing fails**. `test/isolation.test.ts` counts the four occurrences for
  exactly that reason. Note `[]` does not drop the managed (administrator) policy tier: it is still
  read from disk and still applies. `defaultMode` goes through the SDK's
  `filterEscalatingDefaultMode`, since the raw cascade reports an escalating mode from a
  repo-committed file as though it applied.
- **The Agent SDK is now user-facing, and it is what a run IS.** `nodeSettings()` backs the read
  disclosure in both confirmations and `startAgentSession()` is every run on `claude:run`, but
  `agent-sdk.ts` is still the **only** module in the app that imports the SDK. Everything else
  reaches it through interfaces in `contracts.ts` (`SettingsPort`) or through `agent-sdk.ts`'s own
  exports — including the SDK's `SpawnOptions`/`SpawnedProcess` **types**, which it re-exports so
  `claude-run.ts` can type its spawn function without importing the SDK itself.
- **Project switches invalidate the router.** Every route loader reads the _current_ project from
  main-process state, so `ProjectProvider` calls `router.invalidate()` on the `project:changed`
  broadcast. Without it a switch leaves stale data on screen.
- **Editor state must be keyed by `projectRoot`, or a switch writes one project into another.**
  The invalidation above only re-runs the _loader_. Any state seeded from loader data and then
  edited in place has to decide whether an incoming payload replaces it — and "did I already seed?"
  is the wrong question, because a project switch and a mid-edit re-render are both invalidations.
  Guarding on `config !== null` (`/workflows`) and on `useState(loaderData.…)` never re-running
  (`/rules`) each produced the same failure: the canvas kept rendering project A while the window
  was on B, and Save wrote A's config into B's `maestro.json`. `/workflows` keys `seedWorkflowStore`
  on `projectRoot` (and resets `activeWorkflowIdx`, which indexes the outgoing project's list);
  `/rules` remounts its editor with `key={projectRoot}`. Prefer the key — it re-initialises every
  derived piece at once. `test/workflow-store.test.ts` pins the store half; the failure is silent.
- **A save does not refresh loader data — invalidate after one.** Loaders run on navigation and
  on invalidation, and a save is neither: it doesn't navigate, and the `project:changed` broadcast
  above doesn't fire. So everything the loader computed stays pinned at its load-time value, and
  `seeded` is the visible one — after a successful save the banner kept telling the user their
  config was "not saved" while it sat on disk. `/rules` was worse, since a rules save _moves rule
  files_, leaving its tree and rule pool describing a layout that no longer exists. Both routes
  now call `router.invalidate()` on the success path, after the `!res.ok` bail-out. This is safe
  only because of the keying in the entry above — `/workflows` keeps its in-memory config
  (`seedWorkflowStore` bails on an unchanged `projectRoot`) and `/rules` doesn't remount
  (`key={projectRoot}` is unchanged) — so re-running a loader cannot discard in-flight edits.
  Verified in the window: no re-fit, no remount, and a node dragged before the save stays put.
  `test/isolation.test.ts` pins both call sites; no render test here would catch the regression.
- **The renderer CSP forbids inline script — including the theme bootstrap.** `index.html`
  declares `script-src 'self'`, so the pre-paint theme script lives in
  `src/renderer/public/theme-bootstrap.js` and is loaded as a parser-blocking `<script src>`.
  Inlining it back "because it's four lines" silently reintroduces a theme flash: the browser
  blocks it, and the theme is then applied only when `ThemeToggle`'s effect runs. The same policy
  blocks a Google Fonts `@import`, which is why fonts are vendored into `packages/styles` and served
  same-origin — do not restore a CDN `@import`, and see `packages/styles/README.md` before changing
  a weight. `test/isolation.test.ts` asserts the built renderer CSS references nothing off-origin.
- **React Flow does not inherit the app's theme.** It picks between its own `--xy-*` palettes from
  its `colorMode` prop. Unset, its Controls render a near-white icon on a near-white button in
  dark mode — invisible, and invisible to every test that isn't a screenshot. `workflow-canvas.tsx`
  drives `colorMode` off the `light`/`dark` class on `<html>` via a `MutationObserver`, because
  "auto" resolves against the OS and the toggle can change it while the canvas is mounted.
- **Hook scripts are copied into a project as `.cjs`, never `.js`.** The plugin runs them as
  `.js` because its directory has no package.json declaring a module type. A project's does, and
  `"type": "module"` makes node parse their `require()` as ESM — the hook then fails on _every
  tool call_ with "require is not defined in ES module scope". Nothing catches this but running a
  copied script from inside such a project, which `test/install.test.ts` does.
- **Two things can register Maestro's hooks, and the plugin's copy stands down per hook.** A
  project installed from `/maestro` (formerly `/install`) has them in its own settings; the
  `maestro` plugin registers the same ones globally from its `hooks.json`. Both firing used to log
  every tool call twice and inject every subagent's context twice. `projectOwnsHook`
  (`src/core/hook-arbitration.ts`) now arbitrates it: each of the plugin's four hook scripts exits 0
  for a hook the project registers itself, and still runs for every hook it doesn't. The test is on
  the **registration**, never on the copied script existing — a plain (non-purging) uninstall leaves
  `.claude/scripts/` on disk, and keying on the file would suppress the plugin in favour of hooks
  nobody runs. `InstallStatus.pluginHooksActive` and its warnings are gone. The guard ships in the
  plugin's own copy of the scripts, so it reaches a machine only on a `plugin.json` version bump
  (`0.3.3`) and re-pull. `maestro-session-cleanup.sh` deliberately has no guard: both copies `rm -f`
  the same three files, so a double fire is unobservable.
- **Uninstall has two levels and the destructive one is never the default.** Plain uninstall
  unregisters the hooks and deletes the ephemeral session files, and **keeps `maestro.json`** —
  a user turning the hooks off has not asked to lose their workflow graph and rule assignments.
  Only purge deletes the skill, the copied scripts and the config, and it is reachable _only_
  through the confirmation dialog, which lists the exact files first. The `purge` flag is explicit
  at every hop — `uninstall(purge: boolean)` in the context takes no default, and the IPC handler
  reads `opts?.purge === true` — so no malformed or missing argument can escalate a call into a
  purge. `test/core/uninstall.test.ts` asserts what each level _leaves_.
- **Staleness is content, never mtime.** `installedRuntimeId`/`shippedRuntimeId` are sha-256 over
  the runtime manifest. A `git clone` rewrites every mtime, so an mtime comparison would report a
  fresh checkout as stale and make the badge noise the user learns to ignore.
- **The seeded chain is detected, and only proposed while nothing is on disk.** `data:workflows`
  calls `detectImplAgents()` (in `src/core/detect.ts`) and returns the `RepoDetection` on the same
  payload as the seed — one round trip, so the evidence cannot describe a different chain than the
  canvas is showing. `DetectedChain` renders only when `seeded`: once `maestro.json` exists the
  chain is the user's saved answer, and re-proposing a detected one over a graph they built would be
  offering to overwrite their work. Correcting the chain goes back to main (`data:reseed`) to
  rebuild the seed with the _same_ `defaultV3Config`, rather than duplicating the builder in the
  renderer — it is pure, but it lives behind the barrel that re-exports `fs`. The round trip is why
  `replaceConfig()` takes a project root and drops a result whose root no longer matches: a
  re-seed in flight across a project switch would otherwise land project A's starter graph on B's
  canvas, the same failure `seedWorkflowStore`'s guard exists for.
- **The create routes' preview and their scaffold must resolve the same path.** Both go through
  `resolveCreateTarget` in `src/core/scaffold.ts`, and the confirmation dialog names the file it
  returns. A second resolution anywhere — a path computed in the renderer, a `path.join` inlined
  into a prompt builder — makes the modal describe a file other than the one on disk, and the
  user is being asked to consent to the wrong thing. `test/create-preview.test.ts` and
  `test/scaffold.test.ts` in that package compare the two.
- **The renderer's `utils/text.ts` re-exports and must never implement.** `buildDesc` decides the
  `description:` frontmatter, and the form's live preview shows it _before_ the file exists while
  the node-side scaffold writes it after. Two implementations means a preview that can silently
  stop matching the file — and it looks fine right up until someone edits one of them.
  `src/core/text.ts` is the one home; note that module rather than the barrel, which re-exports
  `fs`. `test/isolation.test.ts` fails on a re-implementation anywhere under `src/renderer`.
- **A create-\* run's working directory is not always the open project.** A skill written into a
  marketplace repo, or a brand-new marketplace, lives outside it. `claude-preview.ts` derives the cwd
  from the same resolution that chose the path; the dialog shows it. Verified in the window: a
  marketplace-target skill runs in the marketplace. The cwd bounds nothing here — `writable` does —
  so a write to the run's **own** working directory is refused unless the preview listed it.
  Verified live: a `README.md` the model tried to write beside its target was denied, and the file
  does not exist.
- **The prompt is prose, never `/create-skill`.** A slash command in a headless run re-enters the
  skill from the top instead of finishing the scaffold, and re-derives fields the payload already
  carries. `buildCreate` states facts only — the scaffold already wrote the target with its
  frontmatter complete, do not recreate or move it — plus the name of the
  `plugins/maestro/skills/<kind>/SKILL.md` that holds the guidance, and the session loads
  that guidance itself with the `Skill` tool rather than reading it pre-pasted into the prompt. A
  slash command is still wrong for the same underlying reason: it re-enters the skill's "gather
  everything from scratch" entry instead of the one written for an already-scaffolded artifact. A
  test asserts no create prompt contains a slash command.
- **`claude:run` takes a token and nothing else, and the preload must keep it that way.** The
  bridge's guarantee — the only executable prompts are ones the user was shown — comes from the
  run channel having no argument that could describe a different run. A preload that "helpfully"
  forwarded the prompt or argv alongside the token would reopen that in a diff that reads as a
  convenience, and every test under `test/core/` would still pass, because none of them can
  see this side of the wire. `test/isolation.test.ts` pins the call to `invoke(IPC.claudeRun,
token)` for that reason. The same applies to `claude:preview`, which takes a **request** —
  main builds the prompt; the renderer never supplies one.
- **Preview tokens are dropped on a project switch** (`clearInvocations()` in `announce()`). A
  token names the outgoing project's cwd, so a modal left open across a switch would otherwise
  still have a live token and Run would spawn Claude against the repo the window has moved off —
  the same failure shape as the `seedWorkflowStore` keying above.
- **A cancelled run's child is detached, so quitting must kill it.** The child is spawned into its
  own process group (that is how Stop reaches the CLI's _own_ children), which also means it
  outlives the app. `disposeIpc` calls `disposeClaudeRuns()`; without it, closing the window leaves
  Claude running against the user's repo with nothing left to stop it from. Closing the SDK query is
  **not** a substitute — it releases the child the SDK knows about and reaches none of its
  grandchildren — which is why teardown does both, in that order. Verified by inspecting processes:
  the CLI's pgid is not the app's, Stop kills the group, and quitting mid-run leaves nothing behind.
- **`claude` is resolved explicitly, never off `process.env.PATH` alone.** A GUI-launched Electron
  app gets a PATH that does not include `~/.local/bin`, which is where the CLI installs — so the
  app reported "not installed" on machines where `which claude` answers instantly. This does not
  reproduce from a terminal, and no unit test in this app can see it. Verified by launching from a
  desktop entry; see `src/core/claude-cli.ts`. `git` is resolved the same way and for the same
  reason, through the `resolveOnPath(names, opts)` that `resolveClaudeCli` is now a one-line call to.
- **`src/core/git.ts` runs its own spawner, reviewed like every other one in `test/isolation.test.ts`.**
  The app runs `git` itself, `execFileSync` with an argument vector and no shell interpretation, so a
  marketplace name with a quote in it cannot become syntax. It is also **not** a path to Claude — it
  is a separate reviewed spawner, unrelated to the `resolveClaudeCli` caller list.
- **The log tail is retargeted on a project switch**, in `main/ipc.ts`. Otherwise a window keeps
  streaming the previously-opened repo's session log.
- **`window.maestro.log.subscribe` is single-owner.** Main keeps one tail per `webContents.id`
  and stops the old one before starting a new one, so a second subscriber steals the tail and the
  first unsubscribe stops it for both. The owner is `SessionLogProvider`; read from it with
  `useSessionLog()`. A test pins the call site to one file.
- **Every fallible main-process call goes through `callMain()`** (`renderer/src/utils/call-main.ts`).
  `ipcMain.handle` handlers throw — `config:save` throws when no project is open, and every route
  is reachable in that state. A bare `await` on a rejected channel is an unhandled rejection: no
  toast, and any `setPhase("idle")` after the await never runs, so the button spins forever. Pair
  it with `try/finally` around the phase reset.
- **`getState()` in `project-store.ts` must not write.** It is called by `currentRoot()` from
  every IPC handler; pruning-and-rewriting there meant an `existsSync` per remembered project per
  handler call and made merely opening the app mutate `projects.json`. Pruning happens once when
  the file is first read, and only real mutations persist.
- **`test/isolation.test.ts` guards the process boundary.** `nodeIntegration: false`,
  `contextIsolation: true`, one exposed namespace, no generic `invoke(channel, …)` escape hatch,
  no node builtins in the built renderer bundle, and — outside `src/main/` — no import of the
  `src/core/index.ts` barrel, `@repo/claude-fs`, or any `node:` builtin. These are configuration
  and convention properties: they'd all regress silently without assertions. It also pins the
  permission model: **"pre-accepts edits nowhere in the app"** fails if
  `acceptEdits`/`bypassPermissions`/`dangerouslySkipPermissions` reappears under `src/`; **"bounds a
  session's writes by what the preview displayed, and offers it no shell"** pins `canUseTool`,
  `decideWrite`, `permissionMode: "default"`, `spawnClaudeCodeProcess`, the two tool lists and
  `writable: inv.writable`; and **"loads no filesystem settings for a run, and discloses the same
  resolution"** counts the four `settingSources: []` so the run and the disclosure cannot drift.
  The session-pane describe pins: `session:say` carries only user-typed text,
  `session-context.tsx` is the single owner of `window.maestro.session`, and the pane is not
  rendered by `top-nav.tsx`; that "asks a person instead of deciding, and resolves every ask on
  every exit", "lets the renderer send a permission CHOICE and never a permission result", and
  "writes down a refusal whichever of the four routes it arrived by" — the last one is the only
  coverage the `rule`/`mode` auto-denial has outside a unit test, since provoking it live needs a
  machine-wide managed-settings file; that a grant carries no path, that
  `SessionPermissionUpdate` cannot name a disk destination or a rule, that no such literal exists
  anywhere under `src/`, and that a grant reaches the hook as well as the SDK, plus "lets a grant
  die with the session, and writes it nowhere" and "watches the other doors into the read scope,
  and does not follow any of them"; that the pane's write scope grows only from a claimed preview
  token and never from the renderer (pinning `writable()`, the single `allowWrites` call site, the
  `claimInvocation` claim, and the token-only wire), and that a handoff's seed context spends no
  turn and says so in the transcript (`shouldQuery: false`, no `origin` stamp on the seeded
  message, the zero-cost-result guard, one seed string reaching the model and the transcript both);
  "lets the renderer send a question SELECTION and never the answer payload" — it pins the
  `session:question` call shape, that `QuestionChoice`'s two arms cannot express an answers map,
  that `updatedInput` appears in exactly two files (`contracts.ts` declares it, `agent-sdk.ts`
  fills it in) and in nothing under `src/renderer` or `src/main`, that the labels are validated
  **before** anything is answered, that `AskUserQuestion` is in `PANE_TOOLS` with the `toolConfig`
  opt-in and never in `allowedTools`, and that there is exactly one registry behind both kinds of
  ask; "stops a session at a spend ceiling and gives the ending a door" pins the three limits,
  `persistSession: true`, both halves of the ceiling exit (the latch read in the `catch` **and**
  the `break` the streaming pump needs), that the spend figure is fed behind the zero-cost-result
  guard, that the exhausted entry is kept only for a ceiling, that `session:continue` carries an id
  and nothing else, and that `startPaneSession` is called from **exactly one** place in
  `claude-session.ts` — a second builder is how a resumed session quietly gets a different tool set;
  "changes effort and model on a live session, from lists main published" pins that both are
  checked against something this process produced (`isEffortLevel`, `entry.models.some`), which is
  the permission wire's discipline applied to a header control; and "picks up a foreign
  conversation only from a list main published, and forks when it does" pins the `offered` set (an
  id main did not publish is refused), that `fork` reaches the query as `forkSession: true` and
  only ever alongside `resume`, that `resumeSession` goes through the same single `openSession`
  builder as the other three callers, and that the store is read through `listStoredSessions` /
  `readStoredMessages` rather than by walking `~/.claude/projects/`.
- **The renderer bundle is code-split** (`autoCodeSplitting: true`). Measured 2026-07-31: unsplit
  was one 2,346 kB chunk; split is 593 kB shared + 772 kB `/workflows` (React Flow + dagre) +
  802 kB `/maestro-tasks` (react-markdown) + ~26 kB for the rest. The landing route is `/`, the
  project picker, which needs none of that — so startup parse drops by roughly 75%.
  Re-measured 2026-08-04, by counting the chunks the packaged app actually requests (CDP
  `Network.requestWillBeSent`; `file://` module loads produce no `PerformanceResourceTiming`
  entries, so the obvious way to measure this returns an empty array and reads as "nothing
  loaded"): the landing route pulls 14 chunks / 1,107 kB; `/tools` adds 117 kB; `/docs/$slug` adds
  558 kB, of which 555 kB is the react-markdown chunk SHARED with `/maestro-tasks` rather than
  duplicated into it. What makes this safe over the packaged `file://` load is that assets resolve
  relatively (`base: "./"`); anything that regresses that leaves routes blank in a packaged build
  while `dev` — served over `http://localhost:5173` — stays perfectly happy. **`dev` does not
  exercise the `file://` path at all**: `main/index.ts` only calls `loadFile()` when
  `ELECTRON_RENDERER_URL` is unset. Verify route navigation with `build` + `start`, never with
  `dev` alone.

## Dev

### Node version — `node:sqlite`

`skill-tags.ts` (the Skills tab's tag store) uses Node's built-in `node:sqlite`, not
`better-sqlite3` — no native module, no Electron-rebuild step. Electron 40 bundles Node 24, where
it loads fine (just the standard experimental-feature warning); running the test suite or
`maestro-install.js` under an older system `node` needs at least 22.5 for the module to exist at
all. `maestro-install.js`'s own `require("./lib/maestro-skill-tags.cjs")` is wrapped in try/catch
for exactly that case — an older `node` on a session's PATH degrades to the pre-tags, fully
Claude-driven best-fit flow rather than failing the install.

### Linux sandbox fix (required after any install that re-extracts Electron)

```bash
sudo chown root:root node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/.pnpm/electron@*/node_modules/electron/dist/chrome-sandbox
```

Without it `dev` aborts with _"The SUID sandbox helper binary was found, but is not configured
correctly"_. pnpm doesn't preserve the setuid bit, and both `node_modules/electron` and
`apps/maestro/node_modules/electron` symlink into the store — so fix the store copy, not the
links. Do **not** work around it with `--no-sandbox`: the renderer's isolation from the OS is the
premise `test/isolation.test.ts` exists to defend. (`gits/farel` documents the same fix for an
npm layout.)

```bash
pnpm --filter maestro dev        # electron-vite dev, HMR on the renderer
pnpm --filter maestro build
pnpm --filter maestro typecheck  # both tsconfig projects
pnpm --filter maestro test       # test/ and test/core/ as one suite
pnpm --filter maestro build:plugin-libs   # after ANY edit under src/core/plugin-entries' graph
```

`test/core/` is where the differential tests live: parity against the last hand-written `.cjs`
implementations (snapshotted under `test/core/fixtures/legacy/`, deliberately _not_ read from
`plugins/…/scripts/lib/`, which `build:plugin-libs` overwrites — that comparison would be
tautological), a byte-identity check on the rendered `SKILL.md`, and the import-graph walk that
proves `claude-preview.ts` cannot spawn.

### Driving the window (canvas interactions, screenshots)

Nothing in `test/` can reach the canvas: React Flow measures the DOM, dagre lays out against real
dimensions, and drag-to-persist only means something with actual pointer events. To exercise that,
launch the **packaged** build with a debugging port and an isolated profile, then speak CDP to it:

```bash
cd apps/maestro
./node_modules/.bin/electron . --remote-debugging-port=9222 --user-data-dir=/tmp/maestro-probe
```

`http://127.0.0.1:9222/json/list` gives the renderer's WebSocket URL; Node 22's global `WebSocket`
speaks the protocol with no dependency added to the repo. `Runtime.evaluate` reads the DOM,
`Input.dispatchMouseEvent` (press → several moves → release) does a drag React Flow will honour,
`Page.captureScreenshot` with a `clip` gives a zoomed crop, and
`Page.addScriptToEvaluateOnNewDocument` installs a per-frame sampler _before_ any page script runs
— that last one is how the `mounted` flag was settled. `window.maestro.project.open(path)` is
exposed to the renderer, so a probe can switch projects without the native folder dialog.

Use `electron .` rather than `pnpm start`, and never `dev`: `dev` serves the renderer over
`http://localhost:5173` and skips the `file://` path that ships. The project's own
`test-maestro` skill (`.claude/skills/test-maestro/`) wraps this workflow with scripts and fixture
rules — prefer it over hand-rolling CDP calls.

### Checking the Agent SDK from a real launch

The SDK's failure modes are packaging failures — a bundled SDK, an unresolvable CLI, a PATH a
terminal would never hand you — so no vitest run and no CDP probe of the renderer can see them.
`MAESTRO_AGENT_SDK_SMOKE` runs one query from main at startup and leaves a JSON receipt:

```bash
# dev
MAESTRO_AGENT_SDK_SMOKE=/tmp/dev-smoke.json pnpm --filter maestro dev

# the packaged bundle, with the PATH a GUI launch actually gets (no ~/.local/bin, no shell rc)
env -i HOME="$HOME" DISPLAY=:0 WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/$(id -u) \
  DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus" PATH=/usr/local/bin:/usr/bin:/bin \
  MAESTRO_AGENT_SDK_SMOKE=/tmp/packaged-smoke.json \
  node_modules/.pnpm/electron@*/node_modules/electron/dist/electron apps/maestro \
  --user-data-dir=/tmp/maestro-smoke

# and from a real desktop entry, which is the launch the PATH bug only reproduces from
gio launch /path/to/maestro-smoke.desktop     # Exec=env MAESTRO_AGENT_SDK_SMOKE=… <electron> <appdir>
```

Read the receipt rather than the exit code. `ok`, `billing: "subscription"` (an `api-key` here
means a credential got through), `bin` (should be the resolved `~/.local/bin/claude`, not a guess),
`env.dropped`/`env.hasPath`, and `sdkVersion` — `null` there means the package could not be
resolved at runtime, which is the asar failure above. Unset, the variable runs nothing; the app
spawns nothing on a normal launch.
