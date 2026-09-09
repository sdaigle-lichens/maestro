# Agent SDK integration

`src/core/agent-sdk.ts` is the app's **only** importer of the SDK, and `test/isolation.test.ts` pins
that: the SDK is a second path to the `claude` binary, and the options it is given decide the
permission model of everything built on it. It exports three things that matter — `startAgentSession`
(the headless run), `startPaneSession` (the live conversation), and `nodeSettings()` (the
`SettingsPort` the preview is handed, because the preview may not import this module).

## Get the package right

`@anthropic-ai/claude-agent-sdk` spawns the `claude` CLI the user is already logged into, and the
work draws on **their subscription**. It is _not_ `@anthropic-ai/sdk`, the REST client for the
Messages API — that takes an API key, bills pay-as-you-go, spawns nothing and has no `canUseTool`.
The names differ by one path segment, both install without complaint, and the wrong one defeats the
entire point while looking correct. `AGENT_SDK_PACKAGE` is the one place the string lives.

The SDK tracks the CLI it was cut against patch-for-patch and the stdio control protocol between
them is private, so pointing it at the user's own self-updating `claude` is a deliberate trade. The
smoke result reports both versions so a support answer can name the drift.

## Three things that only fail in a packaged build

1. **The SDK must be externalized.** Bundled, its own `require.resolve` of a CLI on disk resolves
   against the bundle and throws `Native CLI binary for <platform> not found`. It must **not** join
   the `exclude:` list in `electron.vite.config.ts` — that list is for workspace source packages with
   no build artifact, the opposite case.
2. **asar is the second half, and is not actionable yet.** In a packaged app `require` then looks
   inside `app.asar`, where a native binary cannot execute. There is no electron-builder config in
   this repo, so this is a constraint on whoever adds packaging, not an omission.
3. **The CLI path is handed over, never looked up.** Left to itself the SDK spawns **node** to run a
   bundled `cli.js`, and a GUI-launched Electron app has a `PATH` with no `node` on it — the failure
   reads `spawn node ENOENT` and does not reproduce from a terminal. `pathToClaudeCodeExecutable`
   gets `claude-cli.ts`'s answer instead.

## The environment the child gets

`agentChildEnv()` **constructs** it rather than inheriting, because the SDK's `env` option _replaces_
the subprocess environment. Two properties pull against each other:

- **No billing credential survives.** `BILLING_ENV_VARS` (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`)
  are **deleted**, not set to `undefined` — absence is the property, and the only one a test can
  assert. A stray key in a shell profile would otherwise turn every turn into a pay-as-you-go call
  with nothing on screen saying so. `CLAUDE_CODE_USE_BEDROCK`/`_VERTEX` are deliberately **left
  alone** — those are a deployment someone configured on purpose — and reported instead.
- **`PATH` survives, expanded.** Since `env` replaces, the naive "just drop the key" also drops
  `PATH`, and the CLI shells out to git and hooks.

`billingFrom(apiKeySource)` reads where the money went off the init message. `"oauth"` **and
`"none"`** both mean the subscription: `none` is undocumented but is what the CLI emits at runtime
when no API key is in play, which is the state this app wants to be in.

## Tool and skill lists

| Constant                   | Contents                                     | Note                                                                                              |
| -------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `SESSION_TOOLS`            | `READ_ONLY_TOOLS` + `Edit`, `Write`, `Skill` | the headless run                                                                                  |
| `PANE_TOOLS`               | `SESSION_TOOLS` + `AskUserQuestion`          | needs a person, so it arrives with the pane                                                       |
| `SESSION_DISALLOWED_TOOLS` | `Bash`, `Agent`, `NotebookEdit`              | named _as well as_ omitted — `disallowedTools` removes a tool even if something else puts it back |
| `SESSION_SKILLS`           | the four create-\* skills                    | the single source of "how to finish a scaffolded artifact"                                        |
| `PANE_SKILLS`              | + `maestro-help`, `update-skill-tags`        | the latter is pane-only; it never runs headlessly                                                 |

**`skills` alone does not make a name resolvable.** With `settingSources: []` the query loads no
installed plugins, and the `Skill` tool answers "Unknown skill" for every name — measured in the
window, silently, with nothing logged. The fix is passing `pluginDir`, which main supplies as the
composition root. Absent it, the session loads no plugin and the run degrades to a thinner
instruction rather than a wrong one.

`AskUserQuestion` likewise has **two** mechanical preconditions: the tool in the list, _and_
`toolConfig.askUserQuestion.previewFormat` at the query. Without the second, Claude emits no
`preview` on any option and every list arrives bare. If a question never arrives, check both first.

## Session handles

Both `startAgentSession` and `startPaneSession` **return synchronously and never reject**: the SDK
import is dynamic (1.3 MB a launch that runs nothing should not parse), so the query does not exist
yet on return, and `close()`/`say()` are written to cope with that window — a turn typed early is
queued, not lost. Every failure arrives as a result or an `ended` event, never as a throw.

Two turn shapes, and the difference is checkable rather than trusted: `humanTurn` stamps
`origin: { kind: "human" }`, `contextTurn` sets `shouldQuery: false` and **no origin**. Stamping app
context as human would make the invariant `session:say` exists to guarantee stop meaning anything.

File: `src/core/agent-sdk.ts`. Tests: `test/core/agent-sdk.test.ts`, `test/isolation.test.ts`.
