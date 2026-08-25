# Externalize the Agent SDK and run a query from main

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Read `SESSION-PANE-PLAN.md` first — this is its first slice, and the "Things that bite" section is
the specification for most of what follows.

Bring the **Claude Agent SDK** into the desktop app as a real, packaged dependency and prove a
single query runs from the main process. Nothing user-facing changes; the deliverable is that the
next eleven slices have ground to stand on.

Get the package right: this is `@anthropic-ai/claude-agent-sdk`, the one that spawns the CLI the
user is already logged into. It is **not** `@anthropic-ai/sdk`, which takes an API key and bills
pay-as-you-go. The names differ by one path segment and the wrong one silently defeats the point.

Three things make this more than an install:

- The app's build derives its externals from package.json **`dependencies`**, and the desktop app
  has no `dependencies` block at all — every entry is a devDependency. The block has to be created.
  Bundling the SDK breaks it, because it resolves a CLI on disk at runtime.
- It must **not** join the bundler's workspace-source exclusion list. That list exists for the
  opposite case: source packages with no build artifact.
- The SDK's default resolution spawns Node to run a bundled `cli.js`, which fails in a
  GUI-launched app with no `node` on PATH. Feed it the binary path the app already resolves with
  `fs` rather than letting it do its own PATH lookup — the app solved this once and should not
  re-acquire the bug.

Build the child environment explicitly rather than passing the parent's through: an
`ANTHROPIC_API_KEY` anywhere in the inherited environment silently bills the API instead of the
user's subscription. Note that the SDK's env option *replaces* the environment rather than merging,
so dropping the key must not also drop `PATH`.

This slice's failure mode only appears in a packaged build. A `dev` run proves nothing here.

## Acceptance criteria

- [ ] A `dependencies` block exists in the desktop app's manifest and the SDK is in it
- [ ] The built main bundle does not contain the SDK's source; it is required at runtime
- [ ] A smoke query runs from main and returns a result message, in `dev` **and** in a packaged build started from a desktop entry rather than a terminal
- [ ] The query is given an explicitly resolved CLI binary path, not left to its own PATH lookup
- [ ] The child environment is constructed explicitly, carries no `ANTHROPIC_API_KEY`, and still carries `PATH`
- [ ] The smoke query reports subscription usage rather than API billing
- [ ] A note is left for whoever adds packaging: asar unpacking is the second half of this and is not actionable until an electron-builder config exists

## Blocked by

None — can start immediately.
