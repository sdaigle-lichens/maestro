---
name: create-skills-architecture
description: "Explains how the four create-* flows (create-skill, create-subagent, create-plugin, create-marketplace) work end-to-end: the desktop app's form routes, the deterministic scaffold in src/core, the confirmation dialog and the Agent SDK session it runs, and the consuming SKILL.md prompts. Use when the user is working inside apps/maestro or plugins/maestro and asks how a create flow works, where to add a new field, why a form change isn't reaching the prompt, why the confirmation dialog did or didn't open, why a run was refused a write, or how target=project differs from target=marketplace."
metadata:
  type: concept-skill
  version: "1.0"
  last-update: ff24b375eadb31a3b2628a3070bc8631a08063fa
---

# Create-Skills Architecture

Four creation flows share one pipeline: `create-skill`, `create-subagent`, `create-plugin`,
`create-marketplace`. Each is a route in the Maestro desktop app, a scaffold function in
`src/core`, and a `SKILL.md` prompt the app hands to a Claude run — which since `018` is an **Agent
SDK session**, not a `claude -p` spawn.

## End-to-end pipeline

```
User opens the Maestro desktop app → /tools → Skills tab → Create (link at the bottom)
        │
        ▼
src/renderer/src/routes/create-skill.tsx
  • react-hook-form + zod govern state and validation (schema at the top of the route)
  • split pane: form left, live FilePreview right — the file that WILL be generated
  • the preview's description comes from src/core/text.ts's buildDesc, the same
    implementation the scaffold uses, so preview and file cannot disagree
        │ submit
        ▼
utils/create-flow.tsx  — the submit path all four routes share
        │
        ├─1─▶ window.maestro.create.scaffold(request)     IPC `create:scaffold`
        │       → scaffoldSkill/Subagent/Plugin/Marketplace in src/core
        │         writes the directory, the frontmatter, the plugin manifest, the
        │         marketplace registration — everything deterministic
        │         and, for a new marketplace, `git init` + the first commit
        │       ← { path, name, needsModel, repo?, ... }
        │       NO MODEL, and none reachable: the module behind it imports nothing
        │       that can reach one. `git` arrives as an injected GitPort, not an import.
        │
        └─2─▶ only when needsModel:
              window.maestro.claude.preview(request)      IPC `claude:preview`
                → builds the prompt (prose, never a slash command), resolves the argv,
                  the cwd, and the files it may write; resolves the EFFECTIVE settings
                  for that cwd through an injected SettingsPort and derives what the
                  run can READ; returns a TOKEN. Async. Spawns nothing.
              ClaudeRunDialog shows what it can read, then the full prompt,
                the EQUIVALENT command line, cwd, targets
                → Copy prompt / Cancel / Run / Continue in the pane
              window.maestro.claude.run(token)            IPC `claude:run`
                → starts an Agent SDK session over that invocation and streams it;
                  `canUseTool` allows writes to `targets` and denies everything
                  else with a reason; no shell, no subagents
                → `claude:cancel` closes the query, then kills the process group
              window.maestro.session.handoff(token)       IPC `session:handoff`
                → the SAME single-use token, spent on the session pane instead:
                  opens the artifact's own directory for writing, seeds what was
                  scaffolded without spending a turn, and the user drives it
        │
        ▼
The run — headless or in the pane — calls the Skill tool for
plugins/maestro/skills/create-<name>/SKILL.md and finishes only what
the scaffold left — authoring a body, enriching a README. `026` deleted the
second copy of that guidance that used to be inlined into the prompt itself;
see "The guidance lives in exactly one place" below.
```

**The ordering in 1–2 is the design.** The artifact is on disk before Claude is mentioned, so
cancelling the confirmation — or having no CLI installed at all — still leaves the user with the
thing they asked for. `needsModel` decides whether the dialog opens by itself: an auto-mode body or
a brand-new marketplace's docs need one; a manual-mode skeleton and a plugin manifest are complete
as written. **Finish with Claude** on the result card stays available either way.

**Two buttons spend the same token, and only one of them widens anything** (`022`). **Run** is the
headless finish above. **Continue in the pane** calls `session:handoff` with the token and nothing
else: main claims it, reads `ClaudePreview.handoff` (a `HandoffContext` — kind, name, artifact,
`writeScope`, `scope`, the frontmatter or directory listing read off disk, and `016`'s repository
state), adds that **one** path to the pane session's write scope, and seeds the context with
`shouldQuery: false` so nothing is spent until the user types. `handoff` is `null` for a
`maestro-task` preview and the channel refuses such a token — a task's write target is the whole
project. The scope entry is the artifact's own directory (`CreateTarget.dir`), or the artifact FILE
where `dir` is `""` — a project-target subagent shares `.claude/agents/` with every other agent.

There is no hook in this path, no result file, and no blocking wait. `/create-skill` typed into a
session is a different thing entirely: the skill prompt with no payload and nothing pre-scaffolded,
which the SKILL.md handles by gathering the fields conversationally.

## The guidance lives in exactly one place (`026`)

The finishing guidance for a scaffolded artifact used to exist twice: once in the four
`plugins/maestro/skills/create-*/SKILL.md` files, and a second time inlined into the prompt
`claude-preview.ts`'s `buildCreate` built for a headless run. `026` deleted the second copy.
`buildCreate` now states facts only — the scaffold already wrote the target with its
frontmatter/manifest complete, do not recreate it, move it, or change its frontmatter — plus the name
of the `SKILL.md` that holds the guidance, and tells the session to follow it because "this is the
app entry it describes, so do not re-ask for anything below."

That only works because a run can actually reach the skill's body now, on **both** entries:

- `SESSION_TOOLS = [...READ_ONLY_TOOLS, "Edit", "Write", "Skill"]` — `Skill` moved out of the
  pane-only tool set and into the base one. A headless run offers it too; `AskUserQuestion` remains
  pane-only, since a headless run still has nobody to answer a question.
- `SESSION_SKILLS = ["create-skill", "create-subagent", "create-plugin", "create-marketplace"]`. The
  pane extends it with `super-help`: `PANE_SKILLS = [...SESSION_SKILLS, "super-help"]`.
  `PANE_TOOLS = [...SESSION_TOOLS, QUESTION_TOOL]` — it no longer names `"Skill"` a second time.
- Naming a skill is not enough on its own — `019` already established that `skills: [...]` with no
  `plugins` entry makes the `Skill` tool answer "Unknown skill" for every name, because
  `settingSources: []` means no installed plugin reaches the session either. So `AgentSessionRequest`
  gained `pluginDir?: string | null`, and the headless query now passes
  `skills: request.pluginDir ? [...SESSION_SKILLS] : []` and
  `plugins: request.pluginDir ? [{ type: "local", path: request.pluginDir }] : []` — the same
  `bundledPluginDir()` the pane has always used, now plumbed through the composition root for a
  headless run too: `src/main/ipc.ts` passes `pluginDir: bundledPluginDir()` on `claude:run`,
  `ClaudeRunEvents` carries it, and `runPreviewedClaude` forwards it into `agent-sdk.ts`.

The four `SKILL.md` files were rewritten alongside this to serve both entries: a table near the top
("Which entry you are on") tells the session whether it is finishing an already-scaffolded artifact
(app — pane or headless) or starting one from nothing (a bare terminal), and the app entries are told
never to re-ask for a field the form already decided.

## File-by-file map

Renderer paths are relative to `apps/maestro/`.

| Concern                                                                              | File                                                                                                             |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Form (route): schema, fields, preview, shortcut map                                  | `src/renderer/src/routes/create-<name>.tsx`                                                                      |
| Shared chrome: layout, header, shortcuts, submit row                                 | `src/renderer/src/components/create-shell.tsx`                                                                   |
| The scaffold → preview → dialog path, shared by all four                             | `src/renderer/src/utils/create-flow.tsx`                                                                         |
| What landed on disk, plus **Finish with Claude**                                     | `src/renderer/src/components/create-result.tsx`                                                                  |
| The confirmation: read scope, prompt, equivalent argv, cwd, targets, streamed output | `src/renderer/src/components/claude-run-dialog.tsx`                                                              |
| **Continue in the pane**: what a handoff says to the session (seed, notice, title)   | `session-handoff.ts` in `apps/maestro/src/core/` (pure), spent by `src/main/claude-session.ts`                   |
| "What it can read" — ONE component, both confirmations                               | `src/renderer/src/components/read-scope.tsx`                                                                     |
| Live file preview components                                                         | `src/renderer/src/components/{skill,subagent}-template-preview.tsx`, `{plugin,marketplace}-manifest-preview.tsx` |
| The typed channel contract                                                           | `src/shared/ipc.ts` (`create:options`, `create:scaffold`, `claude:preview\|run\|cancel`, `session:handoff`)      |
| Main-process handlers                                                                | `src/main/ipc.ts`                                                                                                |
| **Deterministic scaffold** + `resolveCreateTarget`                                   | `scaffold.ts` in `apps/maestro/src/core/`                                                                        |
| Making a new marketplace a repository, via `execFile`                                | `git.ts` in `apps/maestro/src/core/` (a `GitPort`, injected)                                                     |
| "Is this inside a repository?", answered with `fs`                                   | `repo.ts` in `apps/maestro/src/core/`, with no `child_process`                                                   |
| Where the `GitPort` is supplied - the composition root                               | `src/main/ipc.ts`, `scaffoldCreate(root, request, { git: nodeGit() })`                                           |
| Prompt + argv + cwd construction, and the token                                      | `claude-preview.ts`, `claude-tokens.ts` in `apps/maestro/src/core/`                                              |
| Deriving the read scope from a settings snapshot (pure)                              | `read-scope.ts` in `apps/maestro/src/core/`                                                                      |
| Deciding each write — `canUseTool`'s answer (pure)                                   | `write-scope.ts` in `apps/maestro/src/core/` (`decideWrite`)                                                     |
| Resolving the settings cascade — the `SettingsPort`                                  | `agent-sdk.ts` in `apps/maestro/src/core/` (`nodeSettings()`), injected at `src/main/ipc.ts`                     |
| The session itself, and the ONLY SDK import                                          | `agent-sdk.ts` in `apps/maestro/src/core/` (`startAgentSession`, `SESSION_TOOLS`)                                |
| Start, stream, cancel, dispose                                                       | `claude-run.ts`, `claude-cli.ts` in `apps/maestro/src/core/`                                                     |
| Marketplace discovery for the selectors                                              | `marketplaces.ts` in `apps/maestro/src/core/`                                                                    |
| `buildDesc` and friends — ONE implementation                                         | `text.ts` in `apps/maestro/src/core/`                                                                            |
| Shared UI primitives                                                                 | `packages/ui/src/`                                                                                               |
| Consuming prompt                                                                     | `plugins/maestro/skills/create-<name>/SKILL.md`                                                         |
| Shared prompt contract the four SKILL.md link to                                     | `docs/ai-tools-create-shared.md`                                                                                 |

## The four flows compared

|                                       | create-skill                | create-subagent             | create-plugin | create-marketplace |
| ------------------------------------- | --------------------------- | --------------------------- | ------------- | ------------------ |
| Mode toggle (auto / manual)           | yes                         | yes                         | no            | no                 |
| Target toggle (marketplace / project) | yes                         | yes                         | no            | no                 |
| Chip-array fields                     | `useWhen`                   | `triggers`, `tools`         | `keywords`    | —                  |
| File generated                        | `SKILL.md`                  | `AGENTS.md` or `<name>.md`  | `plugin.json` | `marketplace.json` |
| Preview type                          | YAML frontmatter + markdown | YAML frontmatter + markdown | JSON          | JSON               |
| Dialog opens on submit                | auto mode only              | auto mode only              | no            | yes                |

`create-skill` and `create-subagent` are deeply parallel — they share the description-building
algorithm (`buildDesc`: first sentence of the idea + Oxford-joined chips, clipped to 140 chars).

## Mode dispatch (skill & subagent)

- **Auto mode**: the payload carries `idea` and the chip arrays. The scaffold writes the frontmatter
  with the computed description and a placeholder body; the prompt authors the body in place.
- **Manual mode**: the payload carries `description` verbatim (plus chips). The scaffold writes a
  minimal skeleton the user will fill in, and nothing is left for a model — hence no dialog.

## Target dispatch (skill & subagent)

The `target` toggle changes where the file lands:

- `target: "marketplace"` — the payload carries `{ marketplacePath, plugin }`; the file goes to
  `<marketplacePath>/plugins/<plugin>/{skills,agents}/<name>/…`.
- `target: "project"` — the file goes to `<projectRoot>/.claude/skills/<name>/SKILL.md` (skill) or
  `<projectRoot>/.claude/agents/<name>.md` (subagent — single file, no enclosing directory).

The toggle survived the container's retirement; only its Docker half did not. Marketplace vs.
project is a real choice about where a skill lives. What went is the _path ambiguity_ that existed
only because the container could not write outside its mount — there is no longer any target the
app can see but cannot reach.

## The marketplace repository (create-marketplace only)

A new marketplace is a git repository, and the scaffold makes it one. This used to be a sentence in
the prompt — so whether the directory ended up a repository depended on whether a run happened and
did as it was told. It is a step in the same all-or-nothing list now:

```
dir → repo (git init -b main) → marketplace.json → README.md → plugins/ → commit
```

`init` is **first** and `commit` is **last**, and that ordering is load-bearing (see the rollback
rule below). A skill, a subagent or a plugin gets no repo steps at all: those are written _into_ a
repository somebody else already owns.

`planRepo()` decides up front which of **three states** applies, and reports it on the result as
`ScaffoldResult.repo` = `{ initialized, root, note }`:

| State                             | `initialized` | `root`     | What it means                                          |
| --------------------------------- | ------------- | ---------- | ------------------------------------------------------ |
| A repository was created here     | `true`        | the target | `git init` ran and the scaffold is committed           |
| The target was already inside one | `false`       | that repo  | do not nest; `enclosingRepo()` found a `.git` above it |
| No `git` on this machine          | `false`       | `null`     | the marketplace is complete; the user runs `git init`  |

**None of the three is a failure** — the marketplace on disk is complete and usable in all of them,
which is why this is a field on a successful result rather than a reason on a failed one.
`create-result.tsx` renders `repo.note`; `create-marketplace/SKILL.md` opens with a **"Do not run
git"** section and reads the reported state rather than probing for it. Remotes, private-repo
credentials and auto-update are deliberately **not** here: they need a host, an account and secrets
the app has not got, so they stay conversational and the skill offers them (never silently).

Three rules hold it together:

- **The capability is a port, not an import.** `claude-preview.ts` imports `scaffold.ts` for
  `resolveCreateTarget`, and `test/core/claude.test.ts` walks the preview's transitive import graph
  to prove it cannot start a process — one `child_process` anywhere in that graph costs the
  guarantee. So `GitPort` is an interface in `contracts.ts`, `nodeGit()` implements it in
  `src/core/git.ts`, and `src/main/ipc.ts` injects it. Omitting the port is not an error: it means
  "this caller does not do repositories". Which is exactly why the wiring is **pinned** in
  `test/isolation.test.ts` — the capability could otherwise go missing in a diff that still passes
  every test under `test/core/`.
- **A decision that must survive a missing tool is made with `fs`, not with the tool.**
  `enclosingRepo()` in `src/core/repo.ts` walks up looking for `.git` — never `git rev-parse`, which
  needs the binary and answers about the _process's_ cwd when the directory it was pointed at does
  not exist yet. That is this case exactly: the scaffold asks before it creates the marketplace.
- **Git steps roll back only themselves; every other step rolls back everything.** A `git commit`
  failure removes the half-made `.git` and is _reported_ — a marketplace without a repository is
  precisely what a machine with no git gets. But a failure of any _other_ step after `git init` does
  take the repository with it. Hence `init` first, `commit` last.

## Common edits — where to make them

| Want to…                         | Edit                                                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add a field to a form            | the route's zod schema **and** `scaffold.ts` **and** the prompt builder in `claude-preview.ts` **and** the matching `SKILL.md` — all four must agree on the payload shape |
| Change validation rules          | the zod schema at the top of the route                                                                                                                                    |
| Change the live preview          | the `<name>-preview.tsx` component                                                                                                                                        |
| Change the description algorithm | `text.ts` in `src/core` — affects skill & subagent, preview and file, at once                                                                                             |
| Change keyboard shortcuts        | the route's `SHORTCUT_SECTIONS` and `create-shell.tsx`                                                                                                                    |
| Add a new shared UI primitive    | new file in `packages/ui/src/`, then an export in `packages/ui/package.json`                                                                                              |
| Add a new create-\* flow         | new route + a `scaffold*` function + a preview builder + a `SKILL.md`; wire it in as a **Create** link at the bottom of the matching `/tools` tab (`components/tabs/create-link.tsx`), not into a top-bar menu |

## Things that bite

- **Don't change the payload in just one place.** A field rename must hit the form schema, the
  scaffold, the prompt builder, _and_ the consuming `SKILL.md` — otherwise data silently drops.
- **Preview and scaffold must resolve the same path.** Both go through `resolveCreateTarget` in
  `src/core`, and the confirmation dialog names the file it returns. A second resolution
  anywhere — a path computed in the renderer, a `path.join` inlined into a prompt builder — makes the
  modal describe a file other than the one on disk, and the user is consenting to the wrong thing.
  `test/create-preview.test.ts` and `test/scaffold.test.ts` in that package compare the two.
- **The renderer's `utils/text.ts` re-exports and must never implement.** `buildDesc` decides the
  `description:` frontmatter; the form's preview shows it before the file exists and the node-side
  scaffold writes it after. Two implementations means a preview that silently stops matching the
  file, and it looks fine right up until someone edits one of them. Import the **subpath**
  (`src/core/text.ts`) — that module, never the `src/core/index.ts` barrel, which re-exports `fs`. `test/isolation.test.ts` fails on a
  re-implementation anywhere under `src/renderer`.
- **The prompt is prose, never `/create-skill`.** A slash command in a headless run would re-enter
  the skill from the top instead of finishing the scaffold — and historically it fired the plugin's
  `UserPromptExpansion` hook, which launched the Docker app and blocked forever on a form submission
  that could never arrive. That hook is gone, but the rule stands. What changed under `026` is _how_
  it stands: the prompt used to carry its own inlined copy of the finishing instructions; now it
  states facts only and names the `SKILL.md` that holds the guidance, which the session loads itself
  with the `Skill` tool. A slash command is still wrong for the same reason as before — it re-enters
  the skill's "gather everything from scratch" entry rather than the one written for an
  already-scaffolded artifact. A test asserts no create prompt contains a slash command.
- **`claude:run` takes a token and nothing else.** The bridge's guarantee — the only executable
  prompts are ones the user was shown — comes from the run channel having no argument that could
  describe a different run. A preload that "helpfully" forwarded the prompt or argv alongside the
  token reopens that in a diff that reads as a convenience, and every test in `src/core`
  still passes, because none of them can see that side of the wire. `test/isolation.test.ts` pins
  the call to `invoke(IPC.claudeRun, token)`.
- **A create-\* run's working directory is not always the open project.** A skill written into a
  marketplace repo, or a brand-new marketplace, lives outside it. `claude-preview.ts` derives the cwd
  from the same resolution that chose the path, and the dialog shows it. What the cwd no longer does
  is decide what may be written — see the next entry.
- **The cwd bounds nothing; `writable` does.** A run may write **only the paths the confirmation
  listed** (`ClaudeInvocation.writable` = `targets.map(t => t.path)`), and a write anywhere else —
  including elsewhere under the run's own working directory — is refused with a reason the model can
  act on. `src/core/write-scope.ts` is the whole decision (`decideWrite`, pure, no `fs`); the session
  hands it to the SDK as `canUseTool`. This replaced `--permission-mode acceptEdits`, which granted
  writes to anything anywhere under the cwd — an entire repository, for a marketplace target. **Edit
  pre-acceptance exists nowhere in the app**, and `test/isolation.test.ts` fails if it comes back.
  A `writable` of `[]` (the help chat, `ccusage`) refuses every write, saying the run was started to
  answer rather than to author.
- **The run is offered no shell and no subagents.** `SESSION_TOOLS` is
  `[...READ_ONLY_TOOLS, "Edit", "Write", "Skill"]`; `SESSION_DISALLOWED_TOOLS` is
  `Bash, Agent, NotebookEdit`. Both are in `agent-sdk.ts`. Withholding `Bash` is what makes the path
  check meaningful — it is the one tool whose reach cannot be bounded by inspecting `tool_input` —
  and it is only affordable because `016` moved `git init` into the scaffold. `allowedTools` is
  deliberately unused: it auto-approves without restricting. `AskUserQuestion` is **not** offered:
  this path is still headless, so a question has nobody to answer it. `Skill` **is** offered, as of
  `026` — see "The guidance lives in exactly one place" above for why a headless run needs it and how
  it actually reaches a skill's body (`pluginDir`, not just the tool name).
- **`ClaudePreview.argv` is the _equivalent_ command line, not what is spawned.** It is what you
  would type to reproduce the run yourself — which is what **Copy prompt** is for — and the dialog
  labels the row "Equivalent" for that reason. The SDK spawns the same binary with its own
  stream-protocol flags, and `ClaudeRunResult.argv` reports what actually went out; the two do not
  match on purpose. `ClaudeRunResult.code` is `0` on success and `null` otherwise, so the UI renders
  `error`.
- **A run loads no filesystem settings** (`settingSources: []`), so nothing on disk can widen it and
  no key in a settings file can redirect billing. Two consequences: the read disclosure lists only
  the cwd and the managed (administrator) policy tier, and **`CLAUDE.md` files are not auto-loaded
  into a run** — the SDK requires `settingSources` to include `'project'`. The model can still
  `Read` them. `resolveEffectiveSettings()` passes `[]` too, and must keep matching the session or
  the disclosure describes a session that no longer exists with nothing failing.
- **The settings are resolved against the RUN's cwd, not the open project** — the same asymmetry, one
  layer down. A marketplace-targeted create run picks up the _marketplace's_ `.claude/settings.json`,
  so its readable directories and permission rules can be nothing like the open project's. Resolving
  against `projectRoot` "because that is the project" produces a disclosure that is confidently
  describing the wrong tree. Verified in the window, not inferred.
- **The settings resolution is a port, not an import — same reason as `GitPort`.** `SettingsPort` is
  an interface in `contracts.ts`, `nodeSettings()` implements it in `src/core/agent-sdk.ts`, and
  `src/main/ipc.ts` injects it. `claude-preview.ts` may import nothing that can start a process, and
  the SDK shells out to `plutil`/`reg.exe` for MDM policy — one `child_process` in that graph costs
  the guarantee `test/core/claude.test.ts` exists to prove. This makes `previewClaudeRun` **async**:
  every caller must `await`. And dropping the injection is not an error — the preview falls back to
  "the settings were not consulted", which is a true sentence nobody reads, so `test/isolation.test.ts`
  pins the wiring. Never reimplement the cascade: the SDK's `resolveSettings` is the merge engine.
- **Preview tokens are dropped on a project switch.** A token names the outgoing project's cwd, so a
  modal left open across a switch would otherwise still have a live token and **Run** would spawn
  Claude against the repo the window has moved off.
- **A cancelled run's child is detached, so quitting must kill it.** The child is spawned into its
  own process group — that is how Stop reaches the CLI's own children — which also means it outlives
  the app. `disposeIpc` calls `disposeClaudeRuns()`. The SDK is handed the app's own
  `spawnClaudeCodeProcess` rather than left to spawn for itself, precisely to keep that property.
  Teardown is three distinct actions and only one of them releases the child the SDK holds:
  `query.close()`, then SIGTERM to the process **group**, then SIGKILL after a grace. `stdio` is
  three pipes now — the SDK speaks a control protocol over stdin/stdout, and closing stdin closes
  the conversation.
- **Scaffold can still fail.** A bad path or a refused overwrite yields `scaffolded: false` with a
  `reason`, and the consuming skill must create the artifact itself. Always branch on the `scaffold`
  object; never assume the file exists.
- **Nothing in a create-\* prompt may run git.** The repository is the scaffold's, and a model that
  helpfully runs `git init` either nests a second repository or re-commits the scaffold under a
  different author. The prompt tells the run the repository state instead — `claude-preview.ts`
  derives that line from `enclosingRepo(target.path)` on disk, so it is true whether or not the
  scaffold made one.
- **`src/core/git.ts` is a _sixth_ entry on the reviewed spawner list in `test/isolation.test.ts`,
  and the list got wider on purpose.** What moved out of the prompt was the shell in the **session**,
  not in the app: the app runs `git` itself, `execFileSync` with an argument vector and no shell
  interpretation, so a marketplace name with a quote in it cannot become syntax. One more module
  that can spawn, in exchange for taking `Bash` out of the create-marketplace conversation. It is
  **not** a path to Claude — the neighbouring note about the `resolveClaudeCli` caller list is a
  different list.
