# Put chat and stats behind the bridge

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Step 4 of `docs/plans/m6-help-server-merge.md`. Read that plan first.

Two of help-server's features spawn external processes, and both contradict decisions the desktop
app has already made. This slice brings them into line. It is separated from the rest of the merge
because it is a security decision, not a port.

**Chat currently spawns the CLI directly, with no preview and no confirmation.** That is precisely
what the bridge exists to prevent — the property being defended is that the only prompts which
execute are ones the user was shown. Rebuild chat on the bridge: the user sees the prompt, runs it,
watches output stream back.

A chat interface makes per-message confirmation feel heavier than it does in a one-shot form flow,
so a per-session "don't ask again" is reasonable. Two constraints on it: the **default must be to
show**, and the setting must be visible and revocable from the UI. An opt-out that is on by default,
or that the user cannot find again to turn off, has simply removed the confirmation.

**The usage-stats feature downloads and executes a package from the network on every invocation.**
That was already true in the container; in a desktop app running against the user's own machine it
is a more pointed choice, and it should not survive the move unexamined. At minimum, surface what
is about to be run before running it. Better: prefer a locally installed copy when one exists, and
pin a version rather than floating on the latest published one — floating means the behaviour of
the app changes without the app changing.

Whatever is decided here, record the decision and its reasoning where the next person will find it.

## Acceptance criteria

- [ ] Chat runs entirely through the bridge's preview → confirm → run path, with no direct spawn
      remaining anywhere in its implementation
- [ ] The user sees the exact prompt before it runs, and declining runs nothing
- [ ] Output streams into the chat surface as it arrives and can be cancelled mid-run
- [ ] Any "don't ask again" affordance defaults to **asking**, is scoped no wider than the session,
      and is visible and revocable in the UI
- [ ] Nothing is downloaded and executed from the network without the user being shown what it is
      first
- [ ] A locally installed copy is preferred when present, and any remote fetch is version-pinned
      rather than floating
- [ ] The stats feature degrades with a clear message when the tool is unavailable, rather than
      failing at spawn time
- [ ] The decision taken on network execution is written down with its reasoning
- [ ] No code path in the merged app spawns the CLI outside the bridge — asserted by a test, since
      this regresses silently

## Blocked by

- `007-the-claude-bridge-preview-and-run.md`
- `012-fold-in-help-servers-read-only-surface.md`
