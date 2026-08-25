# Make a new marketplace a git repo without a shell

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Today, creating a marketplace asks a model to set up git for it — the instruction lives in a prompt
string, so the repository exists only if a run happened and did as it was told. That is the last
thing in the whole create-\* system that needs a shell, and it is the one obstacle to taking `Bash`
away from the session entirely (see `SESSION-PANE-PLAN.md`, "The tool set is the first permission
layer").

Initialising a repository is exactly as deterministic as making a directory, so it belongs with the
rest of the deterministic scaffolding rather than in a prompt. Move it there.

It must join the existing **all-or-nothing** discipline: the scaffold declares its complete list of
steps before any of them runs and rolls back what it did if any step fails. A half-initialised
directory — repo but no manifest, or manifest but no repo — is the failure this rule exists to
prevent.

Keep it to initialisation and the first commit. Remotes, private-repo setup and auto-update
configuration stay conversational: they need decisions and credentials the app does not have, and
they are exactly the sort of thing the pane will be good at later.

The prompt string that currently asks for git setup loses that instruction in the same change, so
the two cannot disagree about who did it.

## Acceptance criteria

- [ ] Creating a marketplace produces an initialised git repository with the scaffolded files committed, with no shell invoked from the app
- [ ] The repository step participates in the existing all-or-nothing rollback: a later failure leaves no repository behind
- [ ] Creating a marketplace inside an existing repository does not nest or reinitialise one
- [ ] The create-marketplace prompt no longer asks a model to set up git
- [ ] Remote and private-repo setup are still offered to the user as something to do next, not silently dropped
- [ ] A machine with no `git` on PATH reports that clearly and still leaves a complete, usable marketplace

## Blocked by

None — can start immediately.
