---
name: create-skills-architecture
description: "Explains how the four create-* flows (create-skill, create-subagent, create-plugin, create-marketplace) work end-to-end: the desktop app's form routes, the deterministic scaffold in src/core, the confirmation dialog and the Agent SDK session it runs, and the consuming SKILL.md prompts. Use when the user is working inside apps/maestro or plugins/maestro and asks how a create flow works, where to add a new field, why a form change isn't reaching the prompt, why the confirmation dialog did or didn't open, why a run was refused a write, how target=project differs from target=marketplace, or how create-subagent's template-seed field differs from an /agents fork."
metadata:
  type: concept-skill
  version: "1.3"
  last-update: 0ebccda448b85ccba2da3e292cc874043a19b431
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
        └─2─▶ only when needsModel: claude:preview → ClaudeRunDialog → claude:run
              (headless) or session:handoff (Continue in the pane).
              See `sub-concepts/confirmed-run.md`.
        │
        ▼
The run — headless or in the pane — calls the Skill tool for
plugins/maestro/skills/create-<name>/SKILL.md and finishes only what
the scaffold left — authoring a body, enriching a README.
```

**The ordering in 1–2 is the design.** The artifact is on disk before Claude is mentioned, so
cancelling the confirmation — or having no CLI installed at all — still leaves the user with the
thing they asked for. `needsModel` decides whether the dialog opens by itself: an auto-mode body or
a brand-new marketplace's docs need one; a manual-mode skeleton and a plugin manifest are complete
as written. **Finish with Claude** on the result card stays available either way.

There is no hook in this path, no result file, and no blocking wait. `/create-skill` typed into a
session is a different thing entirely: the skill prompt with no payload and nothing pre-scaffolded,
which the SKILL.md handles by gathering the fields conversationally. Each consuming `SKILL.md` opens
with a "Which entry you are on" table that distinguishes the two, and `026` deleted the second,
inlined copy of the finishing guidance that the prompt used to carry — the token, the dialog, the
session's tools and skills, and every trap in that half of the pipeline are in
`sub-concepts/confirmed-run.md`.

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
| Template seed (target=project only)   | no                          | yes                         | no            | no                 |
| Chip-array fields                     | `useWhen`                   | `triggers`, `tools`         | `keywords`    | —                  |
| File generated                        | `SKILL.md`                  | `AGENTS.md` or `<name>.md`  | `plugin.json` | `marketplace.json` |
| Preview type                          | YAML frontmatter + markdown | YAML frontmatter + markdown | JSON          | JSON               |
| Dialog opens on submit                | auto mode only              | auto mode only              | no            | yes                |

`create-skill` and `create-subagent` are deeply parallel — they share the description-building
algorithm (`buildDesc`: first sentence of the idea + Oxford-joined chips, clipped to 140 chars).

`create-marketplace` is the only flow that touches git: the scaffold makes the new marketplace a
repository itself, in a three-state, all-or-nothing sequence — see
`sub-concepts/marketplace-repository.md`.

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

## Template seeding (create-subagent, project target only) (`029`)

`create:options` also returns `agentTemplates: DiscoveredDefinition[]` — every discovered agent,
project tier included, not filtered to global. `/create-subagent` renders a "Start from a template"
picker only when `target === "project"` and that list is non-empty; picking one sets `mode:
"manual"` plus `name`/`description` from the chosen entry. **This is a form seed, not a fork** — a
`DiscoveredDefinition` carries only `id`/`description`, so the scaffold still writes a fresh
skeleton via `manualAgentBody()` rather than cloning the source agent's actual body/tools/triggers.
The byte-for-byte version lives on `/agents`' card instead (`forkAgent`,
`src/core/agent-fork.ts`) — see `agents-view`.

## Common edits — where to make them

| Want to…                         | Edit                                                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add a field to a form            | the route's zod schema **and** `scaffold.ts` **and** the prompt builder in `claude-preview.ts` **and** the matching `SKILL.md` — all four must agree on the payload shape |
| Change validation rules          | the zod schema at the top of the route                                                                                                                                    |
| Change the live preview          | the `<name>-preview.tsx` component                                                                                                                                        |
| Change the description algorithm | `text.ts` in `src/core` — affects skill & subagent, preview and file, at once                                                                                             |
| Change keyboard shortcuts        | the route's `SHORTCUT_SECTIONS` and `create-shell.tsx`                                                                                                                    |
| Add a new shared UI primitive    | new file in `packages/ui/src/`, then an export in `packages/ui/package.json`                                                                                              |
| Add a new create-\* flow         | new route + a `scaffold*` function + a preview builder + a `SKILL.md`; wire it in as a **Create** link on the page that owns the thing (`components/tabs/create-link.tsx`), not into a top-bar menu — and add it to the reachability map in `test/isolation.test.ts`, which pins **which file** holds each entry point. Step-by-step: `apps/maestro/docs/extending-the-app.md`. |

**Where the four entry points live.** `test/isolation.test.ts`'s reachability map is the list of
record, because a Create link nobody can reach is a green suite and a dead feature:

| Flow                 | Entry point                                                  |
| -------------------- | ------------------------------------------------------------ |
| `create-skill`       | `src/renderer/src/routes/skills.tsx`                          |
| `create-subagent`    | `src/renderer/src/components/agents/agent-list.tsx` — the "+ New agent" link at the foot of `/agents`' left pane, not the route file |
| `create-plugin`      | `src/renderer/src/components/tabs/command-center.tsx`         |
| `create-marketplace` | `src/renderer/src/components/tabs/marketplace.tsx`            |

Skills and Agents moved off `/tools` onto their own pages; only the last two are still `/tools` tabs.

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
  that could never arrive. That hook is gone, but the rule stands: a slash command re-enters the
  skill's "gather everything from scratch" entry rather than the one written for an
  already-scaffolded artifact. A test asserts no create prompt contains a slash command.
- **Scaffold can still fail.** A bad path or a refused overwrite yields `scaffolded: false` with a
  `reason`, and the consuming skill must create the artifact itself. Always branch on the `scaffold`
  object; never assume the file exists.
- **Nothing in a create-\* prompt may run git.** The repository is the scaffold's, and a model that
  helpfully runs `git init` either nests a second repository or re-commits the scaffold under a
  different author. The prompt tells the run the repository state instead — `claude-preview.ts`
  derives that line from `enclosingRepo(target.path)` on disk, so it is true whether or not the
  scaffold made one.
- Everything about the token, the dialog, what the session may read and write, and how a run is
  cancelled: `sub-concepts/confirmed-run.md`. Everything about the new-marketplace repository:
  `sub-concepts/marketplace-repository.md`.
