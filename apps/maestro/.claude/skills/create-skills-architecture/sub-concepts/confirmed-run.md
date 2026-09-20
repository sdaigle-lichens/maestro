# The confirmed run: token, dialog, Agent SDK session

Everything between `needsModel` and a finished body. The scaffold is already on disk when any of
this starts; nothing here can be reached without a token the user was shown.

```
window.maestro.claude.preview(request)   IPC `claude:preview`
  → builds the prompt (prose, never a slash command), resolves the argv, the cwd,
    and the files it may write; resolves the EFFECTIVE settings for that cwd through
    an injected SettingsPort and derives what the run can READ; returns a TOKEN.
    Async. Spawns nothing.
ClaudeRunDialog shows what it can read, then the full prompt, the EQUIVALENT command
  line, cwd, targets → Copy prompt / Cancel / Run / Continue in the pane
window.maestro.claude.run(token)         IPC `claude:run`
  → starts an Agent SDK session over that invocation and streams it; `canUseTool`
    allows writes to `targets` and denies everything else with a reason
  → `claude:cancel` closes the query, then kills the process group
window.maestro.session.handoff(token)    IPC `session:handoff`
  → the SAME single-use token, spent on the session pane instead
```

## Two buttons spend the same token, and only one of them widens anything (`022`)

**Run** is the headless finish. **Continue in the pane** calls `session:handoff` with the token and
nothing else: main claims it, reads `ClaudePreview.handoff` (a `HandoffContext` — kind, name,
artifact, `writeScope`, `scope`, the frontmatter or directory listing read off disk, and `016`'s
repository state), adds that **one** path to the pane session's write scope, and seeds the context
with `shouldQuery: false` so nothing is spent until the user types. `handoff` is `null` for a
`maestro-task` preview and the channel refuses such a token — a task's write target is the whole
project. The scope entry is the artifact's own directory (`CreateTarget.dir`), or the artifact FILE
where `dir` is `""` — a project-target subagent shares `.claude/agents/` with every other agent.

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

## Things that bite

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
  `026` — see "The guidance lives in exactly one place" above.
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
