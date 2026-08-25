# Run create-* authoring on the SDK with no acceptEdits

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

This is the permission engine, built where it needs no user interface. Read
`SESSION-PANE-PLAN.md` — "The two write paths" and "The permission model" are the specification.

Today a create-\* run finishes an artifact's body headlessly, and pre-accepts every file edit to do
it. That flag is not decoration: a headless run has nobody to ask, so without it the default
permission mode turns every useful run into a refusal. But it grants write authority over *anything
anywhere* under the working directory, which for a marketplace target is an entire repository the
user did not think they were opening up.

Move that run onto the Agent SDK, where the host process **is** somebody to ask. The permission
callback silently allows writes to exactly the path the create resolution returned and the
confirmation dialog displayed, and denies everything else with a reason the model can act on. No
prompt, no interruption, no change the user notices — and strictly narrower than what it replaces.

Everything else about the path is preserved deliberately:

- **The token is unchanged.** Preview builds the prompt and issues a single-use, purpose-tagged
  token; the run accepts a token and nothing else and is still the only thing in the app that can
  start a process. The guarantee is about which prompt executes, not about which process runs it.
- **The detached process group stays.** The app spawns into its own group specifically so Stop
  reaches the CLI's own children. The SDK accepts a custom spawn function; use it rather than
  trading a working teardown for an unverified one. Teardown must still close the query explicitly —
  interrupting a turn, aborting, and closing are three different things.
- Filesystem settings are not loaded. The session's configuration is authored by the app and passed
  programmatically, so nothing on disk can widen it and no key in a settings file can redirect
  billing.

The session also gets an explicit tool set for the first time: no shell, no subagents. A denied tool
costs turns to argue with, while a tool that was never offered costs nothing.

Withholding the shell is already **safe for create-marketplace**, which was the one create-\* prompt
that needed one: `016` moved `git init` and the first commit into the deterministic scaffold, and the
prompt now forbids git rather than asking for it. Nothing left in a create-\* prompt wants a shell.

A related note for whoever revisits the isolation tests here: the reviewed spawner list in
`test/isolation.test.ts` gained `src/core/git.ts` in `016`. That entry is the app running `git`
itself with an argument vector — it is **not** a path to Claude, and it must survive this slice. The
existing comment there about narrowing the `resolveClaudeCli` caller list is about a different list.

Four things `017` left standing here, and one of them is a trap:

- `previewClaudeRun` is already **async** and already takes a `SettingsPort`. Any caller you touch
  must `await` it.
- The confirmation already discloses what the run can **read**, resolved from the effective settings
  cascade for the run's own cwd. `017` made that disclosure honest about *today's* behaviour first
  on purpose, so this slice's change lands as a visible **narrowing** rather than arriving with it.
- **If this slice changes what the run is configured with — a narrower `settingSources`, an explicit
  `additionalDirectories`, a different permission mode — then `resolveEffectiveSettings()` in
  `src/core/agent-sdk.ts` must change with it.** It currently leaves `settingSources` unset, which
  loads every tier, because that is what a `claude -p` run gets. Configure the run differently and
  leave the resolution alone and the disclosure silently becomes a lie: it will keep describing a
  session that no longer exists, and nothing fails.
- `agent-sdk.ts` is now user-facing — `nodeSettings()` backs that disclosure — and is still the only
  module in the app that imports the SDK.

When this lands, edit pre-acceptance exists nowhere in the app.

## Acceptance criteria

- [ ] Create-\* body authoring runs through the SDK and produces the same artifacts as before
- [ ] Writes to the resolved target path are allowed without prompting; a write anywhere else is denied with a reason
- [ ] Edit pre-acceptance is gone from every invocation the app makes, and nothing regressed to compensate
- [ ] The run still accepts only a single-use, purpose-tagged token and cannot be handed a prompt
- [ ] Stop still reaches the CLI's own children, and quitting the app leaves no surviving process — verified by inspecting processes, not by reading code
- [ ] No filesystem settings source is loaded, and a key placed in user settings does not redirect billing
- [ ] The session offers no shell tool and no subagent tool
- [ ] The isolation tests still pin the token contract, and gain a case for the new callback

## Blocked by

- `015-externalize-the-agent-sdk.md`
- `016-git-init-a-new-marketplace-without-a-shell.md`
- `017-disclose-what-a-run-can-read.md`
