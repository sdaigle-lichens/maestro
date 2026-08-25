# The Claude bridge — preview and run as separate operations

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Steps 3 and 4 of `docs/plans/m4-claude-bridge.md`. Read that plan first.

The app needs to be able to run `claude -p` on the user's behalf. This slice builds only that
capability and the confirmation flow around it — the routes that consume it come next, and the
bridge should be demoable on its own before they exist.

**The preview/run split is the security design and is not an implementation detail.** Two
operations, deliberately not one: preview builds the prompt and returns it, and has no access to
process spawning at all; run accepts a token that preview issued and refuses anything else. The
property this buys is that *the only executable prompts are ones the user was shown*. A renderer
bug cannot invent a prompt and execute it. Collapsing these into a single "run this prompt" call
throws that away while looking like a simplification, so it must not happen quietly.

**A GUI app does not inherit a login shell's `PATH`.** On macOS and Linux, `process.env.PATH` in a
desktop app is not what the user sees in their terminal, so the CLI will appear missing on machines
where it is plainly installed. Resolve it explicitly rather than trusting the environment, and
report availability as part of preview so the UI can say "the CLI was not found" instead of failing
at spawn time.

**Output is streamed, not awaited.** These runs are long enough that a blocked UI is not an option;
the user watches output arrive and needs a way to stop it.

The confirmation modal is the user-facing half of the same decision: it shows the prompt that will
run, the working directory, and what will be written, before anything is spawned. It is the whole
reason preview exists as a separate operation.

## Acceptance criteria

- [ ] Preview returns the prompt, the argument list, the working directory, and what would be
      written, and spawns nothing
- [ ] Run refuses any request that does not carry a token issued by a preview, and a token cannot
      be reused to run something other than what was previewed
- [ ] The preview path has no ability to spawn a process
- [ ] Output streams to the UI as it arrives rather than appearing only on completion
- [ ] A running invocation can be cancelled from the UI, and cancelling actually terminates the
      child process
- [ ] CLI availability is reported by preview, and resolution does not depend on the desktop app
      inheriting a login shell's `PATH` — verified by launching the app from a GUI launcher, not a
      terminal
- [ ] A missing CLI produces a clear message naming what was looked for, not a spawn failure
- [ ] The confirmation modal shows the exact prompt and working directory before anything runs, and
      declining runs nothing
- [ ] A non-zero exit and a crash are both surfaced with their output, distinguishably
- [ ] The token contract is covered by tests, including the negative case of a forged or replayed
      token

## Blocked by

None — can start immediately
